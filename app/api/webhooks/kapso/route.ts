import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeWebhook } from "@kapso/whatsapp-cloud-api/server";
import { tasks } from "@trigger.dev/sdk/v3";

import { env } from "@/env";
import {
  parseDeterministicCommand,
  type DeterministicCommandAction,
} from "@/lib/whatsapp-command-router";
import { handleInboundMessageWithAgent } from "@/lib/whatsapp-agent";
import { kapsoClient } from "@/lib/kapso";
import { registerWebhookDelivery } from "@/lib/kapso-webhook-deliveries";
import { ensureSenderRegistered, getSenderState } from "@/lib/whatsapp-senders";

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

type KapsoBatchPayload = {
  batch?: boolean;
  data?: KapsoMessageReceivedPayload[];
  batch_info?: {
    size?: number;
    conversation_id?: string;
    window_ms?: number;
  };
};

type InboundWebhookEntry = {
  payload: KapsoMessageReceivedPayload;
  index: number;
  phoneNumber: string;
  providerMessageId: string | null;
  conversationId: string | null;
  messageText: string;
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

function unwrapWebhookEntries(payload: KapsoBatchPayload | KapsoMessageReceivedPayload) {
	const batchData = (payload as KapsoBatchPayload).data;

	if (Array.isArray(batchData)) {
		return batchData.map((entry, index) => ({
			payload: entry,
			index,
		}));
	}

	return [{ payload: payload as KapsoMessageReceivedPayload, index: 0 }];
}

function buildInboundWebhookEntry(
	entryPayload: KapsoMessageReceivedPayload,
	index: number,
	normalizedMessages: NormalizedKapsoMessage[],
) {
	const phoneNumber = entryPayload.conversation?.phone_number?.trim();

	if (!phoneNumber) {
		return null;
	}

	const fallbackCurrentMessage = getCurrentInboundMessage(
		phoneNumber,
		normalizedMessages,
	);
	const messageText =
		getPayloadMessageText(entryPayload) ||
		(fallbackCurrentMessage ? readMessageText(fallbackCurrentMessage) : "");
	const providerMessageId =
		getPayloadProviderMessageId(entryPayload) || getProviderMessageId(fallbackCurrentMessage);
	const conversationId =
		getPayloadConversationId(entryPayload) ||
		fallbackCurrentMessage?.kapso?.whatsappConversationId ||
		null;

	return {
		payload: entryPayload,
		index,
		phoneNumber,
		providerMessageId,
		conversationId,
		messageText,
	} satisfies InboundWebhookEntry;
}

function buildDeliveryKey(idempotencyKey: string, entry: InboundWebhookEntry) {
	return entry.providerMessageId
		? `${RECEIVED_EVENT}:${entry.providerMessageId}`
		: `${idempotencyKey}:${entry.index}`;
}

function mergeInboundTexts(entries: InboundWebhookEntry[]) {
	return entries
		.map((entry) => entry.messageText.trim())
		.filter((text) => text.length > 0)
		.join("\n");
}

function selectResponseEntry(entries: InboundWebhookEntry[]) {
	const entriesWithText = entries.filter((entry) => entry.messageText.trim().length > 0);

	return entriesWithText.at(-1) ?? entries.at(-1) ?? null;
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

	let payload: KapsoBatchPayload | KapsoMessageReceivedPayload;

	try {
		payload = JSON.parse(rawBody) as KapsoMessageReceivedPayload;
	} catch {
		return new Response("Invalid JSON payload", { status: 400 });
	}

	try {
		const normalized = normalizeWebhook(JSON.parse(rawBody));
		const normalizedMessages = normalized.messages as NormalizedKapsoMessage[];
		const envelopeEntries = unwrapWebhookEntries(payload);
		const inboundEntries = envelopeEntries
			.map(({ payload: entryPayload, index }) =>
				buildInboundWebhookEntry(entryPayload, index, normalizedMessages),
			)
			.filter((entry): entry is InboundWebhookEntry => entry !== null);

		if (inboundEntries.length === 0) {
			return new Response("Missing conversation.phone_number", { status: 400 });
		}

		const processedEntries: Array<
			InboundWebhookEntry & {
				duplicate: boolean;
				senderInserted: boolean;
				deliveryKey: string;
			}
		> = [];

		for (const entry of inboundEntries) {
			const deliveryKey = buildDeliveryKey(idempotencyKey, entry);
			const senderState = await getSenderState(entry.phoneNumber);
			const senderInserted = senderState
				? false
				: await ensureSenderRegistered(entry.phoneNumber);
			const registration = await registerWebhookDelivery({
				idempotencyKey: deliveryKey,
				eventType,
				phoneNumber: entry.phoneNumber,
				senderInsertedAtDelivery: senderInserted,
			});

			processedEntries.push({
				...entry,
				deliveryKey,
				duplicate: registration.duplicate,
				senderInserted: registration.senderInsertedAtDelivery,
			});
		}

		const selectedEntry = selectResponseEntry(processedEntries);
		const mergedInboundText = mergeInboundTexts(processedEntries);

		logWebhookEvent("received", {
			idempotencyKey,
			eventType,
			batch: Array.isArray((payload as KapsoBatchPayload).data),
			batchSize: (payload as KapsoBatchPayload).batch_info?.size ?? processedEntries.length,
			batchConversationId:
				(payload as KapsoBatchPayload).batch_info?.conversation_id ?? null,
			entries: processedEntries.map((entry) => ({
				index: entry.index,
				phoneNumber: entry.phoneNumber,
				providerMessageId: entry.providerMessageId,
				duplicate: entry.duplicate,
				senderInserted: entry.senderInserted,
				messageText: entry.messageText,
				payloadMessageSummary: summarizePayloadMessage(entry.payload),
			})),
			mergedInboundText,
			selectedEntryIndex: selectedEntry?.index ?? null,
		});

		if (processedEntries.length === 0) {
			logWebhookEvent("skipped_duplicate", {
				idempotencyKey,
				entries: processedEntries.map((entry) => ({
					index: entry.index,
					providerMessageId: entry.providerMessageId,
				})),
			});
		}

		if (!selectedEntry) {
			return new Response("OK", { status: 200 });
		}

		const selectedProcessedEntry = processedEntries.find(
			(entry) => entry.index === selectedEntry.index,
		);

		if (!selectedProcessedEntry) {
			throw new Error(`Selected entry metadata not found for index ${selectedEntry.index}`);
		}

		let executableAction: ReturnType<typeof toExecutableAction> | null = null;

		if (!selectedProcessedEntry.senderInserted && !mergedInboundText) {
			logWebhookEvent("skipped_empty_message", {
				idempotencyKey,
				selectedEntryIndex: selectedEntry.index,
			});
			return new Response("OK", { status: 200 });
		}

		if (!selectedProcessedEntry.senderInserted) {
			const senderState = await getSenderState(selectedProcessedEntry.phoneNumber);

			if (!senderState) {
				throw new Error(`Sender state not found for ${selectedProcessedEntry.phoneNumber}`);
			}

			const recentMessages: ConversationMessage[] = selectedProcessedEntry.conversationId
				? await getConversationHistory(selectedProcessedEntry.conversationId)
				: [{ direction: "inbound" as const, text: mergedInboundText }];

			const deterministicAction = parseDeterministicCommand(mergedInboundText);
			let finalAction = deterministicAction;
			let llmInvoked = false;

			if (deterministicAction.type === "none") {
				llmInvoked = true;
				finalAction = await handleInboundMessageWithAgent({
					phoneNumber: selectedProcessedEntry.phoneNumber,
					senderState,
					currentMessage: mergedInboundText,
					recentMessages,
				});
			}

			logWebhookEvent("action_selected", {
				idempotencyKey,
				phoneNumber: selectedProcessedEntry.phoneNumber,
				providerMessageId: selectedProcessedEntry.providerMessageId,
				deterministicAction,
				llmInvoked,
				finalAction,
				selectedEntryIndex: selectedProcessedEntry.index,
			});

			const resolvedAction = toExecutableAction(finalAction, senderState.preferredTopCount);

			if (resolvedAction.type === "none") {
				logWebhookEvent("no_action_selected", {
					idempotencyKey,
					phoneNumber: selectedProcessedEntry.phoneNumber,
					providerMessageId: selectedProcessedEntry.providerMessageId,
					mergedInboundText,
				});
				return new Response("OK", { status: 200 });
			}

			executableAction = resolvedAction;
		}

		await tasks.trigger(
			"process-kapso-webhook-reply",
			{
				idempotencyKey,
				phoneNumber: selectedProcessedEntry.phoneNumber,
				providerMessageId: selectedProcessedEntry.providerMessageId,
				conversationId: selectedProcessedEntry.conversationId,
				mergedInboundText,
				senderInsertedAtDelivery: selectedProcessedEntry.senderInserted,
				action: executableAction,
			},
			{
				idempotencyKey: `kapso-webhook-reply:${selectedProcessedEntry.deliveryKey}`,
			},
		);

		logWebhookEvent("reply_handed_off", {
			idempotencyKey,
			phoneNumber: selectedProcessedEntry.phoneNumber,
			providerMessageId: selectedProcessedEntry.providerMessageId,
			deliveryKey: selectedProcessedEntry.deliveryKey,
			action: executableAction,
			senderInserted: selectedProcessedEntry.senderInserted,
			selectedEntryIndex: selectedProcessedEntry.index,
		});
	} catch (error) {
		console.error("Failed to process Kapso sender", {
			eventType,
			idempotencyKey,
			error,
		});

		return new Response("Internal server error", { status: 500 });
	}

	return new Response("OK", { status: 200 });
}
