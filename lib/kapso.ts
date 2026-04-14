import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";

import { env } from "@/env";

const KAPSO_BASE_URL = "https://api.kapso.ai/meta/whatsapp";

export const kapsoClient = new WhatsAppClient({
  baseUrl: KAPSO_BASE_URL,
  kapsoApiKey: env.KAPSO_API_KEY,
});
