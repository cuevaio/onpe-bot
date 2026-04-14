import { task } from "@trigger.dev/sdk/v3";

import { fetchOnpeSummaryMetadata } from "@/trigger/fetch-summary-metadata";
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

    return {
      latestSummary: latestSummaryResult.output.summary,
      latestBytes: latestSummaryResult.output.bytes,
      previousSummary: previousSummaryResult.output.summary,
    };
  },
});
