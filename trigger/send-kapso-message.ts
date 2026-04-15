import { logger, schemaTask, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { env } from "@/env";
import {
  classifyKapsoError,
  getKapsoRetryDelayMs,
  isKapsoOutside24HourWindowError,
  serializeKapsoError,
} from "@/lib/kapso-errors";
import { kapsoClient } from "@/lib/kapso";
import { kapsoSendQueue } from "@/trigger/queues";

const MAX_KAPSO_SEND_ATTEMPTS = 5;

const sendKapsoMessagePayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    to: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    type: z.literal("image"),
    to: z.string().min(1),
    imageUrl: z.string().url(),
    caption: z.string().min(1),
  }),
]);

async function sendKapsoPayload(payload: z.infer<typeof sendKapsoMessagePayloadSchema>) {
  if (payload.type === "text") {
    await kapsoClient.messages.sendText({
      phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
      to: payload.to,
      body: payload.body,
    });

    return;
  }

  await kapsoClient.messages.sendImage({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    to: payload.to,
    image: {
      link: payload.imageUrl,
      caption: payload.caption,
    },
  });
}

export const sendKapsoMessage = schemaTask({
  id: "send-kapso-message",
  schema: sendKapsoMessagePayloadSchema,
  queue: kapsoSendQueue,
  maxDuration: 900,
  run: async (payload) => {
    for (let attempt = 1; attempt <= MAX_KAPSO_SEND_ATTEMPTS; attempt += 1) {
      try {
        await sendKapsoPayload(payload);

        logger.info("Kapso message sent", {
          type: payload.type,
          to: payload.to,
          attempt,
        });

        return {
          delivered: true,
          attempts: attempt,
          to: payload.to,
        };
      } catch (error) {
        const classification = classifyKapsoError(error);

        logger.error("Kapso message send failed", {
          type: payload.type,
          to: payload.to,
          attempt,
          classification,
          error: serializeKapsoError(error),
        });

        if (!classification.retryable || attempt === MAX_KAPSO_SEND_ATTEMPTS) {
          throw error;
        }

        const delayMs = getKapsoRetryDelayMs(classification, attempt);
        await wait.for({ seconds: Math.ceil(delayMs / 1_000) });
      }
    }

    throw new Error("Kapso message send exhausted retries");
  },
  catchError: async ({ payload, error }) => {
    if (!isKapsoOutside24HourWindowError(error)) {
      return;
    }

    logger.info("Skipping retries for Kapso message outside WhatsApp session window", {
      type: payload.type,
      to: payload.to,
      skipReason: "outside_session_window",
      error: serializeKapsoError(error),
    });

    return {
      skipRetrying: true,
    };
  },
});
