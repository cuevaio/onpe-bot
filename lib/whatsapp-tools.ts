import { env } from "@/env";
import type { OnpeTopCount } from "@/lib/cache";
import { kapsoClient } from "@/lib/kapso";
import { sendLatestChartToRecipient } from "@/lib/onpe-images";
import { setSenderActive, setSenderTopCount } from "@/lib/whatsapp-senders";

const PAUSED_MESSAGE =
  "Envio pausado. si quieres volver a recibir updates, solo dinoslo";

const HELP_MESSAGE =
  "Puedes pedirme el ultimo chart, elegir top 3 o top 5, pausar updates o reactivarlos cuando quieras.";

export async function sendTextReply(phoneNumber: string, body: string) {
  await kapsoClient.messages.sendText({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    to: phoneNumber,
    body,
  });
}

export async function executeWhatsappAction(params: {
  phoneNumber: string;
  action:
    | { type: "pause_updates" }
    | { type: "resume_updates"; topCount: OnpeTopCount }
    | { type: "send_latest_chart"; topCount: OnpeTopCount }
    | { type: "set_chart_preference"; topCount: OnpeTopCount }
    | { type: "send_help" };
}) {
  switch (params.action.type) {
    case "pause_updates":
      await pauseUpdates(params.phoneNumber);
      return;
    case "resume_updates":
      await resumeUpdates(params.phoneNumber, params.action.topCount);
      return;
    case "send_latest_chart":
      await sendLatestChart(params.phoneNumber, params.action.topCount);
      return;
    case "set_chart_preference":
      await setChartPreference(params.phoneNumber, params.action.topCount);
      return;
    case "send_help":
      await sendHelp(params.phoneNumber);
      return;
  }
}

export async function pauseUpdates(phoneNumber: string) {
  await setSenderActive(phoneNumber, false);
  await sendTextReply(phoneNumber, PAUSED_MESSAGE);
}

export async function resumeUpdates(phoneNumber: string, topCount: OnpeTopCount) {
  await setSenderActive(phoneNumber, true);
  await sendLatestChartToRecipient({
    phoneNumber,
    topCount,
    caption: "Updates reactivados. Este es el ultimo chart.",
  });
}

export async function sendLatestChart(phoneNumber: string, topCount: OnpeTopCount) {
  await sendLatestChartToRecipient({
    phoneNumber,
    topCount,
    caption: "Este es el ultimo chart disponible.",
  });
}

export async function setChartPreference(
  phoneNumber: string,
  topCount: OnpeTopCount,
) {
  await setSenderTopCount(phoneNumber, topCount);
  await sendLatestChartToRecipient({
    phoneNumber,
    topCount,
    caption: `Listo. Desde ahora te mostrare el top ${topCount}.`,
  });
}

export async function sendHelp(phoneNumber: string) {
  await sendTextReply(phoneNumber, HELP_MESSAGE);
}

export async function sendWelcome(phoneNumber: string) {
  await sendTextReply(
    phoneNumber,
    "Hola. Puedes elegir top 3 o top 5, pedirme el ultimo chart, pausar updates, o reactivarlos cuando quieras.",
  );
}
