import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { safeAuthRedirectTarget } from "@/lib/landing/safe-auth-redirect";

describe("safeAuthRedirectTarget (AT-E1 S2)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    prev.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
    prev.NEXT_PUBLIC_TRADER_URL = process.env.NEXT_PUBLIC_TRADER_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3199";
    process.env.NEXT_PUBLIC_TRADER_URL = "http://trader.localhost:3199";
  });

  afterEach(() => {
    if (prev.NEXT_PUBLIC_SITE_URL === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = prev.NEXT_PUBLIC_SITE_URL;
    }
    if (prev.NEXT_PUBLIC_TRADER_URL === undefined) {
      delete process.env.NEXT_PUBLIC_TRADER_URL;
    } else {
      process.env.NEXT_PUBLIC_TRADER_URL = prev.NEXT_PUBLIC_TRADER_URL;
    }
  });

  it("accepts internal paths", () => {
    expect(safeAuthRedirectTarget("/dashboard")).toBe("/dashboard");
  });

  it("accepts absolute URLs on configured module origins", () => {
    expect(safeAuthRedirectTarget("http://127.0.0.1:3199/dashboard")).toBe(
      "http://127.0.0.1:3199/dashboard",
    );
  });

  it("rejects external absolute URLs", () => {
    expect(safeAuthRedirectTarget("https://evil.example/x")).toBeNull();
  });
});
