import { put } from "@vercel/blob";
import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import {
  LATEST_SUMMARY_PATH,
  onpeSummaryMetadataSchema,
} from "@/lib/onpe";

export const storeOnpeSummaryMetadata = schemaTask({
  id: "store-onpe-summary-metadata",
  schema: z.object({
    summary: onpeSummaryMetadataSchema,
  }),
  maxDuration: 300,
  run: async ({ summary }) => {
    const body = JSON.stringify(summary);

    await put(LATEST_SUMMARY_PATH, body, {
      access: "public",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
    });

    logger.info("Stored ONPE summary metadata", {
      summaryPath: LATEST_SUMMARY_PATH,
      fechaActualizacion: summary.fechaActualizacion,
      actasContabilizadas: summary.actasContabilizadas,
    });
  },
});
