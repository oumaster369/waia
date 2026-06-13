import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildModuleUrl,
  extractHostnameFromHeaders,
  isModuleHost,
  normalizeHostname,
  resolveModuleHost,
} from "@/lib/hosts/resolve";
import { resolveWaiaCookieDomain } from "@/lib/hosts/cookie-domain";

describe("hosts resolve (AT-E1 S2)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "WAIA_PRIMARY_HOST",
      "WAIA_TRADER_HOST",
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_TRADER_URL",
      "WAIA_TRADER_HOST_ROUTING",
      "WAIA_COOKIE_DOMAIN",
      "NODE_ENV",
    ]) {
      prev[key] = process.env[key];
    }
    process.env.WAIA_PRIMARY_HOST = "waia.life";
    process.env.WAIA_TRADER_HOST = "trader.waia.life";
    process.env.NEXT_PUBLIC_SITE_URL = "https://waia.life";
    process.env.NEXT_PUBLIC_TRADER_URL = "https://trader.waia.life";
    delete process.env.WAIA_TRADER_HOST_ROUTING;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("normalizeHostname strips port and lowercases", () => {
    expect(normalizeHostname("Trader.WAIA.Life:443")).toBe("trader.waia.life");
  });

  it("extractHostnameFromHeaders prefers x-forwarded-host", () => {
    const headers = new Headers({
      host: "waia.life",
      "x-forwarded-host": "trader.waia.life, waia.life",
    });
    expect(extractHostnameFromHeaders(headers)).toBe("trader.waia.life");
  });

  it("resolveModuleHost maps trader host", () => {
    const result = resolveModuleHost("trader.waia.life");
    expect(result).toEqual({
      module: "trader",
      host: "trader.waia.life",
      origin: "https://trader.waia.life",
    });
  });

  it("resolveModuleHost falls back unknown host to primary", () => {
    const result = resolveModuleHost("preview.workers.dev");
    expect(result.module).toBe("primary");
    expect(result.host).toBe("preview.workers.dev");
  });

  it("isModuleHost identifies trader host", () => {
    expect(isModuleHost("trader.waia.life", "trader")).toBe(true);
    expect(isModuleHost("waia.life", "trader")).toBe(false);
  });

  it("buildModuleUrl composes cross-host paths", () => {
    expect(buildModuleUrl("primary", "/dashboard")).toBe("https://waia.life/dashboard");
    expect(buildModuleUrl("trader", "/trader")).toBe("https://trader.waia.life/trader");
  });

  it("resolveWaiaCookieDomain is unset outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.WAIA_COOKIE_DOMAIN = ".waia.life";
    expect(resolveWaiaCookieDomain()).toBeUndefined();
  });

  it("resolveWaiaCookieDomain rejects localhost domains in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.WAIA_COOKIE_DOMAIN = ".localhost";
    expect(resolveWaiaCookieDomain()).toBeUndefined();
  });

  it("resolveWaiaCookieDomain returns configured domain in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.WAIA_COOKIE_DOMAIN = ".waia.life";
    expect(resolveWaiaCookieDomain()).toBe(".waia.life");
  });
});
