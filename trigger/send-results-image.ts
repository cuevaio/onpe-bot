import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { env } from "@/env";
import type { OnpeTopCount } from "@/lib/cache";
import { ensureLatestOnpeImageUrl } from "@/lib/onpe-images";
import { kapsoClient } from "@/lib/kapso";
import { getActiveBroadcastRecipients, getRecipientStates } from "@/lib/whatsapp-senders";

const onpeSendResultsImagePayloadSchema = z.object({
  recipients: z.array(z.string().min(1)).min(1).optional(),
  caption: z.string().min(1),
  imageUrl: z.string().url().optional(),
  topCount: z.union([z.literal(3), z.literal(5)]).optional(),
  imageUrlsByTopCount: z
    .object({
      3: z.string().url().optional(),
      5: z.string().url().optional(),
    })
    .optional(),
});

const SEND_IMAGE_BATCH_SIZE = 10;

function chunkRecipients(recipients: string[], size: number) {
  const batches: string[][] = [];

  for (let index = 0; index < recipients.length; index += size) {
    batches.push(recipients.slice(index, index + size));
  }

  return batches;
}

async function sendImageBatch(params: {
  recipients: string[];
  caption: string;
  imageUrl: string;
}) {
  const failedRecipients: string[] = [];

  for (const recipientsBatch of chunkRecipients(
    params.recipients,
    SEND_IMAGE_BATCH_SIZE,
  )) {
    const results = await Promise.allSettled(
      recipientsBatch.map((recipient) =>
        kapsoClient.messages.sendImage({
          phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
          to: recipient,
          image: {
            link: params.imageUrl,
            caption: params.caption,
          },
        }),
      ),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        continue;
      }

      const recipient = recipientsBatch[index];
      failedRecipients.push(recipient);

      logger.error("Failed to send ONPE results image", {
        recipient,
        url: params.imageUrl,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  return failedRecipients;
}

export const sendOnpeResultsImage = schemaTask({
  id: "send-onpe-results-image",
  schema: onpeSendResultsImagePayloadSchema,
  maxDuration: 900,
  run: async ({ recipients, caption, imageUrl, topCount, imageUrlsByTopCount }) => {
    const failedRecipients: string[] = [];

    if (recipients) {
      const recipientStates = await getRecipientStates(recipients);

      if (!topCount && recipientStates.length > 1) {
        throw new Error(
          "Explicit recipient sends with multiple recipients must provide topCount",
        );
      }

      const recipientTopCount = topCount ?? recipientStates[0]?.preferredTopCount ?? 3;
      const resolvedImageUrl = imageUrl ?? (await ensureLatestOnpeImageUrl(recipientTopCount));

      failedRecipients.push(
        ...(await sendImageBatch({
          recipients,
          caption,
          imageUrl: resolvedImageUrl,
        })),
      );

      logger.info("Sent ONPE results image", {
        recipients: recipients.length,
        sent: recipients.length - failedRecipients.length,
        skipped: 0,
        failed: failedRecipients.length,
        url: resolvedImageUrl,
        topCount: recipientTopCount,
      });

      return {
        recipients: recipients.length,
        sentRecipients: recipients.length - failedRecipients.length,
        skippedRecipients: 0,
        failedRecipients: failedRecipients.length,
        url: resolvedImageUrl,
      };
    }

    const resolvedRecipients = await getActiveBroadcastRecipients();
    const sentUrls = new Map<OnpeTopCount, string>();

    for (const currentTopCount of [3, 5] as const) {
      const recipientsForTopCount = resolvedRecipients.groupedRecipients[currentTopCount];

      if (recipientsForTopCount.length === 0) {
        continue;
      }

      const resolvedImageUrl =
        imageUrl ??
        imageUrlsByTopCount?.[currentTopCount] ??
        (await ensureLatestOnpeImageUrl(currentTopCount));
      sentUrls.set(currentTopCount, resolvedImageUrl);
      failedRecipients.push(
        ...(await sendImageBatch({
          recipients: recipientsForTopCount,
          caption,
          imageUrl: resolvedImageUrl,
        })),
      );
    }

    logger.info("Sent ONPE results image", {
      recipients: resolvedRecipients.allRecipients.length,
      sent:
        resolvedRecipients.groupedRecipients[3].length +
        resolvedRecipients.groupedRecipients[5].length -
        failedRecipients.length,
      skipped: resolvedRecipients.skippedRecipients.length,
      failed: failedRecipients.length,
      urls: Object.fromEntries(sentUrls),
    });

    return {
      recipients: resolvedRecipients.allRecipients.length,
      sentRecipients:
        resolvedRecipients.groupedRecipients[3].length +
        resolvedRecipients.groupedRecipients[5].length -
        failedRecipients.length,
      skippedRecipients: resolvedRecipients.skippedRecipients.length,
      failedRecipients: failedRecipients.length,
      url: sentUrls.get(3) ?? sentUrls.get(5) ?? null,
    };
  },
});
