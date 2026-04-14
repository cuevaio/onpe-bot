import { createHmac, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { env } from "@/env";
import { getLatestOnpeImageUrl } from "@/lib/cache";
import { kapsoClient } from "@/lib/kapso";

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

		if (registration.senderInserted) {
			const imageUrl = await getLatestOnpeImageUrl();

			if (!imageUrl) {
				throw new Error(
					"No cached ONPE image URL available for new user welcome message",
				);
			}

			await kapsoClient.messages.sendImage({
				phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
				to: phoneNumber,
				image: {
					link: imageUrl,
					caption: `Bienvenidx. Estos son los ultimos resultados presidenciales de ONPE. Te enviaremos actualizaciones automáticamente.`,
				},
			});
		}
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
