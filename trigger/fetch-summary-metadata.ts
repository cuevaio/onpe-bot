import { logger, task } from "@trigger.dev/sdk/v3";

import {
  ONPE_HEADERS,
  ONPE_SUMMARY_URL,
  onpeSummaryMetadataSchema,
} from "@/lib/onpe";

const onpeSummaryResponseSchema = onpeSummaryMetadataSchema;

export const fetchOnpeSummaryMetadata = task({
  id: "fetch-onpe-summary-metadata",
  maxDuration: 300,
  run: async () => {
    logger.info("Fetching latest ONPE summary metadata", {
      url: ONPE_SUMMARY_URL,
    });

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

    let parsedBody: unknown;

    try {
      parsedBody = JSON.parse(body);
    } catch {
      throw new Error("ONPE summary response body was not valid JSON");
    }

    const summaryPayload =
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      "data" in parsedBody
        ? (parsedBody as { data: unknown }).data
        : parsedBody;

    return {
      summary: onpeSummaryResponseSchema.parse(summaryPayload),
      bytes: Buffer.byteLength(body),
    };
  },
});
