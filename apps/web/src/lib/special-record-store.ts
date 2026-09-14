import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type { EnglishRecord, EnglishSaveInput } from "./special-record.ts";

export type SpecialRecordDocument = Omit<EnglishRecord, "id"> & { _id: string };

type SpecialFilter = Partial<SpecialRecordDocument>;
type SpecialUpdate = {
  $setOnInsert?: SpecialRecordDocument;
  $set?: Partial<SpecialRecordDocument>;
  $inc?: { revision: number };
};

export type EnglishDeliveryReport =
  | { outcome: "completed"; result: string }
  | { outcome: "failed"; error: string; result?: string };

export type EnglishDeliveryStatus = {
  pending: number;
  processing: number;
  failed: number;
};

export type SpecialRecordCollection = {
  createIndex(keys: Record<string, 1 | -1>, options: { name: string }): Promise<string>;
  updateOne(
    filter: SpecialFilter,
    update: SpecialUpdate,
    options?: { upsert?: boolean },
  ): Promise<unknown>;
  findOne(filter: SpecialFilter): Promise<SpecialRecordDocument | null>;
  findOneAndUpdate(
    filter: SpecialFilter,
    update: SpecialUpdate,
    options: { returnDocument: "after" },
  ): Promise<SpecialRecordDocument | null>;
  findOneAndDelete(filter: SpecialFilter): Promise<SpecialRecordDocument | null>;
  find(filter: SpecialFilter): {
    sort(sort: Record<string, 1 | -1>): { toArray(): Promise<SpecialRecordDocument[]> };
  };
};

export type EnglishSaveOutcome =
  | { kind: "created" | "updated"; record: EnglishRecord }
  | { kind: "deleted"; record: null }
  | { kind: "conflict"; record: EnglishRecord | null }
  | { kind: "locked"; record: EnglishRecord };

const COLLECTION_NAME = "specialRecords";
const PROCESSING_RETRY_MS = 15 * 60 * 1_000;
const PROCESSING_LEASE_MS = 30 * 60 * 1_000;
let indexPromise: Promise<void> | undefined;

function appendProcessingReceipt(existing: string | null | undefined, incoming: string): string {
  if (!existing) return incoming;
  const decode = (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  const prior = decode(existing);
  const attempts = typeof prior === "object" && prior !== null && "attempts" in prior
    && Array.isArray((prior as { attempts: unknown[] }).attempts)
    ? (prior as { attempts: unknown[] }).attempts
    : [prior];
  return JSON.stringify({ attempts: [...attempts, decode(incoming)] });
}

function toRecord(document: SpecialRecordDocument): EnglishRecord {
  const { _id, ...record } = document;
  return { id: _id, ...record };
}

async function mongoCollection(): Promise<SpecialRecordCollection> {
  const client = await getMongoClient();
  const database = client.db(getMongoDatabaseName());
  const collection = database.collection<SpecialRecordDocument>(COLLECTION_NAME);
  indexPromise ??= collection.createIndex(
    { moduleId: 1, journalDate: -1 },
    { name: "special_module_date" },
  ).then(() => undefined);
  await indexPromise;
  return collection;
}

export class SpecialRecordStore {
  private readonly getCollection: () => Promise<SpecialRecordCollection>;
  private readonly now: () => Date;

  constructor(
    getCollection: () => Promise<SpecialRecordCollection> = mongoCollection,
    now: () => Date = () => new Date(),
  ) {
    this.getCollection = getCollection;
    this.now = now;
  }

  async getEnglish(journalDate: string): Promise<EnglishRecord | null> {
    const document = await (await this.getCollection()).findOne({
      _id: `english:${journalDate}`,
      moduleId: "english",
    });
    return document ? toRecord(document) : null;
  }

  async listEnglish(): Promise<EnglishRecord[]> {
    const documents = await (await this.getCollection())
      .find({ moduleId: "english" })
      .sort({ journalDate: -1, _id: 1 })
      .toArray();
    return documents.map(toRecord);
  }

  async saveEnglish(input: EnglishSaveInput): Promise<EnglishSaveOutcome> {
    const collection = await this.getCollection();
    const id = `english:${input.journalDate}`;
    const current = await collection.findOne({ _id: id, moduleId: "english" });

    if (current !== null && current.processingState !== "pending") {
      return { kind: "locked", record: toRecord(current) };
    }

    if (!input.text.trim()) {
      if (current === null) return { kind: "deleted", record: null };
      if (input.expectedRevision !== current.revision) {
        return { kind: "conflict", record: toRecord(current) };
      }
      const deleted = await collection.findOneAndDelete({
        _id: id,
        moduleId: "english",
        revision: current.revision,
      });
      return deleted
        ? { kind: "deleted", record: null }
        : { kind: "conflict", record: await this.getEnglish(input.journalDate) };
    }

    const timestamp = this.now().toISOString();
    if (current === null) {
      if (input.expectedRevision !== null) return { kind: "conflict", record: null };
      const document: SpecialRecordDocument = {
        _id: id,
        moduleId: "english",
        journalDate: input.journalDate,
        payload: { schemaVersion: 1, text: input.text },
        revision: 0,
        processingState: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
        lockedAt: null,
      };
      await collection.updateOne({ _id: id }, { $setOnInsert: document }, { upsert: true });
      const stored = await collection.findOne({ _id: id, moduleId: "english" });
      if (stored && stored.payload.text === input.text && stored.revision === 0) {
        return { kind: "created", record: toRecord(stored) };
      }
      return { kind: "conflict", record: stored ? toRecord(stored) : null };
    }

    if (input.expectedRevision !== current.revision) {
      return { kind: "conflict", record: toRecord(current) };
    }
    const updated = await collection.findOneAndUpdate(
      { _id: id, moduleId: "english", revision: current.revision },
      {
        $set: {
          payload: { schemaVersion: 1, text: input.text },
          processingState: "pending",
          updatedAt: timestamp,
          processingAttemptId: null,
          processingClaimedAt: null,
          processingError: null,
          nextProcessingAttemptAt: null,
          processedAt: null,
          processingResult: null,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    return updated
      ? { kind: "updated", record: toRecord(updated) }
      : { kind: "conflict", record: await this.getEnglish(input.journalDate) };
  }

  async claimEnglish(boundaryDate: string): Promise<EnglishRecord | null> {
    const collection = await this.getCollection();
    const now = this.now();
    const nowIso = now.toISOString();
    const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS).toISOString();
    const records = (await this.listEnglish()).sort((left, right) =>
      left.journalDate.localeCompare(right.journalDate));

    for (const record of records) {
      if (record.journalDate >= boundaryDate) continue;
      const claimable = record.processingState === "pending"
        || (record.processingState === "failed"
          && (!record.nextProcessingAttemptAt || record.nextProcessingAttemptAt <= nowIso))
        || (record.processingState === "processing"
          && (!record.processingClaimedAt || record.processingClaimedAt <= staleBefore));
      if (!claimable) continue;

      const attemptId = crypto.randomUUID();
      const claimed = await collection.findOneAndUpdate(
        {
          _id: record.id,
          moduleId: "english",
          revision: record.revision,
          processingState: record.processingState,
          ...(record.processingAttemptId
            ? { processingAttemptId: record.processingAttemptId }
            : {}),
        },
        {
          $set: {
            processingState: "processing",
            processingAttemptId: attemptId,
            processingClaimedAt: nowIso,
            processingAttempts: (record.processingAttempts ?? 0) + 1,
            processingError: null,
            nextProcessingAttemptAt: null,
          },
          $inc: { revision: 1 },
        },
        { returnDocument: "after" },
      );
      if (claimed) return toRecord(claimed);
    }
    return null;
  }

  async reportEnglish(
    attemptId: string,
    report: EnglishDeliveryReport,
  ): Promise<EnglishRecord | null> {
    const collection = await this.getCollection();
    const current = await collection.findOne({
      moduleId: "english",
      processingState: "processing",
      processingAttemptId: attemptId,
    });
    if (!current) return null;
    const timestamp = this.now().toISOString();
    const set = report.outcome === "completed"
      ? {
          processingState: "processed" as const,
          processingResult: appendProcessingReceipt(current.processingResult, report.result),
          processingError: null,
          nextProcessingAttemptAt: null,
          processedAt: timestamp,
          lockedAt: timestamp,
        }
      : {
          processingState: "failed" as const,
          processingResult: report.result
            ? appendProcessingReceipt(current.processingResult, report.result)
            : current.processingResult ?? null,
          processingError: report.error.slice(0, 2_000),
          nextProcessingAttemptAt: new Date(this.now().getTime() + PROCESSING_RETRY_MS).toISOString(),
          processedAt: null,
          lockedAt: null,
        };
    const updated = await collection.findOneAndUpdate(
      {
        _id: current._id,
        moduleId: "english",
        revision: current.revision,
        processingState: "processing",
        processingAttemptId: attemptId,
      },
      { $set: set, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    return updated ? toRecord(updated) : null;
  }

  async retryFailedEnglish(): Promise<number> {
    const collection = await this.getCollection();
    const failed = (await this.listEnglish()).filter((record) => record.processingState === "failed");
    let updatedCount = 0;
    for (const record of failed) {
      const updated = await collection.findOneAndUpdate(
        {
          _id: record.id,
          moduleId: "english",
          revision: record.revision,
          processingState: "failed",
        },
        {
          $set: { processingState: "pending", nextProcessingAttemptAt: null },
          $inc: { revision: 1 },
        },
        { returnDocument: "after" },
      );
      if (updated) updatedCount += 1;
    }
    return updatedCount;
  }

  async englishDeliveryStatus(boundaryDate: string): Promise<EnglishDeliveryStatus> {
    const records = (await this.listEnglish()).filter((record) => record.journalDate < boundaryDate);
    return {
      pending: records.filter((record) => record.processingState === "pending").length,
      processing: records.filter((record) => record.processingState === "processing").length,
      failed: records.filter((record) => record.processingState === "failed").length,
    };
  }
}

export const specialRecordStore = new SpecialRecordStore();
