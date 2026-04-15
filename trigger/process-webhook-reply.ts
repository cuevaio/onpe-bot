import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import {
  parseDeterministicCommand,
  type DeterministicCommandAction,
} from "@/lib/whatsapp-command-router";
import { handleInboundMessageWithAgent } from "@/lib/whatsapp-agent";
import { kapsoClient } from "@/lib/kapso";
import { executeWhatsappAction, sendWelcome } from "@/lib/whatsapp-tools";
import { getSenderState } from "@/lib/whatsapp-senders";
import { env } from "@/env";

const executableActionSchema = z.union([
  z.object({ type: z.literal("pause_updates") }),
  z.object({ type: z.literal("resume_updates"), topCount: z.union([z.literal(3), z.literal(5)]) }),
  z.object({ type: z.literal("send_latest_chart"), topCount: z.union([z.literal(3), z.literal(5)]) }),
  z.object({
    type: z.literal("set_chart_preference"),
    topCount: z.union([z.literal(3), z.literal(5)]),
  }),
  z.object({ type: z.literal("send_help") }),
]);

const processWebhookReplyPayloadSchema = z.object({
  idempotencyKey: z.string().min(1),
  phoneNumber: z.string().min(1),
  providerMessageId: z.string().nullable(),
  conversationId: z.string().nullable(),
  mergedInboundText: z.string(),
  senderInsertedAtDelivery: z.boolean(),
  action: executableActionSchema.nullable(),
});

type ConversationMessage = Parameters<typeof handleInboundMessageWithAgent>[0]["recentMessages"][number];
type NormalizedKapsoConversationMessage = {
  kapso?: {
    direction?: "inbound" | "outbound";
  };
  body?: string;
  content?: string;
  message?: {
    text?: string;
    body?: string;
  };
  text?: { body?: unknown };
  image?: { caption?: unknown };
  video?: { caption?: unknown };
  document?: { caption?: unknown };
};

function readMessageText(message: Record<string, unknown>) {
  if (typeof message.body === "string" && message.body.trim() !== "") {
    return message.body.trim();
  }

  if (typeof message.content === "string" && message.content.trim() !== "") {
    return message.content.trim();
  }

  const nestedMessage =
    typeof message.message === "object" && message.message !== null
      ? (message.message as { text?: unknown; body?: unknown })
      : undefined;

  if (typeof nestedMessage?.text === "string" && nestedMessage.text.trim() !== "") {
    return nestedMessage.text.trim();
  }

  if (typeof nestedMessage?.body === "string" && nestedMessage.body.trim() !== "") {
    return nestedMessage.body.trim();
  }

  const text =
    typeof message.text === "object" && message.text !== null
      ? (message.text as { body?: unknown }).body
      : undefined;

  if (typeof text === "string" && text.trim() !== "") {
    return text.trim();
  }

  const imageCaption =
    typeof message.image === "object" && message.image !== null
      ? (message.image as { caption?: unknown }).caption
      : undefined;

  if (typeof imageCaption === "string" && imageCaption.trim() !== "") {
    return imageCaption.trim();
  }

  const videoCaption =
    typeof message.video === "object" && message.video !== null
      ? (message.video as { caption?: unknown }).caption
      : undefined;

  if (typeof videoCaption === "string" && videoCaption.trim() !== "") {
    return videoCaption.trim();
  }

  const documentCaption =
    typeof message.document === "object" && message.document !== null
      ? (message.document as { caption?: unknown }).caption
      : undefined;

  if (typeof documentCaption === "string" && documentCaption.trim() !== "") {
    return documentCaption.trim();
  }

  return "";
}

async function getConversationHistory(conversationId: string) {
  const response = await kapsoClient.messages.listByConversation({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    conversationId,
    limit: 12,
    fields: "kapso(default)",
  });

  const messages: ConversationMessage[] = response.data
    .flatMap((message) => {
      const conversationMessage = message as NormalizedKapsoConversationMessage;

      if (
        conversationMessage.kapso?.direction !== "inbound" &&
        conversationMessage.kapso?.direction !== "outbound"
      ) {
        return [];
      }

      return [
        {
          direction: conversationMessage.kapso.direction,
          text: readMessageText(conversationMessage as Record<string, unknown>),
        } satisfies ConversationMessage,
      ];
    })
    .filter((message) => message.text.length > 0);

  return messages;
}

function toExecutableAction(action: DeterministicCommandAction, senderTopCount: 3 | 5) {
  switch (action.type) {
    case "pause_updates":
      return action;
    case "resume_updates":
      return { type: "resume_updates", topCount: senderTopCount } as const;
    case "send_latest_chart":
      return { type: "send_latest_chart", topCount: senderTopCount } as const;
    case "set_chart_preference":
      return action;
    case "send_help":
      return action;
    case "none":
      return action;
  }
}

export const processKapsoWebhookReply = schemaTask({
  id: "process-kapso-webhook-reply",
  schema: processWebhookReplyPayloadSchema,
  maxDuration: 900,
  run: async (payload) => {
    if (payload.senderInsertedAtDelivery) {
      await sendWelcome(payload.phoneNumber);

      logger.info("Processed Kapso webhook welcome reply", {
        idempotencyKey: payload.idempotencyKey,
        phoneNumber: payload.phoneNumber,
        providerMessageId: payload.providerMessageId,
      });

      return { status: "welcome_sent" };
    }

    if (!payload.mergedInboundText) {
      logger.info("Skipped empty Kapso webhook reply", {
        idempotencyKey: payload.idempotencyKey,
        phoneNumber: payload.phoneNumber,
        providerMessageId: payload.providerMessageId,
      });

      return { status: "skipped_empty_message" };
    }

    const senderState = await getSenderState(payload.phoneNumber);

    if (!senderState) {
      throw new Error(`Sender state not found for ${payload.phoneNumber}`);
    }

    const recentMessages: ConversationMessage[] = payload.conversationId
      ? await getConversationHistory(payload.conversationId)
      : [{ direction: "inbound" as const, text: payload.mergedInboundText }];

    let executableAction = payload.action;

    if (!executableAction) {
      const deterministicAction = parseDeterministicCommand(payload.mergedInboundText);
      let finalAction = deterministicAction;

      if (deterministicAction.type === "none") {
        finalAction = await handleInboundMessageWithAgent({
          phoneNumber: payload.phoneNumber,
          senderState,
          currentMessage: payload.mergedInboundText,
          recentMessages,
        });
      }

      const resolvedAction = toExecutableAction(finalAction, senderState.preferredTopCount);

      executableAction = resolvedAction.type === "none" ? null : resolvedAction;
    }

    if (!executableAction) {
      logger.info("No Kapso webhook action selected", {
        idempotencyKey: payload.idempotencyKey,
        phoneNumber: payload.phoneNumber,
        providerMessageId: payload.providerMessageId,
      });

      return { status: "no_action_selected" };
    }

    await executeWhatsappAction({
      phoneNumber: payload.phoneNumber,
      action: executableAction,
    });

    logger.info("Processed Kapso webhook action", {
      idempotencyKey: payload.idempotencyKey,
      phoneNumber: payload.phoneNumber,
      providerMessageId: payload.providerMessageId,
      action: executableAction,
    });

    return { status: "action_executed", action: executableAction.type };
  },
});
