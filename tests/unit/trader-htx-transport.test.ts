import { describe, expect, it, vi } from "vitest";

import { HtxRestClient, HtxApiError } from "@/lib/trader/connectors/htx/client";
import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import { DeterministicRequestThrottle, HtxTransport } from "@/lib/trader/connectors/htx/transport";
import {
  computeRetryDelayMs,
  DEFAULT_HTX_TRANSPORT_POLICY,
  isHtxRateLimitEnvelope,
  isRetryableHtxHttpStatus,
  parseHtxRateLimitHeaders,
  parseRetryAfterMs,
} from "@/lib/trader/connectors/htx/transport-policy";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("HTX transport policy helpers (DEE-346)", () => {
  it("detects retryable HTTP statuses", () => {
    expect(isRetryableHtxHttpStatus(429)).toBe(true);
    expect(isRetryableHtxHttpStatus(503)).toBe(true);
    expect(isRetryableHtxHttpStatus(400)).toBe(false);
    expect(isRetryableHtxHttpStatus(401)).toBe(false);
  });

  it("detects HTX rate-limit envelopes", () => {
    expect(
      isHtxRateLimitEnvelope({
        status: "error",
        "err-code": "too-many-requests",
        "err-msg": "exceededratelimit",
      }),
    ).toBe(true);
    expect(isHtxRateLimitEnvelope({ code: 1006, message: "exceededratelimit" })).toBe(true);
    expect(
      isHtxRateLimitEnvelope({ status: "error", "err-code": "login-required", "err-msg": "nope" }),
    ).toBe(false);
  });

  it("parses HTX rate-limit headers", () => {
    const headers = new Headers({
      "X-HB-RateLimit-Requests-Remain": "12",
      "X-HB-RateLimit-Requests-Expire": "1710000000000",
    });
    expect(parseHtxRateLimitHeaders(headers)).toEqual({
      requestsRemain: 12,
      requestsExpireAtMs: 1_710_000_000_000,
    });
  });

  it("parses Retry-After seconds", () => {
    const headers = new Headers({ "Retry-After": "2" });
    expect(parseRetryAfterMs(headers)).toBe(2_000);
  });

  it("computes exponential backoff capped by maxDelayMs", () => {
    const delay = computeRetryDelayMs(3, DEFAULT_HTX_TRANSPORT_POLICY);
    expect(delay).toBe(2_000);
  });

  it("prefers Retry-After over exponential backoff", () => {
    const headers = new Headers({ "Retry-After": "5" });
    const delay = computeRetryDelayMs(1, DEFAULT_HTX_TRANSPORT_POLICY, headers);
    expect(delay).toBe(5_000);
  });
});

describe("DeterministicRequestThrottle (DEE-346)", () => {
  it("enforces deterministic min interval between slots", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    };

    const throttle = new DeterministicRequestThrottle(100, clock);
    await throttle.awaitSlot();
    await throttle.awaitSlot();
    await throttle.awaitSlot();

    expect(sleeps).toEqual([100, 100]);
  });

  it("extends the next slot when HTX rate-limit remain hits zero", async () => {
    let now = 1_000;
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };

    const throttle = new DeterministicRequestThrottle(50, clock);
    await throttle.awaitSlot();
    throttle.observeHeaders(
      new Headers({
        "X-HB-RateLimit-Requests-Remain": "0",
        "X-HB-RateLimit-Requests-Expire": "1500",
      }),
    );

    const before = now;
    await throttle.awaitSlot();
    expect(now - before).toBe(500);
  });
});

describe("HtxTransport (DEE-346)", () => {
  it("does not retry application errors thrown by an injected fetch", async () => {
    const applicationError = new Error("Unexpected fetch URL");
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      throw applicationError;
    }) as typeof fetch;
    const clock = {
      now: () => 1_000,
      sleep: vi.fn(async () => undefined),
    };
    const transport = new HtxTransport(fetchImpl, {
      ...DEFAULT_HTX_TRANSPORT_POLICY,
      minIntervalMs: 0,
      maxRetries: 4,
    }, clock);

    await expect(transport.fetch("https://api.huobi.pro/market/history/candles"))
      .rejects.toBe(applicationError);
    expect(attempts).toBe(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("retries transient fetch exceptions then succeeds", async () => {
    const networkError = new TypeError("fetch failed");
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts <= 2) throw networkError;
      return jsonResponse({ status: "ok" });
    }) as typeof fetch;
    const clock = {
      now: () => 1_000,
      sleep: vi.fn(async () => undefined),
    };
    const transport = new HtxTransport(fetchImpl, {
      ...DEFAULT_HTX_TRANSPORT_POLICY,
      minIntervalMs: 0,
      maxRetries: 2,
    }, clock);

    await expect(transport.fetch("https://api.huobi.pro/market/history/candles"))
      .resolves.toHaveProperty("status", 200);
    expect(attempts).toBe(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it("rethrows the final fetch exception unchanged after bounded exhaustion", async () => {
    const networkError = new TypeError("fetch failed");
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      throw networkError;
    }) as typeof fetch;
    const clock = {
      now: () => 1_000,
      sleep: vi.fn(async () => undefined),
    };
    const transport = new HtxTransport(fetchImpl, {
      ...DEFAULT_HTX_TRANSPORT_POLICY,
      minIntervalMs: 0,
      maxRetries: 2,
    }, clock);

    await expect(transport.fetch("https://api.huobi.pro/market/history/candles"))
      .rejects.toBe(networkError);
    expect(attempts).toBe(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 429 then succeeds", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ status: "error" }, 429, { "Retry-After": "0" });
      }
      return jsonResponse({ status: "ok", data: [] });
    }) as typeof fetch;

    const clock = {
      now: () => Date.now(),
      sleep: vi.fn(async () => undefined),
    };

    const transport = new HtxTransport(
      fetchImpl,
      { ...DEFAULT_HTX_TRANSPORT_POLICY, minIntervalMs: 0 },
      clock,
    );
    const response = await transport.fetch("https://api.huobi.pro/v1/account/accounts");
    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
    expect(clock.sleep).toHaveBeenCalled();
  });

  it("retries transient 503 then succeeds", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts <= 2) {
        return jsonResponse({ message: "upstream" }, 503);
      }
      return jsonResponse({ status: "ok" });
    }) as typeof fetch;

    const transport = new HtxTransport(fetchImpl, {
      ...DEFAULT_HTX_TRANSPORT_POLICY,
      minIntervalMs: 0,
    });
    const response = await transport.fetch("https://api.huobi.pro/market/detail/merged");
    expect(response.status).toBe(200);
    expect(attempts).toBe(3);
  });

  it("returns final retryable response after maxRetries exhausted", async () => {
    const fetchImpl = (async () => jsonResponse({ message: "busy" }, 503)) as typeof fetch;
    const transport = new HtxTransport(fetchImpl, {
      ...DEFAULT_HTX_TRANSPORT_POLICY,
      minIntervalMs: 0,
      maxRetries: 2,
    });
    const response = await transport.fetch("https://api.huobi.pro/v1/account/accounts");
    expect(response.status).toBe(503);
  });

  it("does not retry non-retryable 400 responses", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return jsonResponse({ status: "error" }, 400);
    }) as typeof fetch;

    const transport = new HtxTransport(fetchImpl, {
      ...DEFAULT_HTX_TRANSPORT_POLICY,
      minIntervalMs: 0,
    });
    const response = await transport.fetch("https://api.huobi.pro/v1/account/accounts");
    expect(response.status).toBe(400);
    expect(attempts).toBe(1);
  });
});

describe("HtxRestClient envelope rate-limit retry (DEE-346)", () => {
  it("retries signed GET on HTX v1 rate-limit envelope", async () => {
    let attempts = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      attempts += 1;
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (!url.pathname.endsWith(HTX_ENDPOINTS.accounts)) {
        throw new Error(`Unexpected path: ${url.pathname}`);
      }
      if (attempts === 1) {
        return jsonResponse({
          status: "error",
          "err-code": "too-many-requests",
          "err-msg": "exceededratelimit",
        });
      }
      return jsonResponse({
        status: "ok",
        data: [{ id: 1, type: "spot", state: "working" }],
      });
    }) as typeof fetch;

    vi.useFakeTimers();
    const client = new HtxRestClient({
      apiKey: "key",
      apiSecret: "secret",
      fetchImpl,
      transportPolicy: { ...DEFAULT_HTX_TRANSPORT_POLICY, minIntervalMs: 0, baseDelayMs: 1 },
    });

    const promise = client.getAccounts();
    await vi.runAllTimersAsync();
    const accounts = await promise;

    expect(accounts).toHaveLength(1);
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });

  it("throws HtxApiError when rate-limit envelope persists", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        status: "error",
        "err-code": "too-many-requests",
        "err-msg": "exceededratelimit",
      })) as typeof fetch;

    vi.useFakeTimers();
    const client = new HtxRestClient({
      apiKey: "key",
      apiSecret: "secret",
      fetchImpl,
      transportPolicy: {
        ...DEFAULT_HTX_TRANSPORT_POLICY,
        minIntervalMs: 0,
        maxRetries: 1,
        baseDelayMs: 1,
      },
    });

    const promise = client.getAccounts();
    const expectation = expect(promise).rejects.toBeInstanceOf(HtxApiError);
    await vi.runAllTimersAsync();
    await expectation;
    vi.useRealTimers();
  });
});
