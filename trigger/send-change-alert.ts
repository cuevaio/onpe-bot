import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { formatOnpeUpdateTimestamp } from "@/lib/onpe";
import { sendOnpeResultsImage } from "@/trigger/send-results-image";

export const sendOnpeChangeAlert = schemaTask({
  id: "send-onpe-change-alert",
  schema: z.object({
    updatedAt: z.number().int().nonnegative(),
  }),
  maxDuration: 300,
  run: async ({ updatedAt }) => {
    const formattedUpdatedAt = formatOnpeUpdateTimestamp(updatedAt);

    const sendResult = await sendOnpeResultsImage.triggerAndWait({
      caption: `Actualizacion ONPE: ${formattedUpdatedAt}`,
    });

    if (!sendResult.ok) {
      throw sendResult.error;
    }

    logger.info("Sent ONPE change alert", {
      updatedAt,
      recipients: sendResult.output.recipients,
      sentRecipients: sendResult.output.sentRecipients,
      skippedRecipients: sendResult.output.skippedRecipients,
      failedRecipients: sendResult.output.failedRecipients,
    });

    return {
      recipients: sendResult.output.recipients,
      sentRecipients: sendResult.output.sentRecipients,
      skippedRecipients: sendResult.output.skippedRecipients,
      failedRecipients: sendResult.output.failedRecipients,
      url: sendResult.output.url,
    };
  },
});
