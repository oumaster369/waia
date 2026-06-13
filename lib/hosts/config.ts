import type { ModuleKey } from "@/lib/hosts/types";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function originFromUrl(url: string): string | null {
  try {
    return trimTrailingSlash(new URL(url).origin);
  } catch {
    return null;
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

export function defaultPrimaryHostname(): string {
  const explicit = readEnv("WAIA_PRIMARY_HOST");
  if (explicit) return explicit.toLowerCase();

  const siteUrl = readEnv("NEXT_PUBLIC_SITE_URL");
  if (siteUrl) {
    const fromUrl = hostnameFromUrl(siteUrl);
    if (fromUrl) return fromUrl;
  }

  return "localhost";
}

export function defaultTraderHostname(): string {
  const explicit = readEnv("WAIA_TRADER_HOST");
  if (explicit) return explicit.toLowerCase();

  const traderUrl = readEnv("NEXT_PUBLIC_TRADER_URL");
  if (traderUrl) {
    const fromUrl = hostnameFromUrl(traderUrl);
    if (fromUrl) return fromUrl;
  }

  return "trader.localhost";
}

export function moduleOrigin(module: ModuleKey): string {
  if (module === "trader") {
    const traderUrl = readEnv("NEXT_PUBLIC_TRADER_URL");
    if (traderUrl) {
      const fromUrl = originFromUrl(traderUrl);
      if (fromUrl) return fromUrl;
    }
    const host = defaultTraderHostname();
    const isLocal = host === "localhost" || host.endsWith(".localhost");
    return isLocal ? `http://${host}:3000` : `https://${host}`;
  }

  const siteUrl = readEnv("NEXT_PUBLIC_SITE_URL");
  if (siteUrl) {
    const fromUrl = originFromUrl(siteUrl);
    if (fromUrl) return fromUrl;
  }

  const host = defaultPrimaryHostname();
  const isLocal = host === "localhost" || host.endsWith(".localhost");
  return isLocal ? `http://${host}:3000` : `https://${host}`;
}

/** Env-driven host → module map. Unknown hosts are not listed here. */
export function buildHostModuleMap(): Map<string, ModuleKey> {
  const map = new Map<string, ModuleKey>();
  map.set(defaultPrimaryHostname(), "primary");
  map.set(defaultTraderHostname(), "trader");
  return map;
}

export function isTraderHostRoutingEnabled(): boolean {
  const raw = readEnv("WAIA_TRADER_HOST_ROUTING")?.toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}
