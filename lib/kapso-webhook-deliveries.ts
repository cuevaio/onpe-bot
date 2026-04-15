import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { kapsoWebhookDeliveries } from "@/db/schema";

export async function registerWebhookDelivery(params: {
  idempotencyKey: string;
  eventType: string;
  phoneNumber: string;
  senderInsertedAtDelivery: boolean;
}) {
  const db = getDb();

  const insertedRows = await db
    .insert(kapsoWebhookDeliveries)
    .values({
      idempotencyKey: params.idempotencyKey,
      eventType: params.eventType,
      phoneNumber: params.phoneNumber,
      senderInsertedAtDelivery: params.senderInsertedAtDelivery,
    })
    .onConflictDoNothing()
    .returning({
      idempotencyKey: kapsoWebhookDeliveries.idempotencyKey,
      senderInsertedAtDelivery: kapsoWebhookDeliveries.senderInsertedAtDelivery,
    });

  if (insertedRows[0]) {
    return {
      duplicate: false,
      senderInsertedAtDelivery: insertedRows[0].senderInsertedAtDelivery,
    };
  }

  const existingDelivery = await db.query.kapsoWebhookDeliveries.findFirst({
    where: eq(kapsoWebhookDeliveries.idempotencyKey, params.idempotencyKey),
    columns: {
      senderInsertedAtDelivery: true,
    },
  });

  return {
    duplicate: true,
    senderInsertedAtDelivery: existingDelivery?.senderInsertedAtDelivery ?? false,
  };
}
