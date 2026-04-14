import { put } from "@vercel/blob";

import {
  LATEST_SNAPSHOT_PATH,
  LATEST_SUMMARY_PATH,
  ONPE_HEADERS,
  ONPE_SUMMARY_URL,
  ONPE_URL,
  onpeSummaryMetadataSchema,
} from "@/lib/onpe";
import { renderAndStoreOnpeResultsImage } from "@/lib/render-results-image-storage";

async function fetchSnapshot() {
  const response = await fetch(ONPE_URL, {
    headers: ONPE_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `ONPE request failed with ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Unexpected ONPE content type: ${contentType || "unknown"}`,
    );
  }

  JSON.parse(body);

  return body;
}

async function fetchSummary() {
  const response = await fetch(ONPE_SUMMARY_URL, {
    headers: ONPE_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `ONPE summary request failed with ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Unexpected ONPE summary content type: ${contentType || "unknown"}`,
    );
  }

  const parsedBody: unknown = JSON.parse(body);
  const summaryPayload =
    typeof parsedBody === "object" &&
    parsedBody !== null &&
    "data" in parsedBody
      ? (parsedBody as { data: unknown }).data
      : parsedBody;

  return onpeSummaryMetadataSchema.parse(summaryPayload);
}

async function storeLatestFiles(snapshot: string, summary: unknown) {
  await put(LATEST_SNAPSHOT_PATH, snapshot, {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });

  await put(LATEST_SUMMARY_PATH, JSON.stringify(summary), {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });
}

async function renderVariant(snapshot: string, summary: ReturnType<typeof onpeSummaryMetadataSchema.parse>, topCount: 3 | 5) {
  return renderAndStoreOnpeResultsImage({
    snapshot,
    topCount,
    updatedAt: summary.fechaActualizacion,
    actasContabilizadas: summary.actasContabilizadas,
    totalVotosValidos: summary.totalVotosValidos,
  });
}

async function main() {
  const [snapshot, summary] = await Promise.all([fetchSnapshot(), fetchSummary()]);

  await storeLatestFiles(snapshot, summary);

  const top3 = await renderVariant(snapshot, summary, 3);
  const top5 = await renderVariant(snapshot, summary, 5);

  console.log(
    JSON.stringify(
      {
        updatedAt: summary.fechaActualizacion,
        top3: top3.url,
        top5: top5.url,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
