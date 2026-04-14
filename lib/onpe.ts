import { z } from "zod";

export const ONPE_URL =
  "https://resultadoelectoral.onpe.gob.pe/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre?idEleccion=10&tipoFiltro=eleccion";

export const ONPE_SUMMARY_URL =
  "https://resultadoelectoral.onpe.gob.pe/presentacion-backend/resumen-general/totales?idEleccion=10&tipoFiltro=eleccion";

export const ONPE_REFERER =
  "https://resultadoelectoral.onpe.gob.pe/main/presidenciales";

export const ONPE_BLOB_BASE_URL =
  "https://xlpzqv2bvtoejfq9.public.blob.vercel-storage.com";

export const LATEST_SNAPSHOT_PATH = "onpe/latest.json";

export const LATEST_SUMMARY_PATH = "onpe/latest-summary.json";

export const LATEST_RESULTS_IMAGE_PATH = "onpe/charts/chart-latest.png";

export const LATEST_SNAPSHOT_URL =
  `${ONPE_BLOB_BASE_URL}/${LATEST_SNAPSHOT_PATH}`;

export const LATEST_SUMMARY_URL =
  `${ONPE_BLOB_BASE_URL}/${LATEST_SUMMARY_PATH}`;

export const LATEST_RESULTS_IMAGE_URL =
  `${ONPE_BLOB_BASE_URL}/${LATEST_RESULTS_IMAGE_PATH}`;

export const ALERT_RECIPIENT = "+51912851377";

// The ONPE backend falls back to the SPA HTML unless the request resembles the site's XHR call.
export const ONPE_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  referer: ONPE_REFERER,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
} satisfies HeadersInit;

export const onpeSummaryMetadataSchema = z.object({
  fechaActualizacion: z.coerce.number().int().nonnegative(),
  actasContabilizadas: z.coerce.number().nonnegative(),
});

export type OnpeSummaryMetadata = z.infer<typeof onpeSummaryMetadataSchema>;

export function formatOnpeUpdateTimestamp(updatedAt: number) {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(new Date(updatedAt));
}
