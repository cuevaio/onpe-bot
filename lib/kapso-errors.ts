const DEFAULT_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

type KapsoRetryMetadata = {
  action?: string;
  retryAfterMs?: number;
};

type KapsoLikeError = Error & {
  httpStatus?: number;
  code?: number | string;
  category?: string;
  retry?: KapsoRetryMetadata;
  raw?: unknown;
};

export type KapsoErrorClassification = {
  retryable: boolean;
  kind: "rate_limit" | "server" | "network" | "client" | "unknown";
  httpStatus: number | null;
  category: string | null;
  retryAfterMs: number | null;
};

function asKapsoError(error: unknown): KapsoLikeError | null {
  return error instanceof Error ? (error as KapsoLikeError) : null;
}

function normalizeRetryAfterMs(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.min(value, MAX_RETRY_DELAY_MS);
}

export function classifyKapsoError(error: unknown): KapsoErrorClassification {
  const kapsoError = asKapsoError(error);

  if (!kapsoError) {
    return {
      retryable: false,
      kind: "unknown",
      httpStatus: null,
      category: null,
      retryAfterMs: null,
    };
  }

  const httpStatus =
    typeof kapsoError.httpStatus === "number"
      ? kapsoError.httpStatus
      : typeof kapsoError.code === "number"
        ? kapsoError.code
        : null;
  const category = typeof kapsoError.category === "string" ? kapsoError.category : null;
  const retryAfterMs = normalizeRetryAfterMs(kapsoError.retry?.retryAfterMs);

  if (httpStatus === 429 || category === "throttling") {
    return {
      retryable: true,
      kind: "rate_limit",
      httpStatus,
      category,
      retryAfterMs,
    };
  }

  if (httpStatus !== null && httpStatus >= 500) {
    return {
      retryable: true,
      kind: "server",
      httpStatus,
      category,
      retryAfterMs,
    };
  }

  if (httpStatus !== null && httpStatus >= 400) {
    return {
      retryable: false,
      kind: "client",
      httpStatus,
      category,
      retryAfterMs,
    };
  }

  return {
    retryable: true,
    kind: "network",
    httpStatus,
    category,
    retryAfterMs,
  };
}

export function getKapsoRetryDelayMs(
  classification: KapsoErrorClassification,
  attempt: number,
) {
  if (classification.retryAfterMs !== null) {
    return classification.retryAfterMs;
  }

  const exponentialDelay = Math.min(
    DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    MAX_RETRY_DELAY_MS,
  );
  const jitter = Math.floor(Math.random() * 1_000);

  return exponentialDelay + jitter;
}

export function serializeKapsoError(error: unknown) {
  const kapsoError = asKapsoError(error);

  if (!kapsoError) {
    return {
      message: String(error),
    };
  }

  return {
    name: kapsoError.name,
    message: kapsoError.message,
    httpStatus: kapsoError.httpStatus ?? null,
    code: kapsoError.code ?? null,
    category: kapsoError.category ?? null,
    retry: kapsoError.retry ?? null,
    raw: kapsoError.raw ?? null,
  };
}
