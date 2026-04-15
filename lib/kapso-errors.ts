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

type KapsoErrorRaw = {
  error?: unknown;
  nextSteps?: unknown;
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

function getKapsoErrorMessage(error: KapsoLikeError) {
  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  const raw = error.raw as KapsoErrorRaw | undefined;

  if (raw && typeof raw.error === "string" && raw.error.length > 0) {
    return raw.error;
  }

  return "";
}

export function isKapsoOutside24HourWindowError(error: unknown) {
  const kapsoError = asKapsoError(error);

  if (!kapsoError) {
    return false;
  }

  const message = getKapsoErrorMessage(kapsoError).toLowerCase();
  const raw = kapsoError.raw as KapsoErrorRaw | undefined;
  const nextSteps =
    raw && typeof raw.nextSteps === "string" ? raw.nextSteps.toLowerCase() : "";

  return (
    message.includes("cannot send non-template messages outside the 24-hour window") ||
    nextSteps.includes("template message to reopen the session")
  );
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
