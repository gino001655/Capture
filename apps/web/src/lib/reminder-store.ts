import webpush, { type PushSubscription } from "web-push";

import { getMongoClient, getMongoDatabaseName } from "./mongodb.ts";

export type ReminderSummary = {
  continuationCount: number;
  continuations: string[];
  journalCount: number;
};

type SubscriptionDocument = PushSubscription & {
  _id: string;
  email: string;
  includeContent: boolean;
  createdAt: string;
  updatedAt: string;
};

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export async function getReminderSummary(now = new Date()): Promise<ReminderSummary> {
  const client = await getMongoClient();
  const database = client.db(getMongoDatabaseName());
  const since = shiftDate(taipeiDate(now), -6);
  const records = await database.collection("journalRecords")
    .find({
      deliveryState: "delivered",
      deletedAt: { $exists: false },
      journalDate: { $gte: since },
    })
    .project<{ journalDate: string; areas?: { event?: string } }>({ journalDate: 1, areas: 1 })
    .sort({ journalDate: -1, createdAt: -1 })
    .toArray();
  const continuations = records
    .map((record) => record.areas?.event?.trim() ?? "")
    .filter(Boolean);
  return {
    continuationCount: continuations.length,
    continuations: continuations.slice(0, 3),
    journalCount: records.length,
  };
}

export async function savePushSubscription(
  email: string,
  subscription: PushSubscription,
  includeContent: boolean,
) {
  const client = await getMongoClient();
  const collection = client.db(getMongoDatabaseName()).collection<SubscriptionDocument>("pushSubscriptions");
  const timestamp = new Date().toISOString();
  await collection.updateOne(
    { _id: subscription.endpoint },
    {
      $setOnInsert: { createdAt: timestamp },
      $set: {
        email,
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: subscription.keys,
        includeContent,
        updatedAt: timestamp,
      },
    },
    { upsert: true },
  );
}

export async function removePushSubscription(email: string, endpoint: string) {
  const client = await getMongoClient();
  await client.db(getMongoDatabaseName())
    .collection<SubscriptionDocument>("pushSubscriptions")
    .deleteOne({ _id: endpoint, email });
}

export async function listPushSubscriptions() {
  const client = await getMongoClient();
  return client.db(getMongoDatabaseName()).collection<SubscriptionDocument>("pushSubscriptions")
    .find({}).toArray();
}

export async function sendScheduledPush(now = new Date()) {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const email = process.env.AUTHORIZED_EMAIL?.trim();
  if (!publicKey || !privateKey || !email) throw new Error("VAPID keys and AUTHORIZED_EMAIL are required.");
  webpush.setVapidDetails(`mailto:${email}`, publicKey, privateKey);
  const summary = await getReminderSummary(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(now);
  const weekly = weekday === "Sun";
  if (summary.continuationCount === 0 && (!weekly || summary.journalCount === 0)) {
    return { sent: 0, removed: 0, summary };
  }
  let sent = 0;
  let removed = 0;
  for (const subscription of await listPushSubscriptions()) {
    const title = summary.continuationCount > 0
      ? weekly ? "最近可以繼續，也來回顧一下" : "最近可以繼續"
      : "來回顧一下這週";
    const contentBody = summary.continuations.join("、")
      + (summary.continuationCount > 3 ? `，另有 ${summary.continuationCount - 3} 件` : "");
    const weeklySuffix = weekly && summary.journalCount > 0
      ? ` 最近七天有 ${summary.journalCount} 條紀錄。`
      : "";
    const body = subscription.includeContent && summary.continuationCount > 0
      ? contentBody + weeklySuffix
      : summary.continuationCount > 0
        ? `你有 ${summary.continuationCount} 件事情可以繼續。${weeklySuffix}`
        : `最近七天有 ${summary.journalCount} 條紀錄。`;
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: "/" }));
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removePushSubscription(subscription.email, subscription.endpoint);
        removed += 1;
      } else {
        throw error;
      }
    }
  }
  return { sent, removed, summary };
}
