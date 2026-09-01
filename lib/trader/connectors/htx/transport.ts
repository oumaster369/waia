import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import {
  DEFAULT_HTX_TRANSPORT_POLICY,
  type HtxRateLimitSnapshot,
  type HtxTransportPolicy,
  computeRetryDelayMs,
  isRetryableHtxHttpStatus,
  parseHtxRateLimitHeaders,
} from "@/lib/trader/connectors/htx/transport-policy";

export type HtxTransportClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const defaultClock: HtxTransportClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function isRetryableFetchFailure(error: unknown): boolean {
  // The Fetch standard reports DNS, socket, TLS and connection-reset failures
  // as TypeError. Do not retry arbitrary application errors thrown by an
  // injected fetch implementation, nor explicit abort/timeout signals.
  return error instanceof TypeError;
}

/** Deterministic min-interval throttle with optional HTX rate-limit header adjustment. */
export class DeterministicRequestThrottle {
  private nextAllowedAtMs: number;
  private readonly minIntervalMs: number;
  private readonly clock: HtxTransportClock;

  constructor(minIntervalMs: number, clock: HtxTransportClock = defaultClock) {
    this.minIntervalMs = minIntervalMs;
    this.clock = clock;
    this.nextAllowedAtMs = clock.now();
  }

  async awaitSlot(): Promise<void> {
    const now = this.clock.now();
    const waitMs = this.nextAllowedAtMs - now;
    if (waitMs > 0) {
      await this.clock.sleep(waitMs);
    }
    this.nextAllowedAtMs = Math.max(this.nextAllowedAtMs, this.clock.now()) + this.minIntervalMs;
  }

  observeHeaders(headers: Headers): void {
    const snapshot = parseHtxRateLimitHeaders(headers);
    if (snapshot.requestsRemain === 0 && snapshot.requestsExpireAtMs !== null) {
      this.nextAllowedAtMs = Math.max(this.nextAllowedAtMs, snapshot.requestsExpireAtMs);
    }
  }
}

/** HTX REST transport: throttle + retry for 429/transient 5xx. */
export class HtxTransport {
  private readonly fetchImpl: HtxFetchFn;
  private readonly policy: HtxTransportPolicy;
  private readonly clock: HtxTransportClock;
  private readonly throttle: DeterministicRequestThrottle;
  private lastRateLimit: HtxRateLimitSnapshot | null = null;

  constructor(
    fetchImpl: HtxFetchFn,
    policy: HtxTransportPolicy = DEFAULT_HTX_TRANSPORT_POLICY,
    clock: HtxTransportClock = defaultClock,
  ) {
    this.fetchImpl = fetchImpl;
    this.policy = policy;
    this.clock = clock;
    this.throttle = new DeterministicRequestThrottle(policy.minIntervalMs, clock);
  }

  getLastRateLimitSnapshot(): HtxRateLimitSnapshot | null {
    return this.lastRateLimit;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let response: Response | null = null;

    for (let attempt = 0; attempt <= this.policy.maxRetries; attempt++) {
      await this.throttle.awaitSlot();
      try {
        response = await this.fetchImpl(input, init);
      } catch (error) {
        // Native fetch rejects before an HTTP response exists for transient
        // DNS, socket, TLS and connection-reset failures.  Long-running public
        // historical acquisition must apply the same bounded deterministic
        // retry budget to those failures as it does to transient 5xx replies.
        // The final error is rethrown unchanged so callers retain fail-closed
        // classification and never mistake exhaustion for an HTTP response.
        if (!isRetryableFetchFailure(error) || attempt === this.policy.maxRetries) {
          throw error;
        }
        const delayMs = computeRetryDelayMs(attempt, this.policy, undefined, this.clock.now());
        await this.clock.sleep(delayMs);
        continue;
      }
      this.throttle.observeHeaders(response.headers);
      this.lastRateLimit = parseHtxRateLimitHeaders(response.headers);

      if (!isRetryableHtxHttpStatus(response.status)) {
        return response;
      }

      if (attempt === this.policy.maxRetries) {
        return response;
      }

      const delayMs = computeRetryDelayMs(attempt, this.policy, response.headers, this.clock.now());
      await this.clock.sleep(delayMs);
    }

    return response!;
  }
}
