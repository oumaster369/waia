/** HTX REST transport retry/throttle policy (P8 S3 — DEE-346). */

export type HtxTransportPolicy = {
  /** Minimum spacing between consecutive requests (deterministic throttle). */
  minIntervalMs: number;
  /** Maximum retry attempts after the first request (429 / transient 5xx / envelope rate limit). */
  maxRetries: number;
  /** Base delay for exponential backoff. */
  baseDelayMs: number;
  /** Upper bound for computed retry delay. */
  maxDelayMs: number;
};

export const DEFAULT_HTX_TRANSPORT_POLICY: HtxTransportPolicy = {
  minIntervalMs: 100,
  maxRetries: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

export type HtxRateLimitSnapshot = {
  requestsRemain: number | null;
  requestsExpireAtMs: number | null;
};

const HTX_RATE_LIMIT_REMAIN_HEADER = "x-hb-ratelimit-requests-remain";
const HTX_RATE_LIMIT_EXPIRE_HEADER = "x-hb-ratelimit-requests-expire";

export function parseHtxRateLimitHeaders(headers: Headers): HtxRateLimitSnapshot {
  const remainRaw = headers.get(HTX_RATE_LIMIT_REMAIN_HEADER);
  const expireRaw = headers.get(HTX_RATE_LIMIT_EXPIRE_HEADER);

  const requestsRemain =
    remainRaw === null || remainRaw.trim() === "" ? null : Number.parseInt(remainRaw, 10);
  const requestsExpireAtMs =
    expireRaw === null || expireRaw.trim() === "" ? null : Number.parseInt(expireRaw, 10);

  return {
    requestsRemain: Number.isFinite(requestsRemain) ? requestsRemain : null,
    requestsExpireAtMs: Number.isFinite(requestsExpireAtMs) ? requestsExpireAtMs : null,
  };
}

export function parseRetryAfterMs(headers: Headers): number | null {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

export function isRetryableHtxHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isHtxRateLimitEnvelope(body: unknown): boolean {
  if (body === null || typeof body !== "object") {
    return false;
  }

  const record = body as Record<string, unknown>;

  if (typeof record.code === "number" && record.code === 1006) {
    return true;
  }

  const errCode = record["err-code"];
  if (typeof errCode === "string") {
    const normalized = errCode.toLowerCase();
    return normalized === "too-many-requests" || normalized === "rate-limit-error";
  }

  return false;
}

export function computeRetryDelayMs(
  attempt: number,
  policy: HtxTransportPolicy,
  headers?: Headers,
  nowMs: number = Date.now(),
): number {
  const retryAfterMs = headers ? parseRetryAfterMs(headers) : null;
  if (retryAfterMs !== null) {
    return Math.min(policy.maxDelayMs, retryAfterMs);
  }

  const rateLimit = headers ? parseHtxRateLimitHeaders(headers) : null;
  if (
    rateLimit !== null &&
    rateLimit.requestsExpireAtMs !== null &&
    rateLimit.requestsRemain === 0
  ) {
    const waitMs = rateLimit.requestsExpireAtMs - nowMs;
    if (waitMs > 0) {
      return Math.min(policy.maxDelayMs, waitMs);
    }
  }

  const exponential = policy.baseDelayMs * 2 ** attempt;
  return Math.min(policy.maxDelayMs, exponential);
}
