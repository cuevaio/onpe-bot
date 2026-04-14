import { createHmac, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import { normalizeWebhook } from "@kapso/whatsapp-cloud-api/server";

import { getDb } from "@/db";
import { env } from "@/env";
import {
  parseDeterministicCommand,
  type DeterministicCommandAction,
} from "@/lib/whatsapp-command-router";
import { handleInboundMessageWithAgent } from "@/lib/whatsapp-agent";
import { kapsoClient } from "@/lib/kapso";
import { getSenderState } from "@/lib/whatsapp-senders";
import { executeWhatsappAction, sendWelcome } from "@/lib/whatsapp-tools";

type ConversationMessage = Parameters<typeof handleInboundMessageWithAgent>[0]["recentMessages"][number];
type NormalizedKapsoMessage = {
  id?: string;
  messageId?: string;
  type?: string;
  body?: string;
  content?: string;
  message?: {
    text?: string;
    body?: string;
  };
  from?: string;
  text?: { body?: unknown };
  image?: { caption?: unknown };
  video?: { caption?: unknown };
  document?: { caption?: unknown };
  kapso?: {
    direction?: "inbound" | "outbound";
    whatsappConversationId?: string;
  };
};

export const runtime = "nodejs";

const RECEIVED_EVENT = "whatsapp.message.received";

type KapsoMessageReceivedPayload = {
  message?: {
    id?: string;
    type?: string;
    text?: { body?: unknown };
    image?: { caption?: unknown };
    video?: { caption?: unknown };
    document?: { caption?: unknown };
    kapso?: {
      direction?: "inbound" | "outbound";
      content?: string;
      whatsappConversationId?: string;
    };
  };
  conversation?: {
    id?: string;
    phone_number?: string;
  };
};

function verifySignature(rawBody: string, signature: string, secret: string) {
	const expectedSignature = createHmac("sha256", secret)
		.update(rawBody)
		.digest("hex");

	const receivedSignature = Buffer.from(signature, "hex");
	const expectedSignatureBuffer = Buffer.from(expectedSignature, "hex");

	if (receivedSignature.length !== expectedSignatureBuffer.length) {
		return false;
	}

	return timingSafeEqual(receivedSignature, expectedSignatureBuffer);
}

async function registerSender(params: {
	idempotencyKey: string;
	eventType: string;
	phoneNumber: string;
}) {
	const db = getDb();

	const result = await db.execute(sql<{
		deliveryInserted: boolean;
		senderInserted: boolean;
	}>`
    WITH inserted_delivery AS (
      INSERT INTO ${sql.identifier("kapso_webhook_deliveries")} (
        ${sql.identifier("idempotency_key")},
        ${sql.identifier("event_type")},
        ${sql.identifier("phone_number")}
      )
      VALUES (${params.idempotencyKey}, ${params.eventType}, ${params.phoneNumber})
      ON CONFLICT ("idempotency_key") DO NOTHING
      RETURNING 1
    ),
    inserted_sender AS (
      INSERT INTO ${sql.identifier("whatsapp_senders")} (${sql.identifier("phone_number")})
      SELECT ${params.phoneNumber}
      WHERE EXISTS (SELECT 1 FROM inserted_delivery)
      ON CONFLICT ("phone_number") DO NOTHING
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM inserted_delivery) AS "deliveryInserted",
      EXISTS (SELECT 1 FROM inserted_sender) AS "senderInserted"
  `);

	const row = result.rows[0];

	return {
		duplicate: !row?.deliveryInserted,
		senderInserted: Boolean(row?.senderInserted),
	};
}

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

function normalizePhoneNumber(value: string | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function getPayloadMessage(payload: KapsoMessageReceivedPayload) {
  return payload.message ?? null;
}

function getPayloadMessageText(payload: KapsoMessageReceivedPayload) {
  const message = getPayloadMessage(payload);

  if (!message) {
    return "";
  }

  return readMessageText(message as Record<string, unknown>);
}

function getPayloadProviderMessageId(payload: KapsoMessageReceivedPayload) {
  return typeof payload.message?.id === "string" && payload.message.id.trim() !== ""
    ? payload.message.id.trim()
    : null;
}

function getPayloadConversationId(payload: KapsoMessageReceivedPayload) {
  if (typeof payload.conversation?.id === "string" && payload.conversation.id.trim() !== "") {
    return payload.conversation.id.trim();
  }

  if (
    typeof payload.message?.kapso?.whatsappConversationId === "string" &&
    payload.message.kapso.whatsappConversationId.trim() !== ""
  ) {
    return payload.message.kapso.whatsappConversationId.trim();
  }

  return null;
}

function summarizePayloadMessage(payload: KapsoMessageReceivedPayload) {
  if (!payload.message) {
    return null;
  }

  return {
    id: payload.message.id ?? null,
    type: payload.message.type ?? null,
    kapsoDirection: payload.message.kapso?.direction ?? null,
    kapsoContent: payload.message.kapso?.content ?? null,
    whatsappConversationId: payload.message.kapso?.whatsappConversationId ?? null,
    textBody: payload.message.text?.body ?? null,
    imageCaption: payload.message.image?.caption ?? null,
    videoCaption: payload.message.video?.caption ?? null,
    documentCaption: payload.message.document?.caption ?? null,
  };
}

function getCurrentInboundMessage(
  phoneNumber: string,
  messages: NormalizedKapsoMessage[],
) {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const inboundMessages = messages.filter(
    (message) => message.kapso?.direction === "inbound",
  );
  const exactPhoneMatch = inboundMessages.filter(
    (message) =>
      normalizePhoneNumber(
        typeof message.from === "string" ? message.from : undefined,
      ) === normalizedPhoneNumber,
  );
  const source = exactPhoneMatch.length > 0 ? exactPhoneMatch : inboundMessages;

  return source.at(-1) ?? null;
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
			if (
				message.kapso?.direction !== "inbound" &&
				message.kapso?.direction !== "outbound"
			) {
				return [];
			}

			return [
				{
					direction: message.kapso.direction,
					text: readMessageText(message),
				} satisfies ConversationMessage,
			];
		})
		.filter((message) => message.text.length > 0);

	return messages;
}

function getProviderMessageId(message: NormalizedKapsoMessage | null) {
  if (typeof message?.messageId === "string" && message.messageId.trim() !== "") {
    return message.messageId.trim();
  }

  return typeof message?.id === "string" && message.id.trim() !== ""
    ? message.id.trim()
    : null;
}

function logWebhookEvent(event: string, metadata: Record<string, unknown>) {
  console.info(`[kapso-webhook] ${event}`, metadata);
}

function summarizeNormalizedMessage(message: NormalizedKapsoMessage | null) {
  if (!message) {
    return null;
  }

  return {
    id: message.id ?? null,
    messageId: message.messageId ?? null,
    type: message.type ?? null,
    from: message.from ?? null,
    kapsoDirection: message.kapso?.direction ?? null,
    whatsappConversationId: message.kapso?.whatsappConversationId ?? null,
    body: message.body ?? null,
    content: message.content ?? null,
    nestedMessageText: message.message?.text ?? null,
    nestedMessageBody: message.message?.body ?? null,
    textBody: message.text?.body ?? null,
    imageCaption: message.image?.caption ?? null,
    videoCaption: message.video?.caption ?? null,
    documentCaption: message.document?.caption ?? null,
    keys: Object.keys(message),
  };
}

function toExecutableAction(
  action: DeterministicCommandAction,
  senderTopCount: 3 | 5,
) {
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

export async function POST(request: Request) {
	const signature = request.headers.get("x-webhook-signature")?.trim();
	const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
	const eventType = request.headers.get("x-webhook-event")?.trim();

	if (!signature || !idempotencyKey || !eventType) {
		return new Response("Missing required webhook headers", { status: 400 });
	}

	const rawBody = await request.text();

	if (!verifySignature(rawBody, signature, env.KAPSO_WEBHOOK_SECRET)) {
		return new Response("Invalid signature", { status: 401 });
	}

	if (eventType !== RECEIVED_EVENT) {
		return new Response("Ignored", { status: 200 });
	}

	let payload: KapsoMessageReceivedPayload;

	try {
		payload = JSON.parse(rawBody) as KapsoMessageReceivedPayload;
	} catch {
		return new Response("Invalid JSON payload", { status: 400 });
	}

	const phoneNumber = payload.conversation?.phone_number?.trim();

	if (!phoneNumber) {
		return new Response("Missing conversation.phone_number", { status: 400 });
	}

	try {
		const registration = await registerSender({
			idempotencyKey,
			eventType,
			phoneNumber,
		});
		const normalized = normalizeWebhook(JSON.parse(rawBody));
		const normalizedMessages = normalized.messages as NormalizedKapsoMessage[];
		const fallbackCurrentMessage = getCurrentInboundMessage(
			phoneNumber,
			normalizedMessages,
		);
		const currentMessageText =
			getPayloadMessageText(payload) ||
			(fallbackCurrentMessage ? readMessageText(fallbackCurrentMessage) : "");
		const providerMessageId =
			getPayloadProviderMessageId(payload) || getProviderMessageId(fallbackCurrentMessage);
		const conversationId =
			getPayloadConversationId(payload) ||
			fallbackCurrentMessage?.kapso?.whatsappConversationId ||
			null;

		logWebhookEvent("received", {
			idempotencyKey,
			eventType,
			phoneNumber,
			providerMessageId,
			duplicate: registration.duplicate,
			senderInserted: registration.senderInserted,
			currentMessageText,
			payloadMessageSummary: summarizePayloadMessage(payload),
			currentMessageSummary: summarizeNormalizedMessage(fallbackCurrentMessage),
		});

		if (registration.senderInserted) {
			await sendWelcome(phoneNumber);
			logWebhookEvent("welcome_sent", {
				idempotencyKey,
				phoneNumber,
				providerMessageId,
			});
		}

		if (registration.duplicate) {
			logWebhookEvent("skipped_duplicate", {
				idempotencyKey,
				phoneNumber,
				providerMessageId,
			});
			return new Response("OK", { status: 200 });
		}

		const senderState = await getSenderState(phoneNumber);

		if (!senderState) {
			throw new Error(`Sender state not found for ${phoneNumber}`);
		}

		const recentMessages: ConversationMessage[] = conversationId
			? await getConversationHistory(conversationId)
			: currentMessageText
				? [{ direction: "inbound" as const, text: currentMessageText }]
				: [];

		if (!currentMessageText) {
			logWebhookEvent("skipped_empty_message", {
				idempotencyKey,
				phoneNumber,
				providerMessageId,
				payloadMessageSummary: summarizePayloadMessage(payload),
				currentMessageSummary: summarizeNormalizedMessage(fallbackCurrentMessage),
			});
			return new Response("OK", { status: 200 });
		}

		const deterministicAction = parseDeterministicCommand(currentMessageText);
		let finalAction = deterministicAction;
		let llmInvoked = false;

		if (deterministicAction.type === "none") {
			llmInvoked = true;
			finalAction = await handleInboundMessageWithAgent({
				phoneNumber,
				senderState,
				currentMessage: currentMessageText,
				recentMessages,
			});
		}

		logWebhookEvent("action_selected", {
			idempotencyKey,
			phoneNumber,
			providerMessageId,
			deterministicAction,
			llmInvoked,
			finalAction,
		});

		const executableAction = toExecutableAction(
			finalAction,
			senderState.preferredTopCount,
		);

		if (executableAction.type === "none") {
			logWebhookEvent("no_action_selected", {
				idempotencyKey,
				phoneNumber,
				providerMessageId,
				currentMessageText,
			});
			return new Response("OK", { status: 200 });
		}

		await executeWhatsappAction({
			phoneNumber,
			action: executableAction,
		});

		logWebhookEvent("action_executed", {
			idempotencyKey,
			phoneNumber,
			providerMessageId,
			executedAction: executableAction,
		});
	} catch (error) {
		console.error("Failed to process Kapso sender", {
			eventType,
			idempotencyKey,
			phoneNumber,
			error,
		});

		return new Response("Internal server error", { status: 500 });
	}

	return new Response("OK", { status: 200 });
}
