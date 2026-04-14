import { logger, task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import {
  LATEST_SUMMARY_PATH,
  LATEST_SUMMARY_URL,
  onpeSummaryMetadataSchema,
} from "@/lib/onpe";

const legacyOnpeSummaryMetadataSchema = z.object({
  fechaActualizacion: z.coerce.number().int().nonnegative(),
  actasContabilizadas: z.coerce.number().nonnegative(),
});

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
    const parsedBody = JSON.parse(body);
    const summaryResult = onpeSummaryMetadataSchema.safeParse(parsedBody);

    if (!summaryResult.success) {
      const legacySummaryResult = legacyOnpeSummaryMetadataSchema.safeParse(parsedBody);

      if (legacySummaryResult.success) {
        logger.warn("Loaded legacy ONPE summary metadata without totalVotosValidos", {
          summaryPath: LATEST_SUMMARY_PATH,
          summaryUrl: LATEST_SUMMARY_URL,
          fechaActualizacion: legacySummaryResult.data.fechaActualizacion,
          actasContabilizadas: legacySummaryResult.data.actasContabilizadas,
        });

        return {
          summary: null,
        };
      }

      throw summaryResult.error;
    }

    const summary = summaryResult.data;

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
