import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type {
  JournalAreas,
  JournalCreateInput,
  JournalRecord,
  TrashedJournalRecord,
  JournalUpdateInput,
} from "./journal-record.ts";
import { JOURNAL_AREA_KEYS } from "./journal-record.ts";
import {
  JOURNAL_DELIVERY_LEASE_MS,
  JOURNAL_DELIVERY_RETRY_MS,
  taipeiDeliveryBoundary,
} from "./journal-delivery.ts";
import { randomUUID } from "node:crypto";

export type JournalDocument = Omit<JournalRecord, "id"> & {
  _id: string;
  deletedAt?: string;
};

type JournalFilter = Record<string, unknown>;

type JournalUpdate = {
  $setOnInsert?: JournalDocument;
  $set?: Partial<JournalDocument>;
  $inc?: Partial<Record<"revision" | "deliveryAttempts" | "todoDeliveryAttempts", number>>;
  $unset?: Record<string, "">;
};

export type JournalCollection = {
  createIndex(
    keys: Record<string, 1 | -1>,
    options: { name: string },
  ): Promise<string>;
  updateOne(
    filter: JournalFilter,
    update: JournalUpdate,
    options?: { upsert?: boolean },
  ): Promise<unknown>;
  updateMany(
    filter: JournalFilter,
    update: JournalUpdate,
  ): Promise<{ modifiedCount?: number }>;
  findOne(filter: JournalFilter): Promise<JournalDocument | null>;
  findOneAndUpdate(
    filter: JournalFilter,
    update: JournalUpdate,
    options: { returnDocument: "after" },
  ): Promise<JournalDocument | null>;
  find(filter: JournalFilter): {
    sort(sort: Record<string, 1 | -1>): {
      limit(limit: number): { toArray(): Promise<JournalDocument[]> };
      toArray(): Promise<JournalDocument[]>;
    };
  };
};

type JournalCollectionProvider = () => Promise<JournalCollection>;
type JournalCollectionFactory = (name: string) => JournalCollection;

type JournalStoreOptions = {
  now?: () => Date;
};

export type JournalUpdateOutcome =
  | { kind: "updated"; record: JournalRecord }
  | { kind: "conflict"; record: JournalRecord; current: JournalRecord }
  | { kind: "locked"; record: JournalRecord }
  | { kind: "notFound" };

export type JournalDeleteOutcome =
  | { kind: "deleted" }
  | { kind: "missing" }
  | { kind: "locked"; record: JournalRecord }
  | { kind: "conflict"; record: JournalRecord };

export type JournalRestoreOutcome =
  | { kind: "restored"; record: JournalRecord }
  | { kind: "missing" }
  | { kind: "conflict"; record: TrashedJournalRecord };

export type JournalDeliveryClaim = {
  attemptId: string;
  journalDate: string;
  records: JournalRecord[];
};

export type JournalDeliveryResult = {
  journalDate: string;
  recordCount: number;
};

export type TodoDeliveryClaim = {
  attemptId: string;
  record: JournalRecord;
};

export type JournalDeliveryDateStatus = {
  journalDate: string;
  pending: number;
  processing: number;
  failed: number;
  lastError?: string;
  nextAttemptAt?: string;
};

export type JournalDeliveryStatus = {
  pendingRecordCount: number;
  processingRecordCount: number;
  failedRecordCount: number;
  dates: JournalDeliveryDateStatus[];
};

const JOURNAL_COLLECTION_NAME = "journalRecords";
const JOURNAL_DATE_NEWEST_FIRST_INDEX = {
  journalDate: 1,
  createdAt: -1,
  _id: 1,
} as const;
const JOURNAL_DATE_NEWEST_FIRST_INDEX_NAME = "journal_date_newest_first";
const JOURNAL_DELIVERY_CLAIM_INDEX = {
  deliveryState: 1,
  editingState: 1,
  journalDate: 1,
  nextDeliveryAttemptAt: 1,
  createdAt: 1,
} as const;
const JOURNAL_DELIVERY_CLAIM_INDEX_NAME = "journal_delivery_claim";

export class JournalConflictRecordCollisionError extends Error {
  constructor() {
    super("conflictRecordId is already assigned to a different Journal record.");
    this.name = "JournalConflictRecordCollisionError";
  }
}

let journalIndexPromise: Promise<void> | undefined;

export async function initializeJournalCollection(
  getCollection: JournalCollectionFactory,
): Promise<JournalCollection> {
  const collection = getCollection(JOURNAL_COLLECTION_NAME);
  await collection.createIndex(JOURNAL_DATE_NEWEST_FIRST_INDEX, {
    name: JOURNAL_DATE_NEWEST_FIRST_INDEX_NAME,
  });
  await collection.createIndex(JOURNAL_DELIVERY_CLAIM_INDEX, {
    name: JOURNAL_DELIVERY_CLAIM_INDEX_NAME,
  });
  return collection;
}

async function getMongoJournalCollection(): Promise<JournalCollection> {
  const client = await getMongoClient();
  const database = client.db(getMongoDatabaseName());
  let initializedCollection: JournalCollection | undefined;

  journalIndexPromise ??= initializeJournalCollection((name) => {
    initializedCollection = database.collection<JournalDocument>(name);
    return initializedCollection;
  }).then(() => undefined);
  await journalIndexPromise;

  return (
    initializedCollection ??
    database.collection<JournalDocument>(JOURNAL_COLLECTION_NAME)
  );
}

function toJournalRecord(document: JournalDocument): JournalRecord {
  const record = { ...document } as Record<string, unknown>;
  delete record._id;
  delete record.deletedAt;
  return { id: document._id, ...record } as JournalRecord;
}

function toTrashedJournalRecord(document: JournalDocument): TrashedJournalRecord {
  if (document.deletedAt === undefined) {
    throw new Error("Journal trash record is missing deletedAt.");
  }
  return { ...toJournalRecord(document), deletedAt: document.deletedAt };
}

function hasSameAreas(left: JournalAreas, right: JournalAreas): boolean {
  return JOURNAL_AREA_KEYS.every((key) => left[key] === right[key]);
}

function isConflictCopyFor(
  document: JournalDocument,
  sourceId: string,
  input: JournalUpdateInput,
): boolean {
  return (
    document.conflictOf === sourceId &&
    document.deviceId === input.deviceId &&
    document.journalDate === input.journalDate &&
    hasSameAreas(document.areas, input.areas) &&
    document.editingState === input.editingState &&
    document.deliveryState === "undelivered" &&
    document.revision === 0
  );
}

export class JournalStore {
  private readonly getCollection: JournalCollectionProvider;
  private readonly now: () => Date;

  constructor(
    getCollection: JournalCollectionProvider = getMongoJournalCollection,
    { now = () => new Date() }: JournalStoreOptions = {},
  ) {
    this.getCollection = getCollection;
    this.now = now;
  }

  async create(input: JournalCreateInput): Promise<JournalRecord> {
    const timestamp = this.now().toISOString();
    const document: JournalDocument = {
      _id: input.id,
      deviceId: input.deviceId,
      journalDate: input.journalDate,
      areas: input.areas,
      deliveryState: "undelivered",
      editingState: "active",
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const collection = await this.getCollection();

    await collection.updateOne(
      { _id: input.id },
      { $setOnInsert: document },
      { upsert: true },
    );

    const stored = await collection.findOne({ _id: input.id });
    if (stored === null) {
      throw new Error("Journal record was not found after creation.");
    }

    return toJournalRecord(stored);
  }

  async listDate(journalDate: string): Promise<JournalRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection
      .find({ journalDate, deletedAt: { $exists: false } })
      .sort({ createdAt: -1, _id: 1 })
      .toArray();

    return documents.map(toJournalRecord);
  }

  async listTrash(): Promise<TrashedJournalRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection
      .find({ deletedAt: { $exists: true } })
      .sort({ deletedAt: -1, _id: 1 })
      .toArray();
    return documents.map(toTrashedJournalRecord);
  }

  async update(
    id: string,
    input: JournalUpdateInput,
  ): Promise<JournalUpdateOutcome> {
    const collection = await this.getCollection();
    const updatedAt = this.now().toISOString();
    const updated = await collection.findOneAndUpdate(
      {
        _id: id,
        revision: input.expectedRevision,
        deliveryState: "undelivered",
      },
      {
        $set: {
          deviceId: input.deviceId,
          journalDate: input.journalDate,
          areas: input.areas,
          editingState: input.editingState,
          updatedAt,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );

    if (updated !== null) {
      return { kind: "updated", record: toJournalRecord(updated) };
    }

    const current = await collection.findOne({ _id: id });
    if (current === null) return { kind: "notFound" };

    const currentRecord = toJournalRecord(current);
    if (current.deliveryState !== "undelivered") {
      return { kind: "locked", record: currentRecord };
    }

    if (input.conflictRecordId === id) {
      throw new JournalConflictRecordCollisionError();
    }

    const existingConflict = await collection.findOne({
      _id: input.conflictRecordId,
    });
    if (existingConflict !== null) {
      if (!isConflictCopyFor(existingConflict, id, input)) {
        throw new JournalConflictRecordCollisionError();
      }

      return {
        kind: "conflict",
        record: toJournalRecord(existingConflict),
        current: currentRecord,
      };
    }

    const conflictTimestamp = this.now().toISOString();
    const conflictDocument: JournalDocument = {
      _id: input.conflictRecordId,
      deviceId: input.deviceId,
      journalDate: input.journalDate,
      areas: input.areas,
      deliveryState: "undelivered",
      editingState: input.editingState,
      revision: 0,
      createdAt: conflictTimestamp,
      updatedAt: conflictTimestamp,
      conflictOf: id,
    };

    await collection.updateOne(
      { _id: input.conflictRecordId },
      { $setOnInsert: conflictDocument },
      { upsert: true },
    );
    const conflict = await collection.findOne({ _id: input.conflictRecordId });
    if (conflict === null) {
      throw new Error("Journal conflict record was not found after creation.");
    }
    if (!isConflictCopyFor(conflict, id, input)) {
      throw new JournalConflictRecordCollisionError();
    }

    return {
      kind: "conflict",
      record: toJournalRecord(conflict),
      current: currentRecord,
    };
  }

  async delete(
    id: string,
    expectedRevision: number,
  ): Promise<JournalDeleteOutcome> {
    const collection = await this.getCollection();
    const deletedAt = this.now().toISOString();
    const deleted = await collection.findOneAndUpdate({
      _id: id,
      revision: expectedRevision,
      deliveryState: "undelivered",
      deletedAt: { $exists: false },
    }, {
      $set: { deletedAt, updatedAt: deletedAt, editingState: "idle" },
      $inc: { revision: 1 },
    }, { returnDocument: "after" });

    if (deleted !== null) return { kind: "deleted" };

    const current = await collection.findOne({ _id: id });
    if (current === null) return { kind: "missing" };
    if (current.deletedAt !== undefined) return { kind: "deleted" };
    if (current.deliveryState !== "undelivered") {
      return { kind: "locked", record: toJournalRecord(current) };
    }
    return { kind: "conflict", record: toJournalRecord(current) };
  }

  async restore(
    id: string,
    expectedRevision: number,
  ): Promise<JournalRestoreOutcome> {
    const collection = await this.getCollection();
    const updatedAt = this.now().toISOString();
    const restored = await collection.findOneAndUpdate({
      _id: id,
      revision: expectedRevision,
      deletedAt: { $exists: true },
    }, {
      $unset: { deletedAt: "" },
      $set: { updatedAt },
      $inc: { revision: 1 },
    }, { returnDocument: "after" });

    if (restored !== null) {
      return { kind: "restored", record: toJournalRecord(restored) };
    }
    const current = await collection.findOne({ _id: id });
    if (current === null || current.deletedAt === undefined) return { kind: "missing" };
    return { kind: "conflict", record: toTrashedJournalRecord(current) };
  }

  async claimDelivery(now = this.now()): Promise<JournalDeliveryClaim | undefined> {
    const collection = await this.getCollection();
    const timestamp = now.toISOString();
    const leaseExpiredAt = new Date(now.getTime() - JOURNAL_DELIVERY_LEASE_MS).toISOString();

    await collection.updateMany(
      { deliveryState: "processing", deliveryClaimedAt: { $lte: leaseExpiredAt } },
      {
        $set: {
          deliveryState: "undelivered",
          deliveryError: "The previous delivery lease expired before completion.",
          nextDeliveryAttemptAt: timestamp,
        },
        $unset: { deliveryAttemptId: "", deliveryClaimedAt: "" },
      },
    );

    const eligibleFilter: JournalFilter = {
      deliveryState: "undelivered",
      editingState: "idle",
      deletedAt: { $exists: false },
      journalDate: { $lt: taipeiDeliveryBoundary(now) },
      $or: [
        { nextDeliveryAttemptAt: { $exists: false } },
        { nextDeliveryAttemptAt: { $lte: timestamp } },
      ],
    };
    const candidates = await collection
      .find(eligibleFilter)
      .sort({ journalDate: 1, createdAt: 1, _id: 1 })
      .limit(1)
      .toArray();
    const candidate = candidates[0];
    if (candidate === undefined) return undefined;

    const attemptId = randomUUID();
    await collection.updateMany(
      { ...eligibleFilter, journalDate: candidate.journalDate },
      {
        $set: {
          deliveryState: "processing",
          deliveryAttemptId: attemptId,
          deliveryClaimedAt: timestamp,
        },
        $unset: { deliveryError: "", nextDeliveryAttemptAt: "" },
        $inc: { deliveryAttempts: 1 },
      },
    );

    const claimed = await collection
      .find({ deliveryState: "processing", deliveryAttemptId: attemptId })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    if (claimed.length === 0) return undefined;

    return {
      attemptId,
      journalDate: candidate.journalDate,
      records: claimed.map(toJournalRecord),
    };
  }

  async completeDelivery(
    attemptId: string,
    result: string,
  ): Promise<JournalDeliveryResult | undefined> {
    const collection = await this.getCollection();
    const claimed = await collection
      .find({ deliveryState: "processing", deliveryAttemptId: attemptId })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    if (claimed.length === 0) return undefined;

    const deliveredAt = this.now().toISOString();
    await collection.updateMany(
      { deliveryState: "processing", deliveryAttemptId: attemptId },
      {
        $set: {
          deliveryState: "delivered",
          editingState: "idle",
          deliveredAt,
          deliveryResult: result,
          updatedAt: deliveredAt,
        },
        $unset: {
          deliveryAttemptId: "",
          deliveryClaimedAt: "",
          deliveryError: "",
          nextDeliveryAttemptAt: "",
        },
      },
    );

    for (const record of claimed) {
      if (!record.areas.event.trim()) continue;
      await collection.updateMany(
        { _id: record._id, todoDeliveryState: { $exists: false } },
        { $set: { todoDeliveryState: "pending" } },
      );
    }

    return { journalDate: claimed[0].journalDate, recordCount: claimed.length };
  }

  async claimTodoDelivery(now = this.now()): Promise<TodoDeliveryClaim | undefined> {
    const collection = await this.getCollection();
    const timestamp = now.toISOString();
    const leaseExpiredAt = new Date(now.getTime() - JOURNAL_DELIVERY_LEASE_MS).toISOString();
    await collection.updateMany(
      { todoDeliveryState: "processing", todoDeliveryClaimedAt: { $lte: leaseExpiredAt } },
      {
        $set: {
          todoDeliveryState: "pending",
          todoDeliveryError: "The previous Todo delivery lease expired before completion.",
          nextTodoDeliveryAttemptAt: timestamp,
        },
        $unset: { todoDeliveryAttemptId: "", todoDeliveryClaimedAt: "" },
      },
    );
    const attemptId = randomUUID();
    const record = await collection.findOneAndUpdate(
      {
        todoDeliveryState: "pending",
        deliveryState: "delivered",
        deletedAt: { $exists: false },
        $or: [
          { nextTodoDeliveryAttemptAt: { $exists: false } },
          { nextTodoDeliveryAttemptAt: { $lte: timestamp } },
        ],
      },
      {
        $set: {
          todoDeliveryState: "processing",
          todoDeliveryAttemptId: attemptId,
          todoDeliveryClaimedAt: timestamp,
        },
        $unset: { todoDeliveryError: "", nextTodoDeliveryAttemptAt: "" },
        $inc: { todoDeliveryAttempts: 1 },
      },
      { returnDocument: "after" },
    );
    return record ? { attemptId, record: toJournalRecord(record) } : undefined;
  }

  async completeTodoDelivery(attemptId: string, result: string): Promise<JournalRecord | undefined> {
    const timestamp = this.now().toISOString();
    const record = await (await this.getCollection()).findOneAndUpdate(
      { todoDeliveryState: "processing", todoDeliveryAttemptId: attemptId },
      {
        $set: {
          todoDeliveryState: "delivered",
          todoDeliveredAt: timestamp,
          todoDeliveryResult: result,
        },
        $unset: {
          todoDeliveryAttemptId: "",
          todoDeliveryClaimedAt: "",
          todoDeliveryError: "",
          nextTodoDeliveryAttemptAt: "",
        },
      },
      { returnDocument: "after" },
    );
    return record ? toJournalRecord(record) : undefined;
  }

  async failTodoDelivery(attemptId: string, error: string): Promise<JournalRecord | undefined> {
    const now = this.now();
    const record = await (await this.getCollection()).findOneAndUpdate(
      { todoDeliveryState: "processing", todoDeliveryAttemptId: attemptId },
      {
        $set: {
          todoDeliveryState: "pending",
          todoDeliveryError: error.slice(0, 2_000),
          nextTodoDeliveryAttemptAt: new Date(now.getTime() + JOURNAL_DELIVERY_RETRY_MS).toISOString(),
        },
        $unset: { todoDeliveryAttemptId: "", todoDeliveryClaimedAt: "" },
      },
      { returnDocument: "after" },
    );
    return record ? toJournalRecord(record) : undefined;
  }

  async failDelivery(
    attemptId: string,
    error: string,
  ): Promise<JournalDeliveryResult | undefined> {
    const collection = await this.getCollection();
    const claimed = await collection
      .find({ deliveryState: "processing", deliveryAttemptId: attemptId })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    if (claimed.length === 0) return undefined;

    const now = this.now();
    await collection.updateMany(
      { deliveryState: "processing", deliveryAttemptId: attemptId },
      {
        $set: {
          deliveryState: "undelivered",
          deliveryError: error.slice(0, 2_000),
          nextDeliveryAttemptAt: new Date(now.getTime() + JOURNAL_DELIVERY_RETRY_MS).toISOString(),
          updatedAt: now.toISOString(),
        },
        $unset: { deliveryAttemptId: "", deliveryClaimedAt: "" },
      },
    );

    return { journalDate: claimed[0].journalDate, recordCount: claimed.length };
  }

  async getDeliveryStatus(): Promise<JournalDeliveryStatus> {
    const collection = await this.getCollection();
    const records = await collection
      .find({
        deliveryState: { $in: ["undelivered", "processing"] },
        editingState: "idle",
        deletedAt: { $exists: false },
      })
      .sort({ journalDate: 1, createdAt: 1, _id: 1 })
      .toArray();
    const byDate = new Map<string, JournalDeliveryDateStatus>();

    for (const record of records) {
      const date = byDate.get(record.journalDate) ?? {
        journalDate: record.journalDate,
        pending: 0,
        processing: 0,
        failed: 0,
      };
      if (record.deliveryState === "processing") date.processing += 1;
      else date.pending += 1;
      if (record.deliveryError !== undefined) {
        date.failed += 1;
        date.lastError = record.deliveryError;
        if (record.nextDeliveryAttemptAt !== undefined) {
          date.nextAttemptAt = record.nextDeliveryAttemptAt;
        }
      }
      byDate.set(record.journalDate, date);
    }

    const dates = [...byDate.values()];
    return {
      pendingRecordCount: dates.reduce((sum, date) => sum + date.pending, 0),
      processingRecordCount: dates.reduce((sum, date) => sum + date.processing, 0),
      failedRecordCount: dates.reduce((sum, date) => sum + date.failed, 0),
      dates,
    };
  }

  async retryFailedDeliveries(): Promise<number> {
    const collection = await this.getCollection();
    const result = await collection.updateMany(
      {
        deliveryState: "undelivered",
        deliveryError: { $exists: true },
        deletedAt: { $exists: false },
      },
      { $set: { nextDeliveryAttemptAt: this.now().toISOString() } },
    );
    return result.modifiedCount ?? 0;
  }
}

export const journalStore = new JournalStore();
