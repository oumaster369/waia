import { afterEach, describe, expect, it, vi } from "vitest";

import { assertAdminConsoleSameOrigin, staleRevisionResult } from "@/lib/trader/admin-console/auth";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import { readAdminRelease } from "@/lib/trader/admin-console/release";

describe("admin console release", () => {
  it("rejects a missing or malformed SHA and accepts a 40-hex digest as unverified", () => {
    expect(readAdminRelease({ WAIA_RELEASE_SHA: "" })).toEqual({
      state: "unavailable",
      reason: "WAIA_RELEASE_SHA_NOT_SET",
    });
    expect(readAdminRelease({ WAIA_RELEASE_SHA: "abc" })).toEqual({
      state: "unavailable",
      reason: "WAIA_RELEASE_SHA_NOT_SET",
    });
    expect(readAdminRelease({ WAIA_RELEASE_SHA: "A".repeat(40) })).toEqual({
      state: "value",
      sha: "a".repeat(40),
      source: "WAIA_RELEASE_SHA",
      verified: false,
      reason: "RELEASE_SHA_UNVERIFIED",
    });
  });
});

describe("admin console order mode", () => {
  it("maps historical, live, paper, and mock", () => {
    expect(orderMode({ historicalRunId: "run-1", executionMode: "live" })).toBe("history");
    expect(orderMode({ historicalRunId: null, executionMode: "live" })).toBe("live");
    expect(orderMode({ historicalRunId: null, executionMode: "paper" })).toBe("paper");
    expect(orderMode({ historicalRunId: null, executionMode: "mock" })).toBe("undetermined");
  });
});

describe("admin console origin and revision", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts an internal Next address only for the configured trader origin and matching Host", () => {
    vi.stubEnv("NEXT_PUBLIC_TRADER_URL", "https://trader.waia.example");
    const check = (origin: string, host: string, extra: Record<string, string> = {}) =>
      assertAdminConsoleSameOrigin(
        new Request("http://0.0.0.0:3000/api/trader/admin/console/kill-switch", {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8", origin, host, ...extra },
        }),
      );
    expect(check("https://trader.waia.example", "trader.waia.example")).toBeNull();
    expect(check("https://evil.example", "evil.example")?.status).toBe(403);
    expect(
      check("https://trader.waia.example", "evil.example", {
        "x-forwarded-host": "trader.waia.example",
      })?.status,
    ).toBe(403);
    expect(check("http://trader.waia.example", "trader.waia.example")?.status).toBe(403);
    expect(check("https://trader.waia.example/path", "trader.waia.example")?.status).toBe(403);
    expect(
      check("https://trader.waia.example", "trader.waia.example", {
        "content-type": "text/application/json",
      })?.status,
    ).toBe(403);
  });
  it("rejects a missing origin, a foreign origin, and a non-JSON content type", () => {
    const missing = assertAdminConsoleSameOrigin(
      new Request("http://localhost/api/trader/admin/console/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(missing?.status).toBe(403);
    expect(missing?.body).toMatchObject({ error: { code: ADMIN_REASON.originRejected } });

    const foreign = assertAdminConsoleSameOrigin(
      new Request("http://localhost/api/trader/admin/console/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
      }),
    );
    expect(foreign?.status).toBe(403);

    const accepted = assertAdminConsoleSameOrigin(
      new Request("http://localhost/api/trader/admin/console/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
      }),
    );
    expect(accepted).toBeNull();
  });

  it("returns the current state with a stale revision", () => {
    const result = staleRevisionResult({ revision: "abc", views: [] });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: { code: "STALE_REVISION" },
      current: { revision: "abc", views: [] },
    });
  });
});
