import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as opennext from "@opennextjs/cloudflare";

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

import type postgres from "postgres";

import {
  POSTGRES_CLOSE_GRACE_TIMEOUT_S,
  POSTGRES_CLOSE_INLINE_BUDGET_MS,
  createPerRequestPostgresRuntime,
  disposePostgresClientSafely,
  resetPostgresSingletonForTests,
  shouldUsePerRequestPostgresClient,
  withWaiaPostgresClient,
} from "@/db/postgres-client";

describe("shouldUsePerRequestPostgresClient", () => {
  const saved = process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT;
    } else {
      process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT = saved;
    }
  });

  it.each([
    ["(unset)", undefined as string | undefined, true],
    ["true", "true", true],
    ["TRUE", "TRUE", true],
    ["1", "1", true],
    ["yes", "yes", true],
    ["on", "on", true],
    ["false", "false", false],
    ["0", "0", false],
    ["no", "no", false],
    ["off", "off", false],
    ["bogus", "bogus", true],
  ])("parses WAIA_POSTGRES_PER_REQUEST_CLIENT=%s → %s", (_label, raw, expected) => {
    if (raw === undefined) {
      delete process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT;
    } else {
      process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT = raw;
    }
    expect(shouldUsePerRequestPostgresClient()).toBe(expected);
  });
});

describe("createPerRequestPostgresRuntime / disposePostgresClientSafely", () => {
  beforeEach(async () => {
    pgMocks.instances.length = 0;
    pgMocks.factory.mockClear();
    drizzleMocks.drizzle.mockClear();
    drizzleMocks.drizzle.mockImplementation(() => ({}));
    await resetPostgresSingletonForTests();
    vi.mocked(opennext.getCloudflareContext).mockImplementation(() => {
      throw new Error("no cf context");
    });
    process.env.DATABASE_URL_POSTGRES = "postgresql://mock/local";
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL_POSTGRES;
    await resetPostgresSingletonForTests();
    vi.mocked(opennext.getCloudflareContext).mockReset();
  });

  it("does not populate legacy postgres singleton globals", () => {
    createPerRequestPostgresRuntime();
    const g = globalThis as unknown as {
      __waia_postgres_js__?: unknown;
      __waia_postgres_drizzle__?: unknown;
    };
    expect(g.__waia_postgres_js__).toBeUndefined();
    expect(g.__waia_postgres_drizzle__).toBeUndefined();
  });

  it("calls sql.end once with grace timeout when closing inline", async () => {
    createPerRequestPostgresRuntime();
    const sql = pgMocks.instances[0];
    await disposePostgresClientSafely(sql as unknown as postgres.Sql);
    expect(sql.end).toHaveBeenCalledOnce();
    expect(sql.end).toHaveBeenCalledWith({ timeout: POSTGRES_CLOSE_GRACE_TIMEOUT_S });
  });

  it("defers close via waitUntil without returning an outcome", async () => {
    createPerRequestPostgresRuntime();
    const sql = pgMocks.instances[0];
    const waitUntil = vi.fn();
    vi.mocked(opennext.getCloudflareContext).mockReturnValue({ ctx: { waitUntil } } as never);
    const outcome = await disposePostgresClientSafely(sql as unknown as postgres.Sql);
    expect(outcome).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledOnce();
    const [[arg]] = waitUntil.mock.calls;
    expect(arg).toBeInstanceOf(Promise);
  });

  it("returns timeout when inline budget elapses before close completes", async () => {
    vi.useFakeTimers();
    createPerRequestPostgresRuntime();
    const sql = pgMocks.instances[0];
    sql.end.mockImplementation(() => new Promise(() => {}));

    const p = disposePostgresClientSafely(sql as unknown as postgres.Sql);
    await vi.advanceTimersByTimeAsync(POSTGRES_CLOSE_INLINE_BUDGET_MS + 1);
    await expect(p).resolves.toBe("timeout");

    vi.useRealTimers();
  });

  it("withWaiaPostgresClient disposes after the handler resolves", async () => {
    const result = await withWaiaPostgresClient(async () => {
      expect(pgMocks.instances).toHaveLength(1);
      return 42;
    });
    expect(result).toBe(42);
    expect(pgMocks.instances[0].end).toHaveBeenCalled();
  });
});
