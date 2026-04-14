import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const whatsappSenders = pgTable("whatsapp_senders", {
  phoneNumber: text("phone_number").primaryKey(),
  registeredAt: timestamp("registered_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const kapsoWebhookDeliveries = pgTable("kapso_webhook_deliveries", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  eventType: text("event_type").notNull(),
  phoneNumber: text("phone_number"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
