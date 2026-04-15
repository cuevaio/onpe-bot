import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import type { OnpeTopCount } from "@/lib/cache";
import { isKapsoOutside24HourWindowError } from "@/lib/kapso-errors";
import { ensureLatestOnpeImageUrl } from "@/lib/onpe-images";
import { getActiveBroadcastRecipients, getRecipientStates } from "@/lib/whatsapp-senders";
import { sendKapsoMessage } from "@/trigger/send-kapso-message";

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

const SEND_IMAGE_BATCH_SIZE = 100;

function createTopCountMetrics() {
  return {
    3: { recipients: 0, sentRecipients: 0, skippedRecipients: 0, failedRecipients: 0 },
    5: { recipients: 0, sentRecipients: 0, skippedRecipients: 0, failedRecipients: 0 },
  } satisfies Record<OnpeTopCount, {
    recipients: number;
    sentRecipients: number;
    skippedRecipients: number;
    failedRecipients: number;
  }>;
}

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
  const skippedRecipients: string[] = [];

  for (const recipientsBatch of chunkRecipients(
    params.recipients,
    SEND_IMAGE_BATCH_SIZE,
  )) {
    const result = await sendKapsoMessage.batchTriggerAndWait(
      recipientsBatch.map((recipient) => ({
        payload: {
          type: "image" as const,
          to: recipient,
          imageUrl: params.imageUrl,
          caption: params.caption,
        },
      })),
    );

    for (const [index, run] of result.runs.entries()) {
      const recipient = recipientsBatch[index];

      if (run.ok) {
        if (!run.output?.delivered) {
          skippedRecipients.push(recipient);

          logger.info("Skipped ONPE results image outside WhatsApp session window", {
            recipient,
            url: params.imageUrl,
            skipReason: "outside_session_window",
            output: run.output,
          });
        }

        continue;
      }

      if (isKapsoOutside24HourWindowError(run.error)) {
        skippedRecipients.push(recipient);

        logger.info("Skipped ONPE results image outside WhatsApp session window", {
          recipient,
          url: params.imageUrl,
          skipReason: "outside_session_window",
          error: run.error,
        });

        continue;
      }

      failedRecipients.push(recipient);

      logger.error("Failed to send ONPE results image", {
        recipient,
        url: params.imageUrl,
        error: run.error,
      });
    }
  }

  return {
    failedRecipients,
    skippedRecipients,
  };
}

export const sendOnpeResultsImage = schemaTask({
  id: "send-onpe-results-image",
  schema: onpeSendResultsImagePayloadSchema,
  maxDuration: 900,
  run: async ({ recipients, caption, imageUrl, topCount, imageUrlsByTopCount }) => {
    const failedRecipients: string[] = [];
    const skippedRecipients: string[] = [];
    const metricsByTopCount = createTopCountMetrics();

    if (recipients) {
      const recipientStates = await getRecipientStates(recipients);

      if (!topCount && recipientStates.length > 1) {
        throw new Error(
          "Explicit recipient sends with multiple recipients must provide topCount",
        );
      }

      const recipientTopCount = topCount ?? recipientStates[0]?.preferredTopCount ?? 3;
      const resolvedImageUrl = imageUrl ?? (await ensureLatestOnpeImageUrl(recipientTopCount));

      const batchResult = await sendImageBatch({
        recipients,
        caption,
        imageUrl: resolvedImageUrl,
      });
      failedRecipients.push(...batchResult.failedRecipients);
      skippedRecipients.push(...batchResult.skippedRecipients);
      metricsByTopCount[recipientTopCount] = {
        recipients: recipients.length,
        sentRecipients: recipients.length - batchResult.failedRecipients.length - batchResult.skippedRecipients.length,
        skippedRecipients: batchResult.skippedRecipients.length,
        failedRecipients: batchResult.failedRecipients.length,
      };

      logger.info("Sent ONPE results image", {
        recipients: recipients.length,
        sent: recipients.length - failedRecipients.length - skippedRecipients.length,
        skipped: skippedRecipients.length,
        failed: failedRecipients.length,
        url: resolvedImageUrl,
        topCount: recipientTopCount,
        metricsByTopCount,
      });

      return {
        recipients: recipients.length,
        sentRecipients: recipients.length - failedRecipients.length - skippedRecipients.length,
        skippedRecipients: skippedRecipients.length,
        failedRecipients: failedRecipients.length,
        url: resolvedImageUrl,
        metricsByTopCount,
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
      const batchResult = await sendImageBatch({
        recipients: recipientsForTopCount,
        caption,
        imageUrl: resolvedImageUrl,
      });
      failedRecipients.push(...batchResult.failedRecipients);
      skippedRecipients.push(...batchResult.skippedRecipients);
      metricsByTopCount[currentTopCount] = {
        recipients: recipientsForTopCount.length,
        sentRecipients:
          recipientsForTopCount.length -
          batchResult.failedRecipients.length -
          batchResult.skippedRecipients.length,
        skippedRecipients: batchResult.skippedRecipients.length,
        failedRecipients: batchResult.failedRecipients.length,
      };
    }

    const skippedRecipientsFromWindow = skippedRecipients.length;
    const recipientStates = await getRecipientStates(resolvedRecipients.skippedRecipients);

    for (const recipientState of recipientStates) {
      metricsByTopCount[recipientState.preferredTopCount].recipients += 1;
      metricsByTopCount[recipientState.preferredTopCount].skippedRecipients += 1;
    }

    logger.info("Sent ONPE results image", {
      recipients: resolvedRecipients.allRecipients.length,
      sent:
        resolvedRecipients.groupedRecipients[3].length +
        resolvedRecipients.groupedRecipients[5].length -
        failedRecipients.length -
        skippedRecipients.length,
      skipped: resolvedRecipients.skippedRecipients.length + skippedRecipients.length,
      failed: failedRecipients.length,
      urlsByTopCount: Object.fromEntries(sentUrls),
      metricsByTopCount,
      skippedRecipientsFromWindow,
    });

    return {
      recipients: resolvedRecipients.allRecipients.length,
      sentRecipients:
        resolvedRecipients.groupedRecipients[3].length +
        resolvedRecipients.groupedRecipients[5].length -
        failedRecipients.length -
        skippedRecipients.length,
      skippedRecipients: resolvedRecipients.skippedRecipients.length + skippedRecipients.length,
      failedRecipients: failedRecipients.length,
      url: sentUrls.get(3) ?? sentUrls.get(5) ?? null,
      metricsByTopCount,
    };
  },
});
