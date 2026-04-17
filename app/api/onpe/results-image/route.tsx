import { ImageResponse } from "next/og";
import {
	formatOnpeUpdateTimestamp,
	LATEST_SNAPSHOT_URL,
	LATEST_SUMMARY_URL,
	onpeSummaryMetadataSchema,
} from "@/lib/onpe";
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
	type OnpeResultsImagePayload,
	onpeResultsImagePayloadSchema,
	PHOTO_SIZE,
	parseSnapshotEntries,
	TEXT_COLOR,
} from "@/lib/render-results";
import { SPONSORS } from "@/lib/sponsors";

export const runtime = "nodejs";
export const maxDuration = 800;

const DONATION_QR_URL =
	"https://xlpzqv2bvtoejfq9.public.blob.vercel-storage.com/onpe/assets/qr.png";

let fontDataPromise: Promise<ArrayBuffer> | null = null;
let donationQrDataUriPromise: Promise<string> | null = null;

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

async function getDonationQrDataUri() {
	if (!donationQrDataUriPromise) {
		donationQrDataUriPromise = fetch(DONATION_QR_URL, {
			cache: "force-cache",
			signal: AbortSignal.timeout(10_000),
		}).then(async (response) => {
			if (!response.ok) {
				throw new Error(
					`Unable to fetch donation QR from ${DONATION_QR_URL}: ${response.status} ${response.statusText}`,
				);
			}

			const contentType = response.headers.get("content-type") ?? "image/jpeg";

			if (!contentType.startsWith("image/")) {
				throw new Error(`Unexpected donation QR content type: ${contentType}`);
			}

			const assetBuffer = Buffer.from(await response.arrayBuffer());

			return `data:${contentType};base64,${assetBuffer.toString("base64")}`;
		});
	}

	return donationQrDataUriPromise;
}

async function readImageInputs(payload: OnpeResultsImagePayload) {
	const readSnapshotPromise = payload.snapshot
		? Promise.resolve(payload.snapshot)
		: fetch(LATEST_SNAPSHOT_URL, {
				cache: "no-store",
			}).then(async (response) => {
				if (!response.ok) {
					throw new Error(
						`Failed to fetch ONPE snapshot blob: ${response.status} ${response.statusText}`,
					);
				}

				return response.text();
			});

	const readSummaryPromise =
		payload.updatedAt !== undefined &&
		payload.actasContabilizadas !== undefined &&
		payload.totalVotosValidos !== undefined
			? Promise.resolve(
					onpeSummaryMetadataSchema.parse({
						fechaActualizacion: payload.updatedAt,
						actasContabilizadas: payload.actasContabilizadas,
						totalVotosValidos: payload.totalVotosValidos,
					}),
				)
			: fetch(LATEST_SUMMARY_URL, {
					cache: "no-store",
				}).then(async (response) => {
					if (!response.ok) {
						throw new Error(
							`Failed to fetch ONPE summary blob: ${response.status} ${response.statusText}`,
						);
					}

					return onpeSummaryMetadataSchema.parse(await response.json());
				});

	const [summaryResult, snapshotResult] = await Promise.all([
		readSummaryPromise,
		readSnapshotPromise,
	]);

	const parsed = parseSnapshotEntries(snapshotResult, payload.topCount);

	if (parsed.totalValidVotes !== summaryResult.totalVotosValidos) {
		throw new Error(
			`Stored ONPE data is inconsistent: summary totalVotosValidos=${summaryResult.totalVotosValidos}, snapshot totalVotosValidos=${parsed.totalValidVotes}`,
		);
	}

	const renderEntries = await Promise.all(
		parsed.entries.map((entry, index) => buildRenderEntry(entry, index)),
	);

	return {
		summary: summaryResult,
		renderEntries,
	};
}

async function renderImageResponse(payload: OnpeResultsImagePayload) {
	const [{ summary, renderEntries }, font, donationQrDataUri] =
		await Promise.all([
			readImageInputs(payload),
			getFontData(),
			getDonationQrDataUri(),
		]);
	const layout = buildChartLayout(payload, renderEntries, summary);
	const isTopFive = payload.topCount === 5;
	const barTextWidth = isTopFive ? 280 : 240;
	const totalFontSize = isTopFive ? 39 : 45;
	const percentageFontSize = isTopFive ? 24 : 29;

	return new ImageResponse(
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
				<div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>
					{layout.title}
				</div>
				<div
					style={{
						display: "flex",
						fontSize: 18,
						fontWeight: 500,
						color: "#606060",
						marginTop: 10,
					}}
				>
					{layout.subtitle}
				</div>
			</div>
			<div
				style={{
					position: "absolute",
					right: 40,
					top: 16,
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
				}}
			>
				<div
					style={{
						display: "flex",
						fontSize: 18,
						fontWeight: 500,
						color: "#606060",
					}}
				>
					Actualizado {formatOnpeUpdateTimestamp(layout.timestamp)}
				</div>
				<div
					style={{
						display: "flex",
						fontSize: 52,
						fontWeight: 700,
						marginTop: 18,
					}}
				>
					{formatSummaryPercentage(layout.actasContabilizadas)}
				</div>
				<div
					style={{
						display: "flex",
						fontSize: 18,
						fontWeight: 500,
						color: "#606060",
					}}
				>
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
				<div key={`tick-${tick.value}`} style={{ display: "flex" }}>
					<div
						style={{
							position: "absolute",
							left: CHART_LEFT,
							top: tick.y,
							width: CHART_RIGHT - CHART_LEFT,
							borderTop: `2px dashed ${GRID_COLOR}`,
						}}
					/>
					{tick.value > 0 ? (
						<div
							style={{
								position: "absolute",
								left: CHART_LEFT - 160,
								top: tick.y - 14,
								display: "flex",
								width: 140,
								textAlign: "right",
								fontSize: 23,
								fontWeight: 500,
							}}
						>
							{formatVoteCount(tick.value)}
						</div>
					) : null}
				</div>
			))}
			{layout.bars.map((entry, index) => (
				<div
					key={`${entry.codigoAgrupacionPolitica}-${index}`}
					style={{ display: "flex" }}
				>
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
							left: entry.centerX - barTextWidth / 2,
							top: entry.totalY - 36,
							display: "flex",
							width: barTextWidth,
							textAlign: "center",
							justifyContent: "center",
							fontSize: totalFontSize,
							fontWeight: 700,
							color: entry.barTextColor,
						}}
					>
						{entry.totalLabel}
					</div>
					<div
						style={{
							position: "absolute",
							left: entry.centerX - barTextWidth / 2,
							top: entry.percentageY - 24,
							display: "flex",
							width: barTextWidth,
							textAlign: "center",
							justifyContent: "center",
							fontSize: percentageFontSize,
							fontWeight: 600,
							color: entry.barTextColor,
						}}
					>
						{entry.percentageLabel}
					</div>
					{entry.deltaVotesLabel && entry.deltaPercentageLabel ? (
						<div
							style={{
								position: "absolute",
								left: entry.centerX - barTextWidth / 2,
								top: entry.barY + entry.barHeight - 82,
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
								width: barTextWidth,
								textAlign: "center",
								fontSize: 18,
								fontWeight: 600,
								color: entry.barTextColor,
							}}
						>
							<div style={{ display: "flex" }}>{entry.deltaVotesLabel}</div>
							<div style={{ display: "flex", marginTop: 4 }}>
								{entry.deltaPercentageLabel}
							</div>
						</div>
					) : null}
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
							display: "flex",
							justifyContent: "center",
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
			<div
				style={{
					position: "absolute",
					right: 40,
					top: 160,
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					width: 220,
					textAlign: "right",
				}}
			>
				<div
					style={{
						display: "flex",
						fontSize: 18,
						fontWeight: 700,
						marginBottom: 6,
					}}
				>
					Sponsors
				</div>
				<div
					style={{
						display: "flex",
						fontSize: 13,
						fontWeight: 500,
						color: "#606060",
						marginBottom: 8,
					}}
				>
					Este proyecto existe gracias a ustedes &lt;3.
				</div>
				{SPONSORS.map((sponsor) => (
					<div
						key={sponsor}
						style={{
							display: "flex",
							fontSize: 12,
							fontWeight: 500,
							color: "#606060",
							marginTop: 2,
						}}
					>
						{sponsor}
					</div>
				))}
			</div>
			<div
				style={{
					position: "absolute",
					left: 38,
					bottom: 28,
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-start",
					width: 140,
				}}
			>
				<div
					style={{
						display: "flex",
						fontSize: 15,
						fontWeight: 600,
						color: "#606060",
						marginBottom: 8,
					}}
				>
					Buy me a chicha. Yape:
				</div>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src={donationQrDataUri}
					alt="Yape QR"
					width={114}
					height={114}
					style={{
						display: "flex",
						borderRadius: 8,
					}}
				/>
			</div>
			<div
				style={{
					position: "absolute",
					right: 40,
					bottom: 24,
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					fontSize: 16,
					fontWeight: 500,
					color: "#606060",
				}}
			>
				<div style={{ display: "flex", marginBottom: 4 }}>
					+1 (201) 277-8569
				</div>
				elecciones.cueva.io
			</div>
		</div>,
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

function buildErrorResponse(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);

	return new Response(`ONPE image generation failed: ${message}`, {
		status: 500,
		headers: {
			"content-type": "text/plain; charset=utf-8",
		},
	});
}

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const payload = onpeResultsImagePayloadSchema.parse({
			snapshot: url.searchParams.get("snapshot") ?? undefined,
			topCount:
				url.searchParams.get("topCount") === null
					? undefined
					: Number(url.searchParams.get("topCount")),
			title: url.searchParams.get("title") ?? undefined,
			subtitle: url.searchParams.get("subtitle") ?? undefined,
			updatedAt: url.searchParams.get("updatedAt") ?? undefined,
			actasContabilizadas:
				url.searchParams.get("actasContabilizadas") ?? undefined,
			totalVotosValidos: url.searchParams.get("totalVotosValidos") ?? undefined,
		});

		return renderImageResponse(payload);
	} catch (error) {
		return buildErrorResponse(error);
	}
}

export async function POST(request: Request) {
	try {
		const payload = onpeResultsImagePayloadSchema.parse(await request.json());

		return renderImageResponse(payload);
	} catch (error) {
		return buildErrorResponse(error);
	}
}
