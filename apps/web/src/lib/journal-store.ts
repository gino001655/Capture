import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";
import type {
  JournalAreas,
  JournalCreateInput,
  JournalRecord,
  JournalUpdateInput,
} from "./journal-record.ts";
import { JOURNAL_AREA_KEYS } from "./journal-record.ts";

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
  findOneAndDelete(
    filter: Partial<JournalDocument>,
  ): Promise<JournalDocument | null>;
  find(filter: Partial<JournalDocument>): {
    sort(sort: Record<string, 1 | -1>): {
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

const JOURNAL_COLLECTION_NAME = "journalRecords";
const JOURNAL_DATE_NEWEST_FIRST_INDEX = {
  journalDate: 1,
  createdAt: -1,
  _id: 1,
} as const;
const JOURNAL_DATE_NEWEST_FIRST_INDEX_NAME = "journal_date_newest_first";

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
  const { _id, ...record } = document;
  return { id: _id, ...record };
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
    const deleted = await collection.findOneAndDelete({
      _id: id,
      revision: expectedRevision,
      deliveryState: "undelivered",
    });

    if (deleted !== null) return { kind: "deleted" };

    const current = await collection.findOne({ _id: id });
    if (current === null) return { kind: "missing" };
    if (current.deliveryState === "delivered") {
      return { kind: "locked", record: toJournalRecord(current) };
    }
    return { kind: "conflict", record: toJournalRecord(current) };
  }
}

export const journalStore = new JournalStore();
