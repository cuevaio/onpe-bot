import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { z } from "zod";

import { setLatestOnpeImageUrl } from "@/lib/cache";
import {
	formatOnpeUpdateTimestamp,
	RESULTS_IMAGE_DIRECTORY,
	LATEST_SNAPSHOT_PATH,
	LATEST_SUMMARY_PATH,
	ONPE_REFERER,
} from "../lib/onpe";
import { readOnpeSnapshot } from "./read-snapshot";
import { readOnpeSummaryMetadata } from "./read-summary-metadata";

const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 820;
const GRID_STEPS = 9;
const CHART_TOP = 112;
const CHART_BOTTOM = 646;
const CHART_LEFT = 214;
const CHART_RIGHT = IMAGE_WIDTH - 36;
const CHART_HEIGHT = CHART_BOTTOM - CHART_TOP;
const PHOTO_SIZE = 88;
const LOGO_SIZE = 100;
const PHOTO_BASE_URL =
	"https://resultadoelectoral.onpe.gob.pe/assets/img-reales/candidatos";
const PARTY_BASE_URL =
	"https://resultadoelectoral.onpe.gob.pe/assets/img-reales/partidos";
const BACKGROUND_COLOR = "#f5f4f1";
const GRID_COLOR = "#d3d3d3";
const TEXT_COLOR = "#262626";
const TITLE = "Resultados presidenciales";
const SUBTITLE = "Votos validos";
const FONT_URL =
	"https://raw.githubusercontent.com/vercel/next.js/canary/packages/next/src/compiled/@vercel/og/Geist-Regular.ttf";
const ONPE_ASSET_HEADERS = {
	accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
	referer: ONPE_REFERER,
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
} satisfies HeadersInit;

const onpeResultEntrySchema = z.object({
	nombreAgrupacionPolitica: z.string().min(1),
	codigoAgrupacionPolitica: z.string().min(1),
	nombreCandidato: z.string().min(1),
	dniCandidato: z.string().min(1),
	totalVotosValidos: z.coerce.number().nonnegative(),
	porcentajeVotosValidos: z.coerce.number().nonnegative(),
	candidatePhotoUrl: z.string().url().optional(),
	partyLogoUrl: z.string().url().optional(),
});

const onpeSnapshotSchema = z.object({
	success: z.boolean().optional(),
	message: z.string().optional(),
	data: z.array(z.record(z.string(), z.unknown())).min(1),
});

const onpeResultsImagePayloadSchema = z.object({
	snapshot: z.string().min(1).optional(),
	title: z.string().min(1).optional(),
	subtitle: z.string().min(1).optional(),
});

type OnpeResultsImagePayload = z.infer<typeof onpeResultsImagePayloadSchema>;
type OnpeSnapshotEntry = z.infer<typeof onpeSnapshotSchema>["data"][number];
type OnpeResultEntry = z.infer<typeof onpeResultEntrySchema>;
type BarStyle = {
	fill: string;
	text: string;
};

type RenderEntry = OnpeResultEntry & {
	barColor: string;
	barTextColor: string;
	candidatePhotoUrl: string;
	partyLogoUrl: string;
	candidatePhotoDataUri: string | null;
	partyLogoDataUri: string | null;
	totalLabel: string;
	percentageLabel: string;
};

type ChartTick = {
	value: number;
	y: number;
};

type SummaryDisplay = {
	actasContabilizadas: number;
	fechaActualizacion: number;
};

type AssetKind = "candidate photo" | "party logo";

let embeddedFontCss: string | null = null;

function escapeXml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

async function getEmbeddedFontCss() {
	if (embeddedFontCss) {
		return embeddedFontCss;
	}

	const response = await fetch(FONT_URL, {
		cache: "force-cache",
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(
			`Unable to fetch chart font from ${FONT_URL}: ${response.status} ${response.statusText}`,
		);
	}

	const fontBuffer = Buffer.from(await response.arrayBuffer());
	const fontBase64 = fontBuffer.toString("base64");

	embeddedFontCss = `
		@font-face {
			font-family: "OnpeChartFont";
			src: url("data:font/ttf;base64,${fontBase64}") format("truetype");
			font-weight: 400 700;
			font-style: normal;
		}
		text {
			font-family: "OnpeChartFont", sans-serif;
		}
	`;

	return embeddedFontCss;
}

function buildCandidatePhotoUrl(dniCandidato: string) {
	return `${PHOTO_BASE_URL}/${encodeURIComponent(dniCandidato)}.jpg`;
}

function buildPartyLogoUrl(codigoAgrupacionPolitica: string) {
	const digits =
		codigoAgrupacionPolitica.replace(/\D/g, "") || codigoAgrupacionPolitica;

	return `${PARTY_BASE_URL}/${digits.padStart(8, "0")}.jpg`;
}

function formatVoteCount(totalVotosValidos: number) {
	const formatted = new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 0,
	}).format(Math.round(totalVotosValidos));
	const parts = formatted.split(",");

	if (parts.length === 3) {
		return `${parts[0]}'${parts[1]},${parts[2]}`;
	}

	return formatted;
}

function formatPercentage(porcentajeVotosValidos: number) {
	return `${new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(porcentajeVotosValidos)}%`;
}

function formatSummaryPercentage(value: number) {
	return `${new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 3,
		maximumFractionDigits: 3,
	}).format(value)}%`;
}

function truncateLabel(value: string, maxLength: number) {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function getFirstName(fullName: string) {
	const [firstName = fullName] = fullName.trim().split(/\s+/);

	return firstName;
}

function buildTicks(maxVotes: number): ChartTick[] {
	return Array.from({ length: GRID_STEPS + 1 }, (_, index) => {
		const value = Math.round((maxVotes / GRID_STEPS) * index);
		const y = CHART_BOTTOM - (CHART_HEIGHT / GRID_STEPS) * index;

		return {
			value,
			y,
		};
	});
}

function serializeRenderEntry(entry: RenderEntry) {
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

function getBarStyle(entry: OnpeResultEntry, index: number): BarStyle {
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

function readSnapshotString(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function readSnapshotNumber(value: unknown) {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);

		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function normalizeSnapshotEntry(entry: OnpeSnapshotEntry) {
	const normalizedEntry = {
		nombreAgrupacionPolitica: readSnapshotString(
			entry.nombreAgrupacionPolitica,
		),
		codigoAgrupacionPolitica: readSnapshotString(
			entry.codigoAgrupacionPolitica,
		),
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

function parseSnapshotEntries(snapshot: string) {
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
		entries: candidateEntries.slice(0, 3),
	};
}

async function readLatestSummary() {
	const summaryResult = await readOnpeSummaryMetadata.triggerAndWait();

	if (!summaryResult.ok) {
		throw summaryResult.error;
	}

	if (summaryResult.output.summary === null) {
		throw new Error(`No ONPE summary metadata found at ${LATEST_SUMMARY_PATH}`);
	}

	return {
		actasContabilizadas: summaryResult.output.summary.actasContabilizadas,
		fechaActualizacion: summaryResult.output.summary.fechaActualizacion,
	} satisfies SummaryDisplay;
}

async function readLatestSnapshotEntries(snapshotOverride?: string) {
	if (snapshotOverride) {
		return parseSnapshotEntries(snapshotOverride);
	}

	const snapshotResult = await readOnpeSnapshot.triggerAndWait();

	if (!snapshotResult.ok) {
		throw snapshotResult.error;
	}

	if (snapshotResult.output.snapshot === null) {
		throw new Error(`No ONPE snapshot found at ${LATEST_SNAPSHOT_PATH}`);
	}

	return parseSnapshotEntries(snapshotResult.output.snapshot);
}

async function fetchAssetDataUri(url: string, kind: AssetKind) {
	try {
		const response = await fetch(url, {
			cache: "no-store",
			headers: ONPE_ASSET_HEADERS,
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			throw new Error(`Request failed with ${response.status}`);
		}

		const contentType = response.headers.get("content-type") ?? "unknown";

		if (!contentType.startsWith("image/")) {
			throw new Error(`Expected image content type, received ${contentType}`);
		}

		const inputBuffer = Buffer.from(await response.arrayBuffer());
		const outputBuffer =
			kind === "candidate photo"
				? await sharp(inputBuffer)
						.resize(PHOTO_SIZE, PHOTO_SIZE, {
							fit: "cover",
							position: "attention",
						})
						.png()
						.toBuffer()
				: await sharp(inputBuffer)
						.resize(LOGO_SIZE, LOGO_SIZE, {
							fit: "contain",
							background: { r: 255, g: 255, b: 255, alpha: 0 },
						})
						.png()
						.toBuffer();

		return `data:image/png;base64,${outputBuffer.toString("base64")}`;
	} catch (error) {
		logger.warn(`Unable to load ${kind}`, {
			url,
			error: error instanceof Error ? error.message : String(error),
		});

		return null;
	}
}

async function buildRenderEntry(
	entry: OnpeResultEntry,
	index: number,
): Promise<RenderEntry> {
	const candidatePhotoUrl =
		entry.candidatePhotoUrl ?? buildCandidatePhotoUrl(entry.dniCandidato);
	const partyLogoUrl =
		entry.partyLogoUrl ?? buildPartyLogoUrl(entry.codigoAgrupacionPolitica);
	const [candidatePhotoDataUri, partyLogoDataUri] = await Promise.all([
		fetchAssetDataUri(candidatePhotoUrl, "candidate photo"),
		fetchAssetDataUri(partyLogoUrl, "party logo"),
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

function buildChartSvg(
	payload: OnpeResultsImagePayload,
	entries: RenderEntry[],
	summary: SummaryDisplay,
	fontCss: string,
) {
	const maxVotes = Math.max(
		...entries.map((entry) => entry.totalVotosValidos),
		0,
	);
	const safeMaxVotes = maxVotes || 1;
	const ticks = buildTicks(maxVotes || safeMaxVotes);
	const availableWidth = CHART_RIGHT - CHART_LEFT;
	const barGap = entries.length === 1 ? 0 : 58;
	const maxBarWidth = 330;
	const barWidth = Math.min(
		maxBarWidth,
		(availableWidth - barGap * Math.max(entries.length - 1, 0)) /
			entries.length,
	);
	const groupWidth =
		barWidth * entries.length + barGap * Math.max(entries.length - 1, 0);
	const groupLeft = CHART_LEFT + (availableWidth - groupWidth) / 2;
	const title = escapeXml(payload.title ?? TITLE);
	const subtitle = escapeXml(payload.subtitle ?? SUBTITLE);
	const timestamp = escapeXml(
		formatOnpeUpdateTimestamp(summary.fechaActualizacion),
	);
	const actasContabilizadas = escapeXml(
		formatSummaryPercentage(summary.actasContabilizadas),
	);

	const grid = ticks
		.map(
			(tick) => `
      <g>
        <line x1="${CHART_LEFT}" y1="${tick.y}" x2="${CHART_RIGHT}" y2="${tick.y}" stroke="${GRID_COLOR}" stroke-width="2" stroke-dasharray="10 10" />
        <text x="${CHART_LEFT - 12}" y="${tick.y + 10}" font-size="23" font-weight="500" fill="${TEXT_COLOR}" text-anchor="end">${escapeXml(
					formatVoteCount(tick.value),
				)}</text>
      </g>`,
		)
		.join("");

	const bars = entries
		.map((entry, index) => {
			const x = groupLeft + index * (barWidth + barGap);
			const barHeight =
				maxVotes > 0
					? Math.max(
							220,
							(entry.totalVotosValidos / safeMaxVotes) * CHART_HEIGHT,
						)
					: 0;
			const barY = CHART_BOTTOM - barHeight;
			const centerX = x + barWidth / 2;
			const totalY = barY + 120;
			const percentageY = totalY + 46;
			const photoY = barY - PHOTO_SIZE / 2 - 6;
			const logoY = CHART_BOTTOM + 30;
			const clipId = `candidate-photo-${index}`;
			const escapedCandidate = escapeXml(
				truncateLabel(getFirstName(entry.nombreCandidato), 14),
			);

			return `
      <g>
        <rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="20" fill="${entry.barColor}" />
	        <text x="${centerX}" y="${totalY}" font-size="45" font-weight="700" fill="${entry.barTextColor}" text-anchor="middle">${escapeXml(
						entry.totalLabel,
					)}</text>
	        <text x="${centerX}" y="${percentageY}" font-size="29" font-weight="600" fill="${entry.barTextColor}" text-anchor="middle">${escapeXml(
						entry.percentageLabel,
					)}</text>
        <circle cx="${centerX}" cy="${photoY + PHOTO_SIZE / 2}" r="${PHOTO_SIZE / 2 + 8}" fill="#ffffff" />
        ${
					entry.candidatePhotoDataUri
						? `
        <defs>
          <clipPath id="${clipId}">
            <circle cx="${centerX}" cy="${photoY + PHOTO_SIZE / 2}" r="${PHOTO_SIZE / 2}" />
          </clipPath>
        </defs>
        <image href="${entry.candidatePhotoDataUri}" x="${centerX - PHOTO_SIZE / 2}" y="${photoY}" width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" />`
						: ""
				}
        ${
					entry.partyLogoDataUri
					? `<image href="${entry.partyLogoDataUri}" x="${centerX - LOGO_SIZE / 2}" y="${logoY}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" preserveAspectRatio="xMidYMid meet" />`
						: ""
				}
        <text x="${centerX}" y="${logoY + LOGO_SIZE + 26}" font-size="21" font-weight="700" fill="${TEXT_COLOR}" text-anchor="middle">${escapedCandidate}</text>
      </g>`;
		})
		.join("");

	return `
  <svg width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <style>${fontCss}</style>
    <rect width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" fill="${BACKGROUND_COLOR}" />
	    <text x="40" y="44" font-size="32" font-weight="700" fill="${TEXT_COLOR}">${title}</text>
	    <text x="40" y="76" font-size="18" font-weight="500" fill="#606060">${subtitle}</text>
	    <text x="${IMAGE_WIDTH - 40}" y="44" font-size="18" font-weight="500" fill="#606060" text-anchor="end">Actualizado ${timestamp}</text>
	    <text x="${IMAGE_WIDTH - 40}" y="88" font-size="56" font-weight="700" fill="${TEXT_COLOR}" text-anchor="end">${actasContabilizadas}</text>
	    <text x="${IMAGE_WIDTH - 40}" y="108" font-size="18" font-weight="500" fill="#606060" text-anchor="end">Actas contabilizadas</text>
    <line x1="${CHART_LEFT}" y1="${CHART_TOP}" x2="${CHART_LEFT}" y2="${CHART_BOTTOM}" stroke="#bbbbbb" stroke-width="2" />
    ${grid}
    ${bars}
  </svg>`;
}

export const renderOnpeResultsImage = schemaTask({
	id: "render-onpe-results-image",
	schema: onpeResultsImagePayloadSchema,
	maxDuration: 300,
	queue: {
		concurrencyLimit: 1,
	},
	run: async (payload) => {
		const { entries, totalEntries, candidateEntries } =
			await readLatestSnapshotEntries(payload.snapshot);
		const [summary, fontCss] = await Promise.all([
			readLatestSummary(),
			getEmbeddedFontCss(),
		]);

		logger.info("Rendering ONPE results image", {
			snapshotPath: LATEST_SNAPSHOT_PATH,
			summaryPath: LATEST_SUMMARY_PATH,
			totalEntries,
			candidateEntries,
			fechaActualizacion: summary.fechaActualizacion,
			actasContabilizadas: summary.actasContabilizadas,
			renderedEntries: entries.length,
		});

		const renderEntries = await Promise.all(
			entries.map((entry, index) => buildRenderEntry(entry, index)),
		);
		const createdAt = new Date().toISOString();
		const svg = buildChartSvg(payload, renderEntries, summary, fontCss);
		const imageBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
		const timestampedPath = `${RESULTS_IMAGE_DIRECTORY}/chart-${summary.fechaActualizacion}.png`;
		const blob = await put(timestampedPath, imageBuffer, {
			access: "public",
			allowOverwrite: true,
			addRandomSuffix: false,
			contentType: "image/png",
		});

		logger.info("Uploaded ONPE results image", {
			blobPath: blob.pathname,
			url: blob.url,
			renderedEntries: renderEntries.length,
		});

		await setLatestOnpeImageUrl(blob.url);

		return {
			createdAt,
			updatedAt: summary.fechaActualizacion,
			pathname: blob.pathname,
			size: imageBuffer.length,
			snapshotPath: LATEST_SNAPSHOT_PATH,
			summaryPath: LATEST_SUMMARY_PATH,
			title: payload.title ?? TITLE,
			subtitle: payload.subtitle ?? SUBTITLE,
			url: blob.url,
			entries: renderEntries.map(serializeRenderEntry),
		};
	},
});
