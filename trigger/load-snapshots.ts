import { task } from "@trigger.dev/sdk/v3";

import { fetchOnpeSummaryMetadata } from "@/trigger/fetch-summary-metadata";
import { readOnpeSnapshot } from "@/trigger/read-snapshot";
import { readOnpeSummaryMetadata } from "@/trigger/read-summary-metadata";

export const loadOnpeSnapshots = task({
  id: "load-onpe-snapshots",
  maxDuration: 300,
  run: async () => {
    const latestSummaryResult = await fetchOnpeSummaryMetadata.triggerAndWait();

    if (!latestSummaryResult.ok) {
      throw latestSummaryResult.error;
    }

    const previousSummaryResult = await readOnpeSummaryMetadata.triggerAndWait();

    if (!previousSummaryResult.ok) {
      throw previousSummaryResult.error;
    }

    const previousSnapshotResult = await readOnpeSnapshot.triggerAndWait();

    if (!previousSnapshotResult.ok) {
      throw previousSnapshotResult.error;
    }

    return {
      latestSummary: latestSummaryResult.output.summary,
      latestBytes: latestSummaryResult.output.bytes,
      previousSnapshot: previousSnapshotResult.output.snapshot,
      previousSummary: previousSummaryResult.output.summary,
    };
  },
});
