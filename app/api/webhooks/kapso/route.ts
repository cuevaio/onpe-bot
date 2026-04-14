import { createHmac, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import { normalizeWebhook } from "@kapso/whatsapp-cloud-api/server";

import { getDb } from "@/db";
import { env } from "@/env";
import { handleInboundMessageWithAgent } from "@/lib/whatsapp-agent";
import { kapsoClient } from "@/lib/kapso";
import { getSenderState } from "@/lib/whatsapp-senders";
import { sendWelcome } from "@/lib/whatsapp-tools";

type ConversationMessage = Parameters<typeof handleInboundMessageWithAgent>[0]["recentMessages"][number];

export const runtime = "nodejs";

const RECEIVED_EVENT = "whatsapp.message.received";

type KapsoMessageReceivedPayload = {
  conversation?: {
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
  const text =
    typeof message.text === "object" && message.text !== null
      ? (message.text as { body?: unknown }).body
      : undefined;

  return typeof text === "string" ? text.trim() : "";
}

async function getConversationHistory(conversationId: string) {
	const response = await kapsoClient.messages.listByConversation({
		phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
		conversationId,
		limit: 12,
	});

	const messages: ConversationMessage[] = response.data
		.map((message): ConversationMessage => ({
			direction:
				message.kapso?.direction === "outbound" ? "outbound" : "inbound",
			text: readMessageText(message),
		}))
		.filter((message) => message.text.length > 0);

	return messages;
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
		const currentMessage = normalized.messages.find(
			(message) => message.from?.trim() === phoneNumber,
		);
		const currentMessageText = currentMessage ? readMessageText(currentMessage) : "";

		if (registration.senderInserted) {
			await sendWelcome(phoneNumber);
			return new Response("OK", { status: 200 });
		}

		if (registration.duplicate) {
			return new Response("OK", { status: 200 });
		}

		const senderState = await getSenderState(phoneNumber);

		if (!senderState) {
			throw new Error(`Sender state not found for ${phoneNumber}`);
		}

		const conversationId = currentMessage?.kapso?.whatsappConversationId;
		const recentMessages: ConversationMessage[] = conversationId
			? await getConversationHistory(conversationId)
			: currentMessageText
				? [{ direction: "inbound" as const, text: currentMessageText }]
				: [];

		await handleInboundMessageWithAgent({
			phoneNumber,
			senderState,
			currentMessage: currentMessageText,
			recentMessages,
		});
	} catch (error) {
		console.error("Failed to persist Kapso sender", {
			eventType,
			idempotencyKey,
			phoneNumber,
			error,
		});

		return new Response("Internal server error", { status: 500 });
	}

	return new Response("OK", { status: 200 });
}
