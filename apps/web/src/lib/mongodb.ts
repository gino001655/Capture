import { MongoClient } from "mongodb";

const globalMongo = globalThis as typeof globalThis & {
  captureMongoClientPromise?: Promise<MongoClient>;
};

let productionClientPromise: Promise<MongoClient> | undefined;

function requireEnvironmentVariable(name: "MONGODB_URI" | "MONGODB_DB") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be set in the server environment.`);
  }

  return value;
}

export function getMongoDatabaseName() {
  return requireEnvironmentVariable("MONGODB_DB");
}

export function getMongoClient() {
  if (process.env.NODE_ENV !== "production") {
    globalMongo.captureMongoClientPromise ??= new MongoClient(
      requireEnvironmentVariable("MONGODB_URI"),
    ).connect();

    return globalMongo.captureMongoClientPromise;
  }

  productionClientPromise ??= new MongoClient(
    requireEnvironmentVariable("MONGODB_URI"),
  ).connect();

  return productionClientPromise;
}
