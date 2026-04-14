import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { kapsoWebhookDeliveries, whatsappSenders } from "@/db/schema";
import type { OnpeTopCount } from "@/lib/cache";

const RECEIVED_EVENT = "whatsapp.message.received";
const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SenderState = {
  phoneNumber: string;
  active: boolean;
  preferredTopCount: OnpeTopCount;
};

function normalizeTopCount(value: number): OnpeTopCount {
  return value === 5 ? 5 : 3;
}

function normalizeTimestamp(value: Date | string | null) {
  if (!value) {
    return null;
  }

  const timestamp = value instanceof Date ? value : new Date(value);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

export async function getSenderState(phoneNumber: string): Promise<SenderState | null> {
  const db = getDb();
  const row = await db.query.whatsappSenders.findFirst({
    where: eq(whatsappSenders.phoneNumber, phoneNumber),
  });

  if (!row) {
    return null;
  }

  return {
    phoneNumber: row.phoneNumber,
    active: row.active,
    preferredTopCount: normalizeTopCount(row.preferredTopCount),
  };
}

export async function setSenderActive(phoneNumber: string, active: boolean) {
  const db = getDb();

  await db
    .update(whatsappSenders)
    .set({ active })
    .where(eq(whatsappSenders.phoneNumber, phoneNumber));
}

export async function setSenderTopCount(phoneNumber: string, preferredTopCount: OnpeTopCount) {
  const db = getDb();

  await db
    .update(whatsappSenders)
    .set({ preferredTopCount })
    .where(eq(whatsappSenders.phoneNumber, phoneNumber));
}

export async function getRecipientStates(phoneNumbers: string[]) {
  if (phoneNumbers.length === 0) {
    return [] satisfies SenderState[];
  }

  const db = getDb();
  const rows = await db.query.whatsappSenders.findMany({
    where: inArray(whatsappSenders.phoneNumber, phoneNumbers),
    orderBy: desc(whatsappSenders.registeredAt),
  });

  return rows.map((row) => ({
    phoneNumber: row.phoneNumber,
    active: row.active,
    preferredTopCount: normalizeTopCount(row.preferredTopCount),
  }));
}

export async function getActiveBroadcastRecipients() {
  const db = getDb();
  const rows = await db
    .select({
      phoneNumber: whatsappSenders.phoneNumber,
      preferredTopCount: whatsappSenders.preferredTopCount,
      lastReceivedAt: sql<Date | string | null>`max(${kapsoWebhookDeliveries.receivedAt})`,
    })
    .from(whatsappSenders)
    .leftJoin(
      kapsoWebhookDeliveries,
      and(
        eq(kapsoWebhookDeliveries.phoneNumber, whatsappSenders.phoneNumber),
        eq(kapsoWebhookDeliveries.eventType, RECEIVED_EVENT),
      ),
    )
    .where(eq(whatsappSenders.active, true))
    .groupBy(whatsappSenders.phoneNumber, whatsappSenders.preferredTopCount);

  const customerCareThreshold = Date.now() - CUSTOMER_CARE_WINDOW_MS;
  const groupedRecipients: Record<OnpeTopCount, string[]> = {
    3: [],
    5: [],
  };
  const skippedRecipients: string[] = [];

  for (const row of rows) {
    const lastReceivedAt = normalizeTimestamp(row.lastReceivedAt);

    if (lastReceivedAt && lastReceivedAt.getTime() >= customerCareThreshold) {
      groupedRecipients[normalizeTopCount(row.preferredTopCount)].push(
        row.phoneNumber,
      );
      continue;
    }

    skippedRecipients.push(row.phoneNumber);
  }

  return {
    allRecipients: rows.map((row) => row.phoneNumber),
    groupedRecipients,
    skippedRecipients,
  };
}
