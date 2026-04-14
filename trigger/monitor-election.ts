import { logger, schedules } from "@trigger.dev/sdk/v3";

import {
  LATEST_RESULTS_IMAGE_PATH,
  LATEST_SNAPSHOT_PATH,
  LATEST_SUMMARY_PATH,
  type OnpeSummaryMetadata,
} from "@/lib/onpe";
import { fetchOnpeSnapshot } from "@/trigger/fetch-snapshot";
import { loadOnpeSnapshots } from "@/trigger/load-snapshots";
import { renderOnpeResultsImage } from "@/trigger/render-results-image";
import { sendOnpeChangeAlert } from "@/trigger/send-change-alert";
import { storeOnpeSnapshot } from "@/trigger/store-snapshot";
import { storeOnpeSummaryMetadata } from "@/trigger/store-summary-metadata";

async function storeLatestOnpeData(summary: OnpeSummaryMetadata) {
  const snapshotResult = await fetchOnpeSnapshot.triggerAndWait();

  if (!snapshotResult.ok) {
    throw snapshotResult.error;
  }

  const storeSnapshotResult = await storeOnpeSnapshot.triggerAndWait({
    snapshot: snapshotResult.output.snapshot,
  });

  if (!storeSnapshotResult.ok) {
    throw storeSnapshotResult.error;
  }

  const storeSummaryResult = await storeOnpeSummaryMetadata.triggerAndWait({
    summary,
  });

  if (!storeSummaryResult.ok) {
    throw storeSummaryResult.error;
  }

  return {
    latestBytes: snapshotResult.output.bytes,
  };
}

async function renderLatestOnpeResultsImage() {
  const renderResult = await renderOnpeResultsImage.triggerAndWait({});

  if (!renderResult.ok) {
    throw renderResult.error;
  }

  return renderResult.output;
}

export const monitorOnpeElection = schedules.task({
  id: "monitor-onpe-election",
  cron: "*/2 * * * *",
  maxDuration: 300,
  queue: {
    concurrencyLimit: 1,
  },
  run: async (payload) => {
    logger.info("Checking ONPE snapshot", {
      scheduleId: payload.scheduleId,
      scheduledAt: payload.timestamp,
      snapshotPath: LATEST_SNAPSHOT_PATH,
      summaryPath: LATEST_SUMMARY_PATH,
    });

    const loadSnapshotsResult = await loadOnpeSnapshots.triggerAndWait();

    if (!loadSnapshotsResult.ok) {
      throw loadSnapshotsResult.error;
    }

    const { latestSummary, previousSummary } = loadSnapshotsResult.output;

    if (previousSummary === null) {
      await storeLatestOnpeData(latestSummary);
      await renderLatestOnpeResultsImage();
      const alertResult = await sendOnpeChangeAlert.triggerAndWait({
        updatedAt: latestSummary.fechaActualizacion,
      });

      if (!alertResult.ok) {
        throw alertResult.error;
      }

      return {
        changed: false,
        initialized: true,
        updatedAt: latestSummary.fechaActualizacion,
      };
    }

    if (previousSummary.fechaActualizacion === latestSummary.fechaActualizacion) {
      logger.info("ONPE snapshot unchanged", {
        fechaActualizacion: latestSummary.fechaActualizacion,
        actasContabilizadas: latestSummary.actasContabilizadas,
        summaryPath: LATEST_SUMMARY_PATH,
      });

      return {
        changed: false,
        initialized: false,
        updatedAt: latestSummary.fechaActualizacion,
      };
    }

    const { latestBytes } = await storeLatestOnpeData(latestSummary);
    await renderLatestOnpeResultsImage();

    logger.warn("ONPE snapshot changed", {
      fechaActualizacion: latestSummary.fechaActualizacion,
      actasContabilizadas: latestSummary.actasContabilizadas,
      nextBytes: latestBytes,
      snapshotPath: LATEST_SNAPSHOT_PATH,
      summaryPath: LATEST_SUMMARY_PATH,
      imagePath: LATEST_RESULTS_IMAGE_PATH,
    });

    const updatedAt = latestSummary.fechaActualizacion;
    const alertResult = await sendOnpeChangeAlert.triggerAndWait({ updatedAt });

    if (!alertResult.ok) {
      throw alertResult.error;
    }

    return {
      changed: true,
      initialized: false,
      updatedAt,
    };
  },
});
