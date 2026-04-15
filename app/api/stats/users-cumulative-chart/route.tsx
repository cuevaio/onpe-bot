import { ImageResponse } from "next/og";

import { FONT_URL } from "@/lib/render-results";
import { getCumulativeSenderCountSeries } from "@/lib/whatsapp-senders";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 820;
const BACKGROUND = "#f5f4f1";
const TEXT = "#262626";
const MUTED = "#606060";
const GRID = "#d3d3d3";
const LINE = "#14532d";
const FILL = "rgba(34, 197, 94, 0.18)";
const MARGIN_TOP = 150;
const MARGIN_RIGHT = 80;
const MARGIN_BOTTOM = 120;
const MARGIN_LEFT = 140;
const CHART_WIDTH = IMAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CHART_HEIGHT = IMAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
const GRID_STEPS = 5;
const DISPLAY_TIME_ZONE = "America/Lima";

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

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

function floorToHour(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0,
  ));
}

function ceilToHour(date: Date) {
  const floored = floorToHour(date);

  if (floored.getTime() === date.getTime()) {
    return floored;
  }

  return new Date(floored.getTime() + 60 * 60 * 1000);
}

function buildTicks(maxValue: number) {
  const upperBound = Math.max(1, maxValue);

  return Array.from({ length: GRID_STEPS + 1 }, (_, index) => {
    const ratio = index / GRID_STEPS;
    const value = Math.round(upperBound * ratio);
    const y = MARGIN_TOP + CHART_HEIGHT - CHART_HEIGHT * ratio;

    return { value, y };
  });
}

function buildLinePath(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function buildAreaPath(points: { x: number; y: number }[]) {
  if (points.length === 0) {
    return "";
  }

  const baselineY = MARGIN_TOP + CHART_HEIGHT;
  const linePath = buildLinePath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return `${linePath} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;
}

export async function GET() {
  try {
    const [series, font] = await Promise.all([
      getCumulativeSenderCountSeries(),
      getFontData(),
    ]);

    const safeSeries = series.length > 0 ? series : [{ timestamp: new Date().toISOString(), count: 0 }];
    const maxCount = Math.max(...safeSeries.map((point) => point.count), 0);
    const lastPoint = safeSeries[safeSeries.length - 1];
    const firstPoint = safeSeries[0];
    const denominator = Math.max(1, safeSeries.length - 1);
    const chartPoints = safeSeries.map((point, index) => {
      const x = MARGIN_LEFT + (CHART_WIDTH * index) / denominator;
      const y = MARGIN_TOP + CHART_HEIGHT - (CHART_HEIGHT * point.count) / Math.max(1, maxCount);

      return {
        ...point,
        x,
        y,
      };
    });
    const ticks = buildTicks(maxCount);
    const firstTimestamp = new Date(firstPoint.timestamp);
    const lastTimestamp = new Date(lastPoint.timestamp);
    const timeRangeMs = Math.max(1, lastTimestamp.getTime() - firstTimestamp.getTime());
    const xLabels = [] as { timestamp: string; x: number }[];

    for (
      let tickDate = floorToHour(firstTimestamp);
      tickDate.getTime() <= lastTimestamp.getTime();
      tickDate = new Date(tickDate.getTime() + 2 * 60 * 60 * 1000)
    ) {
      const offsetMs = tickDate.getTime() - firstTimestamp.getTime();

      if (offsetMs < 0) {
        continue;
      }

      xLabels.push({
        timestamp: tickDate.toISOString(),
        x: MARGIN_LEFT + (CHART_WIDTH * offsetMs) / timeRangeMs,
      });
    }

    if (xLabels.length === 0 || xLabels[0]?.x > MARGIN_LEFT + 1) {
      xLabels.unshift({
        timestamp: firstPoint.timestamp,
        x: MARGIN_LEFT,
      });
    }

    const hourCeiling = ceilToHour(lastTimestamp);

    if (hourCeiling.getTime() - lastTimestamp.getTime() <= 30 * 60 * 1000) {
      xLabels.push({
        timestamp: hourCeiling.toISOString(),
        x: MARGIN_LEFT + CHART_WIDTH,
      });
    } else if (xLabels.at(-1)?.x !== MARGIN_LEFT + CHART_WIDTH) {
      xLabels.push({
        timestamp: lastPoint.timestamp,
        x: MARGIN_LEFT + CHART_WIDTH,
      });
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: `${IMAGE_WIDTH}px`,
            height: `${IMAGE_HEIGHT}px`,
            display: "flex",
            position: "relative",
            background: BACKGROUND,
            color: TEXT,
            fontFamily: "OnpeChartFont",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 40,
              top: 28,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>
              Cumulative users count
            </div>
            <div style={{ display: "flex", fontSize: 19, fontWeight: 500, color: MUTED, marginTop: 10 }}>
              All-time WhatsApp registrations
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
            <div style={{ display: "flex", fontSize: 18, fontWeight: 500, color: MUTED }}>
              Total users
            </div>
            <div style={{ display: "flex", fontSize: 56, fontWeight: 700, marginTop: 12 }}>
              {formatCount(lastPoint.count)}
            </div>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 500, color: MUTED, marginTop: 8 }}>
              Since {formatDateLabel(firstPoint.timestamp)}
            </div>
          </div>

          {ticks.map((tick) => (
            <div key={`tick-${tick.y}`} style={{ display: "flex" }}>
              <div
                style={{
                  position: "absolute",
                  left: MARGIN_LEFT,
                  top: tick.y,
                  width: CHART_WIDTH,
                  borderTop: `2px dashed ${GRID}`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 20,
                  top: tick.y - 14,
                  display: "flex",
                  width: MARGIN_LEFT - 40,
                  justifyContent: "flex-end",
                  fontSize: 23,
                  fontWeight: 500,
                  color: MUTED,
                }}
              >
                {formatCount(tick.value)}
              </div>
            </div>
          ))}

          <div
            style={{
              position: "absolute",
              left: MARGIN_LEFT,
              top: MARGIN_TOP,
              width: CHART_WIDTH,
              height: CHART_HEIGHT,
              display: "flex",
            }}
          >
            <svg width={CHART_WIDTH} height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
              <title>All-time cumulative users chart</title>
              <path
                d={buildAreaPath(chartPoints.map((point) => ({ x: point.x - MARGIN_LEFT, y: point.y - MARGIN_TOP })))}
                fill={FILL}
              />
              <path
                d={buildLinePath(chartPoints.map((point) => ({ x: point.x - MARGIN_LEFT, y: point.y - MARGIN_TOP })))}
                fill="none"
                stroke={LINE}
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chartPoints.map((point) => (
                <circle
                  key={`${point.timestamp}-${point.count}`}
                  cx={point.x - MARGIN_LEFT}
                  cy={point.y - MARGIN_TOP}
                  r="7"
                  fill={LINE}
                />
              ))}
            </svg>
          </div>

          {xLabels.map((point, index) => (
            <div
              key={`${point.timestamp}-${index}`}
              style={{
                position: "absolute",
                left: point.x - 50,
                top: MARGIN_TOP + CHART_HEIGHT + 22,
                display: "flex",
                width: 100,
                justifyContent: "center",
                fontSize: 15,
                fontWeight: 500,
                color: MUTED,
              }}
            >
              {formatDateLabel(point.timestamp)}
            </div>
          ))}
        </div>
      ),
      {
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        headers: {
          "content-type": "image/png",
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return new Response(`Users chart generation failed: ${message}`, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}
