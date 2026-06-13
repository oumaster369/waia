import type { NextConfig } from "next";

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

import { buildTraderHostIsolationRedirects } from "./lib/hosts/cross-host-redirects";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],

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

export default nextConfig;

initOpenNextCloudflareForDev();
