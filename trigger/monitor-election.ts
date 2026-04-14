import { logger, schedules } from "@trigger.dev/sdk/v3";

import {
  RESULTS_IMAGE_DIRECTORY,
  LATEST_SNAPSHOT_PATH,
  LATEST_SUMMARY_PATH,
  type OnpeSummaryMetadata,
} from "@/lib/onpe";
import { parseSnapshotEntries } from "@/lib/render-results";
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

  const parsedSnapshot = parseSnapshotEntries(snapshotResult.output.snapshot);
  const snapshotTotalValidVotes = parsedSnapshot.totalValidVotes;

  if (snapshotTotalValidVotes !== summary.totalVotosValidos) {
    return {
      consistent: false,
      latestBytes: snapshotResult.output.bytes,
      snapshot: snapshotResult.output.snapshot,
      snapshotTotalValidVotes,
    };
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
    consistent: true,
    latestBytes: snapshotResult.output.bytes,
    snapshot: snapshotResult.output.snapshot,
    snapshotTotalValidVotes,
  };
}

async function renderLatestOnpeResultsImage(
  summary: OnpeSummaryMetadata,
  snapshot: string,
) {
  const renderResults = [];

  for (const topCount of [3, 5] as const) {
    const renderResult = await renderOnpeResultsImage.triggerAndWait({
      snapshot,
      topCount,
      updatedAt: summary.fechaActualizacion,
      actasContabilizadas: summary.actasContabilizadas,
      totalVotosValidos: summary.totalVotosValidos,
    });

    if (!renderResult.ok) {
      throw renderResult.error;
    }

    renderResults.push(renderResult.output);
  }

  return renderResults;
}

async function sendLatestOnpeChangeAlert(updatedAt: number) {
  const alertResult = await sendOnpeChangeAlert.triggerAndWait({
    updatedAt,
  });

  if (!alertResult.ok) {
    throw alertResult.error;
  }

  return alertResult.output;
}

export const monitorOnpeElection = schedules.task({
  id: "monitor-onpe-election",
  cron: "*/5 * * * *",
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
      const storeResult = await storeLatestOnpeData(latestSummary);

      if (!storeResult.consistent) {
        logger.warn("ONPE summary advanced before snapshot caught up", {
          fechaActualizacion: latestSummary.fechaActualizacion,
          actasContabilizadas: latestSummary.actasContabilizadas,
          summaryTotalVotosValidos: latestSummary.totalVotosValidos,
          snapshotTotalValidVotes: storeResult.snapshotTotalValidVotes,
          nextBytes: storeResult.latestBytes,
          snapshotPath: LATEST_SNAPSHOT_PATH,
          summaryPath: LATEST_SUMMARY_PATH,
        });

        return {
          changed: false,
          initialized: false,
          pending: true,
          updatedAt: latestSummary.fechaActualizacion,
        };
      }

      const imageResult = await renderLatestOnpeResultsImage(
        latestSummary,
        storeResult.snapshot,
      );
      await sendLatestOnpeChangeAlert(imageResult[0].updatedAt);

      return {
        changed: false,
        initialized: true,
        updatedAt: imageResult[0].updatedAt,
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

    const storeResult = await storeLatestOnpeData(latestSummary);

    if (!storeResult.consistent) {
      logger.warn("ONPE summary advanced before snapshot caught up", {
        fechaActualizacion: latestSummary.fechaActualizacion,
        actasContabilizadas: latestSummary.actasContabilizadas,
        summaryTotalVotosValidos: latestSummary.totalVotosValidos,
        snapshotTotalValidVotes: storeResult.snapshotTotalValidVotes,
        nextBytes: storeResult.latestBytes,
        snapshotPath: LATEST_SNAPSHOT_PATH,
        summaryPath: LATEST_SUMMARY_PATH,
      });

      return {
        changed: false,
        initialized: false,
        pending: true,
        updatedAt: latestSummary.fechaActualizacion,
      };
    }

    const imageResult = await renderLatestOnpeResultsImage(
      latestSummary,
      storeResult.snapshot,
    );

    logger.warn("ONPE snapshot changed", {
      fechaActualizacion: latestSummary.fechaActualizacion,
      actasContabilizadas: latestSummary.actasContabilizadas,
      nextBytes: storeResult.latestBytes,
      snapshotPath: LATEST_SNAPSHOT_PATH,
      summaryPath: LATEST_SUMMARY_PATH,
      imageDirectory: RESULTS_IMAGE_DIRECTORY,
    });

    const updatedAt = imageResult[0].updatedAt;
    await sendLatestOnpeChangeAlert(updatedAt);

    return {
      changed: true,
      initialized: false,
      updatedAt,
    };
  },
});
