import { put } from "@vercel/blob";
import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { LATEST_SNAPSHOT_PATH } from "@/lib/onpe";

export const storeOnpeSnapshot = schemaTask({
  id: "store-onpe-snapshot",
  schema: z.object({
    snapshot: z.string().min(1),
  }),
  maxDuration: 300,
  run: async ({ snapshot }) => {
    await put(LATEST_SNAPSHOT_PATH, snapshot, {
      access: "public",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
    });

    logger.info("Stored ONPE snapshot", {
      bytes: Buffer.byteLength(snapshot),
      snapshotPath: LATEST_SNAPSHOT_PATH,
    });
  },
});
