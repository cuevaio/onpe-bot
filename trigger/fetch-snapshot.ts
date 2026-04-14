import { logger, task } from "@trigger.dev/sdk/v3";

import { ONPE_HEADERS, ONPE_URL } from "@/lib/onpe";

export const fetchOnpeSnapshot = task({
  id: "fetch-onpe-snapshot",
  maxDuration: 300,
  run: async () => {
    logger.info("Fetching latest ONPE snapshot", { url: ONPE_URL });

    const response = await fetch(ONPE_URL, {
      headers: ONPE_HEADERS,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `ONPE request failed with ${response.status} ${response.statusText}`
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    if (!contentType.includes("application/json")) {
      throw new Error(
        `Unexpected ONPE content type: ${contentType || "unknown"}`
      );
    }

    try {
      JSON.parse(body);
    } catch {
      throw new Error("ONPE response body was not valid JSON");
    }

    return {
      snapshot: body,
      bytes: Buffer.byteLength(body),
    };
  },
});
