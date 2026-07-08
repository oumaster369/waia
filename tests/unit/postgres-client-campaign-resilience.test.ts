import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pgMocks = vi.hoisted(() => {
  const instances: Array<{ end: ReturnType<typeof vi.fn> }> = [];
  const factory = vi.fn(() => {
    const end = vi.fn().mockResolvedValue(undefined);
    instances.push({ end });
    return { end };
  });
  return { instances, factory };
});

const drizzleMocks = vi.hoisted(() => ({
  drizzle: vi.fn(() => ({})),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: pgMocks.factory,
}));

vi.mock("drizzle-orm/postgres-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm/postgres-js")>();
  return {
    ...actual,
    drizzle: drizzleMocks.drizzle,
  };
});

import {
  DEFAULT_CAMPAIGN_DB_RETRY_POLICY,
  computeCampaignDbRetryDelayMs,
  createLongRunningCampaignPostgresRuntime,
  isTransientConnectionError,
  resolveCampaignPostgresUrl,
  waiaCampaignPostgresDriverOptions,
  withCampaignDbRetry,
} from "@/db/postgres-client";

describe("waiaCampaignPostgresDriverOptions", () => {
  afterEach(() => {
    delete process.env.WAIA_POSTGRES_PREPARE_STATEMENTS;
  });

  it("tunes for long-running single-connection CLI campaigns", () => {
    delete process.env.WAIA_POSTGRES_PREPARE_STATEMENTS;
    expect(waiaCampaignPostgresDriverOptions()).toEqual({
      max: 1,
      prepare: false,
      idle_timeout: 0,
      connect_timeout: 30,
      max_lifetime: 1800,
      keep_alive: 30,
    });
  });
});

describe("resolveCampaignPostgresUrl", () => {
  const savedSession = process.env.DATABASE_URL_POSTGRES_SESSION;
  const savedTransaction = process.env.DATABASE_URL_POSTGRES;

  afterEach(() => {
    if (savedSession === undefined) delete process.env.DATABASE_URL_POSTGRES_SESSION;
    else process.env.DATABASE_URL_POSTGRES_SESSION = savedSession;
    if (savedTransaction === undefined) delete process.env.DATABASE_URL_POSTGRES;
    else process.env.DATABASE_URL_POSTGRES = savedTransaction;
    vi.restoreAllMocks();
  });

  it("prefers DATABASE_URL_POSTGRES_SESSION when set", () => {
    process.env.DATABASE_URL_POSTGRES_SESSION = "postgresql://session/db";
    process.env.DATABASE_URL_POSTGRES = "postgresql://transaction/db";
    expect(resolveCampaignPostgresUrl()).toEqual({
      url: "postgresql://session/db",
      source: "session",
    });
  });

  it("falls back to DATABASE_URL_POSTGRES with a warning when session URL is unset", () => {
    delete process.env.DATABASE_URL_POSTGRES_SESSION;
    process.env.DATABASE_URL_POSTGRES = "postgresql://transaction/db";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(resolveCampaignPostgresUrl()).toEqual({
      url: "postgresql://transaction/db",
      source: "transaction_fallback",
    });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("DATABASE_URL_POSTGRES_SESSION");
  });

  it("throws when neither URL is set", () => {
    delete process.env.DATABASE_URL_POSTGRES_SESSION;
    delete process.env.DATABASE_URL_POSTGRES;
    expect(() => resolveCampaignPostgresUrl()).toThrow(/DATABASE_URL_POSTGRES/);
  });
});

describe("createLongRunningCampaignPostgresRuntime", () => {
  beforeEach(() => {
    pgMocks.instances.length = 0;
    pgMocks.factory.mockClear();
    process.env.DATABASE_URL_POSTGRES_SESSION = "postgresql://session/db";
    delete process.env.DATABASE_URL_POSTGRES;
  });

  afterEach(() => {
    delete process.env.DATABASE_URL_POSTGRES_SESSION;
  });

  it("connects with the campaign driver options and reports the resolved url source", () => {
    const runtime = createLongRunningCampaignPostgresRuntime();
    expect(runtime.urlSource).toBe("session");
    expect(pgMocks.factory).toHaveBeenCalledWith(
      "postgresql://session/db",
      expect.objectContaining({ max: 1, idle_timeout: 0, connect_timeout: 30, max_lifetime: 1800 }),
    );
  });
});

describe("isTransientConnectionError", () => {
  it.each<[string, { code?: string; message?: string }]>([
    ["CONNECTION_CLOSED code", { code: "CONNECTION_CLOSED", message: "write CONNECTION_CLOSED" }],
    ["CONNECTION_ENDED code", { code: "CONNECTION_ENDED" }],
    ["ECONNRESET code", { code: "ECONNRESET" }],
    ["ETIMEDOUT code", { code: "ETIMEDOUT" }],
    ["CONNECT_TIMEOUT code", { code: "CONNECT_TIMEOUT" }],
    ["message-only closed connection", { message: "Connection closed unexpectedly" }],
    [
      "message-only write closed",
      { message: "write CONNECTION_CLOSED aws-1-eu-central-1.pooler.supabase.com:6543" },
    ],
  ])("classifies %s as transient", (_label, shape) => {
    const error = Object.assign(new Error(shape.message ?? "transient"), {
      code: shape.code,
    });
    expect(isTransientConnectionError(error)).toBe(true);
  });

  it.each([
    ["generic Error", new Error("boom")],
    ["null", null],
    ["undefined", undefined],
    ["string", "boom"],
    ["logic error", new Error("sell quantity 1 exceeds open quantity 0")],
  ])("classifies %s as non-transient", (_label, error) => {
    expect(isTransientConnectionError(error)).toBe(false);
  });
});

describe("computeCampaignDbRetryDelayMs", () => {
  it("stays within [0, min(maxDelayMs, baseDelayMs * 2^attempt)]", () => {
    const policy = DEFAULT_CAMPAIGN_DB_RETRY_POLICY;
    for (let attempt = 0; attempt < 8; attempt++) {
      const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
      for (const random of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const delay = computeCampaignDbRetryDelayMs(attempt, policy, () => random);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("never exceeds maxDelayMs even at high attempt counts", () => {
    const policy = DEFAULT_CAMPAIGN_DB_RETRY_POLICY;
    const delay = computeCampaignDbRetryDelayMs(20, policy, () => 1);
    expect(delay).toBeLessThanOrEqual(policy.maxDelayMs);
  });
});

describe("withCampaignDbRetry", () => {
  const instantSleep = () => Promise.resolve();

  it("recovers after transient failures and returns the eventual result", async () => {
    let calls = 0;
    const result = await withCampaignDbRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("write CONNECTION_CLOSED"), {
            code: "CONNECTION_CLOSED",
          });
        }
        return "ok";
      },
      { sleep: instantSleep, random: () => 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("invokes onRetry with attempt number and delay for each transient failure", async () => {
    let calls = 0;
    const onRetry = vi.fn();
    await withCampaignDbRetry(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
        }
        return "ok";
      },
      { sleep: instantSleep, random: () => 0, onRetry },
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it("rethrows the original transient error once retries are exhausted (bounded attempts)", async () => {
    let calls = 0;
    const transientError = Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
    });
    const policy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 };

    await expect(
      withCampaignDbRetry(
        async () => {
          calls += 1;
          throw transientError;
        },
        { sleep: instantSleep, random: () => 0, policy },
      ),
    ).rejects.toBe(transientError);
    expect(calls).toBe(3); // exactly maxAttempts — bounded, never unbounded/duplicated
  });

  it("rethrows a non-transient error immediately without retrying", async () => {
    let calls = 0;
    const fatal = new Error("boom");
    await expect(
      withCampaignDbRetry(
        async () => {
          calls += 1;
          throw fatal;
        },
        { sleep: instantSleep },
      ),
    ).rejects.toBe(fatal);
    expect(calls).toBe(1);
  });
});
