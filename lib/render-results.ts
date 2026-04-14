import { z } from "zod";

import { env } from "@/env";
import { ONPE_REFERER } from "@/lib/onpe";

export const IMAGE_WIDTH = 1400;
export const IMAGE_HEIGHT = 820;
export const GRID_STEPS = 9;
export const CHART_TOP = 132;
export const CHART_BOTTOM = 646;
export const CHART_LEFT = 214;
export const CHART_RIGHT = IMAGE_WIDTH - 220;
export const CHART_HEIGHT = CHART_BOTTOM - CHART_TOP;
export const PHOTO_SIZE = 88;
export const LOGO_SIZE = 100;
export const PHOTO_BASE_URL =
  "https://resultadoelectoral.onpe.gob.pe/assets/img-reales/candidatos";
export const PARTY_BASE_URL =
  "https://resultadoelectoral.onpe.gob.pe/assets/img-reales/partidos";
export const BACKGROUND_COLOR = "#f5f4f1";
export const GRID_COLOR = "#d3d3d3";
export const TEXT_COLOR = "#262626";
export const TITLE = "Resultados presidenciales";
export const SUBTITLE = "Votos validos";
export const FONT_URL = env.ONPE_RESULTS_FONT_URL;
export const ONPE_ASSET_HEADERS = {
  accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  referer: ONPE_REFERER,
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
} satisfies HeadersInit;

export const onpeResultEntrySchema = z.object({
  nombreAgrupacionPolitica: z.string().min(1),
  codigoAgrupacionPolitica: z.string().min(1),
  nombreCandidato: z.string().min(1),
  dniCandidato: z.string().min(1),
  totalVotosValidos: z.coerce.number().nonnegative(),
  porcentajeVotosValidos: z.coerce.number().nonnegative(),
  candidatePhotoUrl: z.string().url().optional(),
  partyLogoUrl: z.string().url().optional(),
});

export const onpeSnapshotSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())).min(1),
});

export const onpeResultsImagePayloadSchema = z.object({
  snapshot: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  subtitle: z.string().min(1).optional(),
  updatedAt: z.coerce.number().int().nonnegative().optional(),
  actasContabilizadas: z.coerce.number().nonnegative().optional(),
  totalVotosValidos: z.coerce.number().int().nonnegative().optional(),
}).superRefine((payload, ctx) => {
  const summaryOverrideCount = [
    payload.updatedAt,
    payload.actasContabilizadas,
    payload.totalVotosValidos,
  ].filter((value) => value !== undefined).length;

  if (summaryOverrideCount > 0 && summaryOverrideCount < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "updatedAt, actasContabilizadas, and totalVotosValidos must be provided together",
    });
  }
});

export type OnpeResultsImagePayload = z.infer<typeof onpeResultsImagePayloadSchema>;
export type OnpeSnapshotEntry = z.infer<typeof onpeSnapshotSchema>["data"][number];
export type OnpeResultEntry = z.infer<typeof onpeResultEntrySchema>;
export type BarStyle = {
  fill: string;
  text: string;
};

export type RenderEntry = OnpeResultEntry & {
  barColor: string;
  barTextColor: string;
  candidatePhotoUrl: string;
  partyLogoUrl: string;
  candidatePhotoDataUri: string | null;
  partyLogoDataUri: string | null;
  totalLabel: string;
  percentageLabel: string;
};

export type ChartTick = {
  value: number;
  y: number;
};

export type SummaryDisplay = {
  actasContabilizadas: number;
  fechaActualizacion: number;
};

export type AssetKind = "candidate photo" | "party logo";

export function buildCandidatePhotoUrl(dniCandidato: string) {
  return `${PHOTO_BASE_URL}/${encodeURIComponent(dniCandidato)}.jpg`;
}

export function buildPartyLogoUrl(codigoAgrupacionPolitica: string) {
  const digits =
    codigoAgrupacionPolitica.replace(/\D/g, "") || codigoAgrupacionPolitica;

  return `${PARTY_BASE_URL}/${digits.padStart(8, "0")}.jpg`;
}

export function formatVoteCount(totalVotosValidos: number) {
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.round(totalVotosValidos));
  const parts = formatted.split(",");

  if (parts.length === 3) {
    return `${parts[0]}'${parts[1]},${parts[2]}`;
  }

  return formatted;
}

export function formatPercentage(porcentajeVotosValidos: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(porcentajeVotosValidos)}%`;
}

export function formatSummaryPercentage(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)}%`;
}

export function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function getFirstName(fullName: string) {
  const [firstName = fullName] = fullName.trim().split(/\s+/);

  return firstName;
}

export function buildTicks(maxVotes: number): ChartTick[] {
  return Array.from({ length: GRID_STEPS + 1 }, (_, index) => {
    const value = Math.round((maxVotes / GRID_STEPS) * index);
    const y = CHART_BOTTOM - (CHART_HEIGHT / GRID_STEPS) * index;

    return {
      value,
      y,
    };
  });
}

export function serializeRenderEntry(entry: RenderEntry) {
  return {
    nombreAgrupacionPolitica: entry.nombreAgrupacionPolitica,
    codigoAgrupacionPolitica: entry.codigoAgrupacionPolitica,
    nombreCandidato: entry.nombreCandidato,
    dniCandidato: entry.dniCandidato,
    totalVotosValidos: entry.totalVotosValidos,
    porcentajeVotosValidos: entry.porcentajeVotosValidos,
    candidatePhotoUrl: entry.candidatePhotoUrl,
    partyLogoUrl: entry.partyLogoUrl,
    barColor: entry.barColor,
    barTextColor: entry.barTextColor,
    totalLabel: entry.totalLabel,
    percentageLabel: entry.percentageLabel,
  };
}

export function getBarStyle(entry: OnpeResultEntry, index: number): BarStyle {
  const byPartyCode: Record<string, BarStyle> = {
    "8": { fill: "#f47c20", text: "#ffffff" },
    "35": { fill: "#3a7dc0", text: "#ffffff" },
    "16": { fill: "#f2c230", text: "#473300" },
  };
  const fallback: BarStyle[] = [
    { fill: "#f47c20", text: "#ffffff" },
    { fill: "#3a7dc0", text: "#ffffff" },
    { fill: "#f2c230", text: "#473300" },
  ];

  return (
    byPartyCode[entry.codigoAgrupacionPolitica] ??
    fallback[index] ?? {
      fill: "#2d70b3",
      text: "#ffffff",
    }
  );
}

export function readSnapshotString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readSnapshotNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeSnapshotEntry(entry: OnpeSnapshotEntry) {
  const normalizedEntry = {
    nombreAgrupacionPolitica: readSnapshotString(entry.nombreAgrupacionPolitica),
    codigoAgrupacionPolitica: readSnapshotString(entry.codigoAgrupacionPolitica),
    nombreCandidato: readSnapshotString(entry.nombreCandidato),
    dniCandidato: readSnapshotString(entry.dniCandidato),
    totalVotosValidos: readSnapshotNumber(entry.totalVotosValidos),
    porcentajeVotosValidos: readSnapshotNumber(entry.porcentajeVotosValidos),
    candidatePhotoUrl:
      typeof entry.candidatePhotoUrl === "string" && entry.candidatePhotoUrl
        ? entry.candidatePhotoUrl
        : undefined,
    partyLogoUrl:
      typeof entry.partyLogoUrl === "string" && entry.partyLogoUrl
        ? entry.partyLogoUrl
        : undefined,
  };

  if (
    !normalizedEntry.nombreAgrupacionPolitica ||
    !normalizedEntry.codigoAgrupacionPolitica ||
    !normalizedEntry.nombreCandidato ||
    !normalizedEntry.dniCandidato ||
    normalizedEntry.totalVotosValidos === null ||
    normalizedEntry.porcentajeVotosValidos === null
  ) {
    return null;
  }

  return onpeResultEntrySchema.parse(normalizedEntry);
}

export function parseSnapshotEntries(snapshot: string) {
  const parsedSnapshot = onpeSnapshotSchema.parse(JSON.parse(snapshot));
  const candidateEntries = parsedSnapshot.data
    .map(normalizeSnapshotEntry)
    .filter((entry): entry is OnpeResultEntry => entry !== null);

  if (candidateEntries.length === 0) {
    throw new Error("No candidate rows found in the latest ONPE snapshot");
  }

  return {
    totalEntries: parsedSnapshot.data.length,
    candidateEntries: candidateEntries.length,
    totalValidVotes: candidateEntries.reduce(
      (sum, entry) => sum + entry.totalVotosValidos,
      0,
    ),
    entries: candidateEntries.slice(0, 3),
  };
}

export async function fetchAssetDataUri(url: string, kind: AssetKind) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: ONPE_ASSET_HEADERS,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Unable to load ${kind}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "unknown";

  if (!contentType.startsWith("image/")) {
    throw new Error(`Expected image content type, received ${contentType}`);
  }

  const assetBuffer = Buffer.from(await response.arrayBuffer());

  return `data:${contentType};base64,${assetBuffer.toString("base64")}`;
}

export async function buildRenderEntry(
  entry: OnpeResultEntry,
  index: number,
): Promise<RenderEntry> {
  const candidatePhotoUrl =
    entry.candidatePhotoUrl ?? buildCandidatePhotoUrl(entry.dniCandidato);
  const partyLogoUrl =
    entry.partyLogoUrl ?? buildPartyLogoUrl(entry.codigoAgrupacionPolitica);
  const [candidatePhotoDataUri, partyLogoDataUri] = await Promise.all([
    fetchAssetDataUri(candidatePhotoUrl, "candidate photo").catch(() => null),
    fetchAssetDataUri(partyLogoUrl, "party logo").catch(() => null),
  ]);
  const barStyle = getBarStyle(entry, index);

  return {
    ...entry,
    barColor: barStyle.fill,
    barTextColor: barStyle.text,
    candidatePhotoUrl,
    partyLogoUrl,
    candidatePhotoDataUri,
    partyLogoDataUri,
    totalLabel: formatVoteCount(entry.totalVotosValidos),
    percentageLabel: formatPercentage(entry.porcentajeVotosValidos),
  };
}

export function buildChartLayout(
  payload: OnpeResultsImagePayload,
  entries: RenderEntry[],
  summary: SummaryDisplay,
) {
  const maxVotes = Math.max(...entries.map((entry) => entry.totalVotosValidos), 0);
  const safeMaxVotes = maxVotes || 1;
  const ticks = buildTicks(maxVotes || safeMaxVotes);
  const availableWidth = CHART_RIGHT - CHART_LEFT;
  const barGap = entries.length === 1 ? 0 : 58;
  const maxBarWidth = 330;
  const barWidth = Math.min(
    maxBarWidth,
    (availableWidth - barGap * Math.max(entries.length - 1, 0)) / entries.length,
  );
  const groupWidth =
    barWidth * entries.length + barGap * Math.max(entries.length - 1, 0);
  const groupLeft = CHART_LEFT + (availableWidth - groupWidth) / 2;

  return {
    title: payload.title ?? TITLE,
    subtitle: payload.subtitle ?? SUBTITLE,
    timestamp: summary.fechaActualizacion,
    actasContabilizadas: summary.actasContabilizadas,
    ticks,
    bars: entries.map((entry, index) => {
      const x = groupLeft + index * (barWidth + barGap);
      const barHeight =
        maxVotes > 0
          ? Math.max(220, (entry.totalVotosValidos / safeMaxVotes) * CHART_HEIGHT)
          : 0;
      const barY = CHART_BOTTOM - barHeight;
      const centerX = x + barWidth / 2;
      const totalY = barY + 120;
      const percentageY = totalY + 46;
      const photoY = barY - PHOTO_SIZE / 2 - 6;
      const logoY = CHART_BOTTOM + 30;

      return {
        ...entry,
        x,
        barY,
        barHeight,
        barWidth,
        centerX,
        totalY,
        percentageY,
        photoY,
        logoY,
        candidateLabel: truncateLabel(getFirstName(entry.nombreCandidato), 14),
      };
    }),
  };
}
