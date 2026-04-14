import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { kapsoWebhookDeliveries, whatsappSenders } from "@/db/schema";
import { env } from "@/env";
import { kapsoClient } from "@/lib/kapso";
import { LATEST_RESULTS_IMAGE_URL } from "@/lib/onpe";

const RECEIVED_EVENT = "whatsapp.message.received";
const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

const onpeSendResultsImagePayloadSchema = z.object({
  recipients: z.array(z.string().min(1)).min(1).optional(),
  caption: z.string().min(1),
  imageUrl: z.string().url().optional(),
});

function normalizeTimestamp(value: Date | string | null) {
  if (!value) {
    return null;
  }

  const timestamp = value instanceof Date ? value : new Date(value);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

async function getBroadcastRecipients() {
  const db = getDb();
  const rows = await db
    .select({
      phoneNumber: whatsappSenders.phoneNumber,
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
    .groupBy(whatsappSenders.phoneNumber);

  const customerCareThreshold = Date.now() - CUSTOMER_CARE_WINDOW_MS;
  const activeRecipients: string[] = [];
  const skippedRecipients: string[] = [];

  for (const row of rows) {
    const lastReceivedAt = normalizeTimestamp(row.lastReceivedAt);

    if (lastReceivedAt && lastReceivedAt.getTime() >= customerCareThreshold) {
      activeRecipients.push(row.phoneNumber);
      continue;
    }

    skippedRecipients.push(row.phoneNumber);
  }

  return {
    allRecipients: rows.map((row) => row.phoneNumber),
    activeRecipients,
    skippedRecipients,
  };
}

export const sendOnpeResultsImage = schemaTask({
  id: "send-onpe-results-image",
  schema: onpeSendResultsImagePayloadSchema,
  maxDuration: 300,
  run: async ({ recipients, caption, imageUrl = LATEST_RESULTS_IMAGE_URL }) => {
    const resolvedRecipients = recipients
      ? {
          allRecipients: recipients,
          activeRecipients: recipients,
          skippedRecipients: [],
        }
      : await getBroadcastRecipients();
    const failedRecipients: string[] = [];

    for (const recipient of resolvedRecipients.activeRecipients) {
      try {
        await kapsoClient.messages.sendImage({
          phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
          to: recipient,
          image: {
            link: imageUrl,
            caption,
          },
        });
      } catch (error) {
        failedRecipients.push(recipient);

        logger.error("Failed to send ONPE results image", {
          recipient,
          url: imageUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Sent ONPE results image", {
      recipients: resolvedRecipients.allRecipients.length,
      sent: resolvedRecipients.activeRecipients.length - failedRecipients.length,
      skipped: resolvedRecipients.skippedRecipients.length,
      failed: failedRecipients.length,
      url: imageUrl,
    });

    return {
      recipients: resolvedRecipients.allRecipients.length,
      sentRecipients:
        resolvedRecipients.activeRecipients.length - failedRecipients.length,
      skippedRecipients: resolvedRecipients.skippedRecipients.length,
      failedRecipients: failedRecipients.length,
      url: imageUrl,
    };
  },
});
