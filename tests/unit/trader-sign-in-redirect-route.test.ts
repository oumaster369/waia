import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET } from "../../app/(trader)/trader/sign-in/route";

const originalTraderUrl = process.env.NEXT_PUBLIC_TRADER_URL;
const originalTraderHost = process.env.WAIA_TRADER_HOST;

afterEach(() => {
  if (originalTraderUrl === undefined) delete process.env.NEXT_PUBLIC_TRADER_URL;
  else process.env.NEXT_PUBLIC_TRADER_URL = originalTraderUrl;
  if (originalTraderHost === undefined) delete process.env.WAIA_TRADER_HOST;
  else process.env.WAIA_TRADER_HOST = originalTraderHost;
});

describe("Trader sign-in runtime redirect", () => {
  it("uses the configured Trader URL at request time", () => {
    process.env.NEXT_PUBLIC_TRADER_URL = "https://trader.example.test/base";
    delete process.env.WAIA_TRADER_HOST;

    const response = GET(new Request("https://preview.example.test/trader/sign-in"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://trader.example.test/");
  });

  it("uses the configured Trader host when no Trader URL is configured", () => {
    delete process.env.NEXT_PUBLIC_TRADER_URL;
    process.env.WAIA_TRADER_HOST = "trader.example.test";

    const response = GET(new Request("https://preview.example.test/trader/sign-in"));
    expect(response.headers.get("location")).toBe("https://trader.example.test/");
  });

  it("falls back to the request origin without inventing a local hostname", () => {
    delete process.env.NEXT_PUBLIC_TRADER_URL;
    delete process.env.WAIA_TRADER_HOST;

    const response = GET(new Request("https://preview.example.test/trader/sign-in?returnTo=https://attacker.test"));
    expect(response.headers.get("location")).toBe("https://preview.example.test/");
    expect(response.headers.get("location")).not.toContain("localhost");
  });

  it("fails closed on malformed configured origins and has no auth or database dependency", () => {
    process.env.NEXT_PUBLIC_TRADER_URL = "javascript:alert(1)";
    delete process.env.WAIA_TRADER_HOST;
    const response = GET(new Request("https://preview.example.test/trader/sign-in"));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();

    const source = readFileSync(
      join(process.cwd(), "app/(trader)/trader/sign-in/route.ts"),
      "utf8",
    );
    expect(source).toContain('dynamic = "force-dynamic"');
    expect(source).toContain("process.env[name]");
    expect(source).not.toContain("process.env.NEXT_PUBLIC_TRADER_URL");
    expect(source).not.toMatch(/getOptionalSessionUserId|getWaiaRuntimeDb|ensureTraderSelfServiceAccess/);
  });
});
