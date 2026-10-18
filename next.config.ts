import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

import { buildTraderHostIsolationRedirects } from "./lib/hosts/cross-host-redirects";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  /** Dev-only: Playwright FHV CSRF suite uses `http://127.0.0.1:<port>` with `pnpm dev`. */
  allowedDevOrigins: ["127.0.0.1"],

  async redirects() {
    return buildTraderHostIsolationRedirects();
  },

  async headers() {
    return [
      {
        source: "/api/dashboard/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/auth/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default function nextConfigForPhase(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    initOpenNextCloudflareForDev();
  }

  return nextConfig;
}
