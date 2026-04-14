ALTER TABLE "whatsapp_senders"
ADD COLUMN "active" boolean DEFAULT true NOT NULL;

ALTER TABLE "whatsapp_senders"
ADD COLUMN "preferred_top_count" integer DEFAULT 3 NOT NULL;

ALTER TABLE "whatsapp_senders"
ADD CONSTRAINT "whatsapp_senders_preferred_top_count_check"
CHECK ("preferred_top_count" IN (3, 5));
