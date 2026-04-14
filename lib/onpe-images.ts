import type { OnpeTopCount } from "@/lib/cache";
import { getLatestOnpeImageUrl } from "@/lib/cache";
import { formatOnpeUpdateTimestamp, LATEST_SNAPSHOT_URL, LATEST_SUMMARY_URL, onpeSummaryMetadataSchema } from "@/lib/onpe";
import { kapsoClient } from "@/lib/kapso";
import { renderOnpeResultsImage } from "@/trigger/render-results-image";
import { env } from "@/env";

export async function ensureLatestOnpeImageUrl(topCount: OnpeTopCount) {
  const cachedUrl = await getLatestOnpeImageUrl(topCount);

  if (cachedUrl) {
    return cachedUrl;
  }

  const [snapshotResponse, summaryResponse] = await Promise.all([
    fetch(LATEST_SNAPSHOT_URL, { cache: "no-store" }),
    fetch(LATEST_SUMMARY_URL, { cache: "no-store" }),
  ]);

  if (!snapshotResponse.ok) {
    throw new Error(
      `Failed to fetch latest ONPE snapshot blob: ${snapshotResponse.status} ${snapshotResponse.statusText}`,
    );
  }

  if (!summaryResponse.ok) {
    throw new Error(
      `Failed to fetch latest ONPE summary blob: ${summaryResponse.status} ${summaryResponse.statusText}`,
    );
  }

  const [snapshot, summaryJson] = await Promise.all([
    snapshotResponse.text(),
    summaryResponse.json(),
  ]);
  const summary = onpeSummaryMetadataSchema.parse(summaryJson);
  const renderResult = await renderOnpeResultsImage.triggerAndWait({
    snapshot,
    topCount,
    updatedAt: summary.fechaActualizacion,
    actasContabilizadas: summary.actasContabilizadas,
    totalVotosValidos: summary.totalVotosValidos,
  });

  if (!renderResult.ok) {
    throw renderResult.error;
  }

  return renderResult.output.url;
}

export async function sendLatestChartToRecipient(params: {
  phoneNumber: string;
  topCount: OnpeTopCount;
  caption?: string;
}) {
  const imageUrl = await ensureLatestOnpeImageUrl(params.topCount);

  await kapsoClient.messages.sendImage({
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID,
    to: params.phoneNumber,
    image: {
      link: imageUrl,
      caption:
        params.caption ??
        `Actualizacion ONPE: ${formatOnpeUpdateTimestamp(Date.now())}`,
    },
  });

  return imageUrl;
}
