import { logger, task } from "@trigger.dev/sdk/v3";

import {
  LATEST_SUMMARY_PATH,
  LATEST_SUMMARY_URL,
  onpeSummaryMetadataSchema,
} from "@/lib/onpe";

export const readOnpeSummaryMetadata = task({
  id: "read-onpe-summary-metadata",
  maxDuration: 300,
  run: async () => {
    const response = await fetch(LATEST_SUMMARY_URL, {
      cache: "no-store",
    });

    if (response.status === 404) {
      return {
        summary: null,
      };
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ONPE summary metadata: ${response.status} ${response.statusText}`,
      );
    }

    const body = await response.text();
    const summary = onpeSummaryMetadataSchema.parse(JSON.parse(body));

    logger.info("Loaded previous ONPE summary metadata", {
      summaryPath: LATEST_SUMMARY_PATH,
      summaryUrl: LATEST_SUMMARY_URL,
      fechaActualizacion: summary.fechaActualizacion,
      actasContabilizadas: summary.actasContabilizadas,
    });

    return {
      summary,
    };
  },
});
