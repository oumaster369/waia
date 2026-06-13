import type { Redirect } from "next/dist/lib/load-custom-routes";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

function defaultTraderHostname(): string {
  const explicit = readEnv("WAIA_TRADER_HOST");
  if (explicit) return explicit.toLowerCase();

  const traderUrl = readEnv("NEXT_PUBLIC_TRADER_URL");
  if (traderUrl) {
    try {
      return new URL(traderUrl).hostname.toLowerCase();
    } catch {
      /* ignore */
    }
  }

  return "trader.localhost";
}

function primaryOrigin(): string {
  const siteUrl = readEnv("NEXT_PUBLIC_SITE_URL");
  if (siteUrl) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      /* ignore */
    }
  }

  const host = readEnv("WAIA_PRIMARY_HOST")?.toLowerCase() ?? "localhost";
  const isLocal = host === "localhost" || host.endsWith(".localhost");
  return isLocal ? `http://${host}:3000` : `https://${host}`;
}

function isTraderHostRoutingEnabled(): boolean {
  const raw = readEnv("WAIA_TRADER_HOST_ROUTING")?.toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** Trader-host isolation redirects (topology only). */
export function buildTraderHostIsolationRedirects(): Redirect[] {
  if (!isTraderHostRoutingEnabled()) {
    return [];
  }

  const traderHost = defaultTraderHostname();
  const primaryBase = primaryOrigin();

  return [
    {
      source: "/dashboard",
      has: [{ type: "host", value: traderHost }],
      destination: `${primaryBase}/dashboard`,
      permanent: false,
      basePath: false,
    },
    {
      source: "/dashboard/:path*",
      has: [{ type: "host", value: traderHost }],
      destination: `${primaryBase}/dashboard/:path*`,
      permanent: false,
      basePath: false,
    },
    {
      source: "/api/dashboard/:path*",
      has: [{ type: "host", value: traderHost }],
      destination: `${primaryBase}/api/dashboard/:path*`,
      permanent: false,
      basePath: false,
    },
  ];
}
