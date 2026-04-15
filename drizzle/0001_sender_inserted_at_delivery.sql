ALTER TABLE "kapso_webhook_deliveries"
ADD COLUMN "sender_inserted_at_delivery" boolean DEFAULT false NOT NULL;
