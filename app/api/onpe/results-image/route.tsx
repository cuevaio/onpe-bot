import { ImageResponse } from "next/og";

import {
  BACKGROUND_COLOR,
  buildChartLayout,
  buildRenderEntry,
  CHART_HEIGHT,
  CHART_LEFT,
  CHART_RIGHT,
  CHART_TOP,
  FONT_URL,
  formatSummaryPercentage,
  formatVoteCount,
  GRID_COLOR,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  LOGO_SIZE,
  onpeResultsImagePayloadSchema,
  parseSnapshotEntries,
  PHOTO_SIZE,
  TEXT_COLOR,
} from "@/lib/render-results";
import { formatOnpeUpdateTimestamp } from "@/lib/onpe";
import { readOnpeSnapshot } from "@/trigger/read-snapshot";
import { readOnpeSummaryMetadata } from "@/trigger/read-summary-metadata";

export const runtime = "nodejs";

let fontDataPromise: Promise<ArrayBuffer> | null = null;

async function getFontData() {
  if (!fontDataPromise) {
    fontDataPromise = fetch(FONT_URL, {
      cache: "force-cache",
      signal: AbortSignal.timeout(10_000),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Unable to fetch chart font from ${FONT_URL}: ${response.status} ${response.statusText}`,
        );
      }

      return response.arrayBuffer();
    });
  }

  return fontDataPromise;
}

async function readImageInputs(snapshotOverride?: string) {
  const [summaryResult, snapshotResult] = await Promise.all([
    readOnpeSummaryMetadata.triggerAndWait(),
    snapshotOverride
      ? Promise.resolve({ ok: true as const, output: { snapshot: snapshotOverride } })
      : readOnpeSnapshot.triggerAndWait(),
  ]);

  if (!summaryResult.ok) {
    throw summaryResult.error;
  }

  if (!snapshotResult.ok) {
    throw snapshotResult.error;
  }

  if (!summaryResult.output.summary) {
    throw new Error("No ONPE summary metadata found");
  }

  if (!snapshotResult.output.snapshot) {
    throw new Error("No ONPE snapshot found");
  }

  const parsed = parseSnapshotEntries(snapshotResult.output.snapshot);
  const renderEntries = await Promise.all(
    parsed.entries.map((entry, index) => buildRenderEntry(entry, index)),
  );

  return {
    summary: summaryResult.output.summary,
    renderEntries,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = onpeResultsImagePayloadSchema.parse({
    snapshot: url.searchParams.get("snapshot") ?? undefined,
    title: url.searchParams.get("title") ?? undefined,
    subtitle: url.searchParams.get("subtitle") ?? undefined,
  });

  const [{ summary, renderEntries }, font] = await Promise.all([
    readImageInputs(payload.snapshot),
    getFontData(),
  ]);
  const layout = buildChartLayout(payload, renderEntries, summary);

  return new ImageResponse(
    (
      <div
        style={{
          width: `${IMAGE_WIDTH}px`,
          height: `${IMAGE_HEIGHT}px`,
          display: "flex",
          position: "relative",
          background: BACKGROUND_COLOR,
          fontFamily: "OnpeChartFont",
          color: TEXT_COLOR,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 24,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 700 }}>{layout.title}</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#606060", marginTop: 10 }}>
            {layout.subtitle}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 40,
            top: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 500, color: "#606060" }}>
            Actualizado {formatOnpeUpdateTimestamp(layout.timestamp)}
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, marginTop: 8 }}>
            {formatSummaryPercentage(layout.actasContabilizadas)}
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#606060" }}>
            Actas contabilizadas
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: CHART_LEFT,
            top: CHART_TOP,
            width: 2,
            height: CHART_HEIGHT,
            background: "#bbbbbb",
          }}
        />
        {layout.ticks.map((tick) => (
          <div key={`tick-${tick.value}`}>
            <div
              style={{
                position: "absolute",
                left: CHART_LEFT,
                top: tick.y,
                width: CHART_RIGHT - CHART_LEFT,
                borderTop: `2px dashed ${GRID_COLOR}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: CHART_LEFT - 160,
                top: tick.y - 14,
                width: 140,
                textAlign: "right",
                fontSize: 23,
                fontWeight: 500,
              }}
            >
              {formatVoteCount(tick.value)}
            </div>
          </div>
        ))}
        {layout.bars.map((entry, index) => (
          <div key={`${entry.codigoAgrupacionPolitica}-${index}`}>
            <div
              style={{
                position: "absolute",
                left: entry.x,
                top: entry.barY,
                width: entry.barWidth,
                height: entry.barHeight,
                background: entry.barColor,
                borderRadius: 20,
              }}
            />
            {entry.candidatePhotoDataUri ? (
              <div
                style={{
                  position: "absolute",
                  left: entry.centerX - PHOTO_SIZE / 2 - 8,
                  top: entry.photoY - 8,
                  width: PHOTO_SIZE + 16,
                  height: PHOTO_SIZE + 16,
                  borderRadius: 9999,
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.candidatePhotoDataUri}
                  alt={entry.nombreCandidato}
                  width={PHOTO_SIZE}
                  height={PHOTO_SIZE}
                  style={{ borderRadius: 9999, objectFit: "cover" }}
                />
              </div>
            ) : null}
            <div
              style={{
                position: "absolute",
                left: entry.centerX - 120,
                top: entry.totalY - 36,
                width: 240,
                textAlign: "center",
                fontSize: 45,
                fontWeight: 700,
                color: entry.barTextColor,
              }}
            >
              {entry.totalLabel}
            </div>
            <div
              style={{
                position: "absolute",
                left: entry.centerX - 120,
                top: entry.percentageY - 24,
                width: 240,
                textAlign: "center",
                fontSize: 29,
                fontWeight: 600,
                color: entry.barTextColor,
              }}
            >
              {entry.percentageLabel}
            </div>
            {entry.partyLogoDataUri ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={entry.partyLogoDataUri}
                alt={entry.nombreAgrupacionPolitica}
                width={LOGO_SIZE}
                height={LOGO_SIZE}
                style={{
                  position: "absolute",
                  left: entry.centerX - LOGO_SIZE / 2,
                  top: entry.logoY,
                  objectFit: "contain",
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                left: entry.centerX - 120,
                top: entry.logoY + LOGO_SIZE + 8,
                width: 240,
                textAlign: "center",
                fontSize: 21,
                fontWeight: 700,
              }}
            >
              {entry.candidateLabel}
            </div>
          </div>
        ))}
      </div>
    ),
    {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      headers: {
        "x-onpe-updated-at": String(summary.fechaActualizacion),
      },
      fonts: [
        {
          name: "OnpeChartFont",
          data: font,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );
}
