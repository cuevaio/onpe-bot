export const kapsoSendQueue = {
	name: "kapso-send-queue",
	concurrencyLimit: 20,
} as const;

export const kapsoWebhookSendQueue = {
	name: "kapso-webhook-send-queue",
	concurrencyLimit: 20,
} as const;
