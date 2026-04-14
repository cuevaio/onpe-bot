import { put } from "@vercel/blob";
import { z } from "zod";
import { env } from "@/env";

import { setLatestOnpeImageUrl, type OnpeTopCount } from "@/lib/cache";
import { RESULTS_IMAGE_DIRECTORY } from "@/lib/onpe";
import { onpeResultsImagePayloadSchema } from "@/lib/render-results";

export async function renderAndStoreOnpeResultsImage(
  payload: z.infer<typeof onpeResultsImagePayloadSchema>,
) {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    throw new Error(
      "Missing VERCEL_PROJECT_PRODUCTION_URL or NEXT_PUBLIC_APP_URL for image generation",
    );
  }

  const imageUrl = `${baseUrl}/api/onpe/results-image`;
  const response = await fetch(imageUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to fetch rendered ONPE image: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`,
    );
  }

  const updatedAt = response.headers.get("x-onpe-updated-at");

  if (!updatedAt) {
    throw new Error("Rendered ONPE image response missing x-onpe-updated-at header");
  }

  const updatedAtNumber = Number(updatedAt);

  if (!Number.isFinite(updatedAtNumber)) {
    throw new Error(`Invalid x-onpe-updated-at header: ${updatedAt}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const timestampedPath = `${RESULTS_IMAGE_DIRECTORY}/chart-top-${payload.topCount}-${updatedAtNumber}.png`;
  const blob = await put(timestampedPath, imageBuffer, {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "image/png",
  });

  await setLatestOnpeImageUrl(payload.topCount as OnpeTopCount, blob.url);

  return {
    createdAt: new Date().toISOString(),
    updatedAt: updatedAtNumber,
    topCount: payload.topCount,
    pathname: blob.pathname,
    size: imageBuffer.length,
    title: payload.title,
    subtitle: payload.subtitle,
    url: blob.url,
  };
}
