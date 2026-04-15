import type { OnpeTopCount } from "@/lib/cache";
import { getLatestOnpeImageUrl } from "@/lib/cache";
import { formatOnpeUpdateTimestamp, LATEST_SNAPSHOT_URL, LATEST_SUMMARY_URL, onpeSummaryMetadataSchema } from "@/lib/onpe";
import { renderOnpeResultsImage } from "@/trigger/render-results-image";
import { sendKapsoMessage } from "@/trigger/send-kapso-message";

const ONPE_IMAGE_PATHNAME_PATTERN = /\/chart-top-(3|5)-(\d+)\.png$/;

export function readOnpeImageUpdatedAtFromUrl(url: string) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(ONPE_IMAGE_PATHNAME_PATTERN);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[2], 10);
}

export async function hasLatestOnpeImageUrl(topCount: OnpeTopCount, expectedUpdatedAt: number) {
  const cachedUrl = await getLatestOnpeImageUrl(topCount);

  if (!cachedUrl) {
    return false;
  }

  return readOnpeImageUpdatedAtFromUrl(cachedUrl) === expectedUpdatedAt;
}

export async function ensureLatestOnpeImageUrl(
  topCount: OnpeTopCount,
  expectedUpdatedAt?: number,
) {
  const cachedUrl = await getLatestOnpeImageUrl(topCount);

  if (
    cachedUrl &&
    (expectedUpdatedAt === undefined ||
      readOnpeImageUpdatedAtFromUrl(cachedUrl) === expectedUpdatedAt)
  ) {
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

  const sendResult = await sendKapsoMessage.triggerAndWait({
    type: "image",
    to: params.phoneNumber,
    imageUrl,
    caption:
      params.caption ??
      `Actualizacion ONPE: ${formatOnpeUpdateTimestamp(Date.now())}`,
  });

  if (!sendResult.ok) {
    throw sendResult.error;
  }

  return imageUrl;
}
