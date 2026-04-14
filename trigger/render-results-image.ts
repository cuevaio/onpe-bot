import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { put } from "@vercel/blob";

import { setLatestOnpeImageUrl } from "@/lib/cache";
import { onpeResultsImagePayloadSchema } from "@/lib/render-results";
import { RESULTS_IMAGE_DIRECTORY } from "@/lib/onpe";

export const renderOnpeResultsImage = schemaTask({
  id: "render-onpe-results-image",
  schema: onpeResultsImagePayloadSchema,
  maxDuration: 300,
  queue: {
    concurrencyLimit: 1,
  },
  run: async (payload) => {
    const baseUrl =
      process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.NEXT_PUBLIC_APP_URL;

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
    const timestampedPath = `${RESULTS_IMAGE_DIRECTORY}/chart-${updatedAtNumber}.png`;
    const blob = await put(timestampedPath, imageBuffer, {
      access: "public",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "image/png",
    });

    logger.info("Uploaded ONPE results image", {
      blobPath: blob.pathname,
      url: blob.url,
      updatedAt: updatedAtNumber,
    });

    await setLatestOnpeImageUrl(blob.url);

    return {
      createdAt: new Date().toISOString(),
      updatedAt: updatedAtNumber,
      pathname: blob.pathname,
      size: imageBuffer.length,
      title: payload.title,
      subtitle: payload.subtitle,
      url: blob.url,
    };
  },
});
