import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTraderHostIsolationRedirects } from "@/lib/hosts/cross-host-redirects";

describe("buildTraderHostIsolationRedirects (AT-E1 S2)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "WAIA_PRIMARY_HOST",
      "WAIA_TRADER_HOST",
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_TRADER_URL",
      "WAIA_TRADER_HOST_ROUTING",
    ]) {
      prev[key] = process.env[key];
    }
    process.env.WAIA_PRIMARY_HOST = "127.0.0.1";
    process.env.WAIA_TRADER_HOST = "trader.localhost";
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3199";
    process.env.NEXT_PUBLIC_TRADER_URL = "http://trader.localhost:3199";
    delete process.env.WAIA_TRADER_HOST_ROUTING;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("emits absolute primary destinations for trader host dashboard paths", () => {
    const redirects = buildTraderHostIsolationRedirects();
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/dashboard",
          destination: "http://127.0.0.1:3199/dashboard",
          has: [{ type: "host", value: "trader.localhost" }],
        }),
        expect.objectContaining({
          source: "/api/dashboard/:path*",
          destination: "http://127.0.0.1:3199/api/dashboard/:path*",
        }),
      ]),
    );
  });

  it("returns no redirects when trader host routing is disabled", () => {
    process.env.WAIA_TRADER_HOST_ROUTING = "off";
    expect(buildTraderHostIsolationRedirects()).toEqual([]);
  });
});
