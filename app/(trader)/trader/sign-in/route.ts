import { NextResponse } from "next/server";

import { buildModuleUrl } from "@/lib/hosts/resolve";

export const dynamic = "force-dynamic";

function readRuntimeEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

function configuredTraderOrigin(): string | null {
  const traderUrl = readRuntimeEnv("NEXT_PUBLIC_TRADER_URL");
  const traderHost = readRuntimeEnv("WAIA_TRADER_HOST");
  if (!traderUrl && !traderHost) return null;

  try {
    if (traderUrl) {
      const parsed = new URL(traderUrl);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "invalid";
    } else {
      if (!traderHost || /[/?#@\s]/.test(traderHost)) return "invalid";
      const parsed = new URL(`https://${traderHost}`);
      if (parsed.hostname.toLowerCase() !== traderHost.split(":")[0]?.toLowerCase()) return "invalid";
    }

    const destination = new URL(buildModuleUrl("trader", "/"));
    if (!/^https?:$/.test(destination.protocol) || destination.username || destination.password) return "invalid";
    return destination.origin;
  } catch {
    return "invalid";
  }
}

export function GET(request: Request) {
  const configuredOrigin = configuredTraderOrigin();
  if (configuredOrigin === "invalid") {
    return new Response("Trader sign-in destination is unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let destination: URL;
  try {
    destination = configuredOrigin
      ? new URL("/", configuredOrigin)
      : new URL("/", request.url);
  } catch {
    return new Response("Trader sign-in destination is unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.redirect(destination, { status: 307, headers: { "Cache-Control": "no-store" } });
}
