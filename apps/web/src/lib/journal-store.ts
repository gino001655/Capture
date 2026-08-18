import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type {
  JournalCreateInput,
  JournalRecord,
  JournalUpdateInput,
} from "./journal-record.ts";

export type JournalDocument = Omit<JournalRecord, "id"> & {
  _id: string;
};

type JournalUpdate = {
  $setOnInsert?: JournalDocument;
  $set?: Partial<JournalDocument>;
  $inc?: { revision: number };
};

export type JournalCollection = {
  createIndex(
    keys: Record<string, 1 | -1>,
    options: { name: string },
  ): Promise<string>;
  updateOne(
    filter: Partial<JournalDocument>,
    update: JournalUpdate,
    options?: { upsert?: boolean },
  ): Promise<unknown>;
  findOne(filter: Partial<JournalDocument>): Promise<JournalDocument | null>;
  findOneAndUpdate(
    filter: Partial<JournalDocument>,
    update: JournalUpdate,
    options: { returnDocument: "after" },
  ): Promise<JournalDocument | null>;
  find(filter: Partial<JournalDocument>): {
    sort(sort: Record<string, 1 | -1>): {
      toArray(): Promise<JournalDocument[]>;
    };
  };
};

type JournalCollectionProvider = () => Promise<JournalCollection>;

type JournalStoreOptions = {
  now?: () => Date;
};

export type JournalUpdateOutcome =
  | { kind: "updated"; record: JournalRecord }
  | { kind: "conflict"; record: JournalRecord; current: JournalRecord }
  | { kind: "locked"; record: JournalRecord }
  | { kind: "notFound" };

let journalIndexPromise: Promise<string> | undefined;

async function getMongoJournalCollection(): Promise<JournalCollection> {
  const client = await getMongoClient();
  const collection = client
    .db(getMongoDatabaseName())
    .collection<JournalDocument>("journalRecords");

  journalIndexPromise ??= collection.createIndex(
    { journalDate: 1, createdAt: -1, _id: 1 },
    { name: "journal_date_newest_first" },
  );
  await journalIndexPromise;

  return collection;
}

function toJournalRecord(document: JournalDocument): JournalRecord {
  const { _id, ...record } = document;
  return { id: _id, ...record };
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
      .find({ journalDate })
      .sort({ createdAt: -1, _id: 1 })
      .toArray();

    return documents.map(toJournalRecord);
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
    if (current.deliveryState === "delivered") {
      return { kind: "locked", record: currentRecord };
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

    return {
      kind: "conflict",
      record: toJournalRecord(conflict),
      current: currentRecord,
    };
  }
}

export const journalStore = new JournalStore();
