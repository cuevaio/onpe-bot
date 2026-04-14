import { logger, task } from "@trigger.dev/sdk/v3";

import { LATEST_SNAPSHOT_PATH, LATEST_SNAPSHOT_URL } from "@/lib/onpe";

export const readOnpeSnapshot = task({
  id: "read-onpe-snapshot",
  maxDuration: 300,
  run: async () => {
    try {
      const response = await fetch(LATEST_SNAPSHOT_URL, {
        cache: "no-store",
      });

      if (response.status === 404) {
        return {
          snapshot: null,
        };
      }

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ONPE snapshot: ${response.status} ${response.statusText}`
        );
      }

      const snapshot = await response.text();

      logger.info("Loaded previous ONPE snapshot", {
        bytes: Buffer.byteLength(snapshot),
        snapshotPath: LATEST_SNAPSHOT_PATH,
        snapshotUrl: LATEST_SNAPSHOT_URL,
      });

      return {
        snapshot,
      };
    } catch (error) {
      throw error;
    }
  },
});
