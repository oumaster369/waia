import { PHASE_DEVELOPMENT_SERVER, PHASE_EXPORT, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_TEST } from "next/constants";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { initOpenNextCloudflareForDev, buildTraderHostIsolationRedirects } = vi.hoisted(() => ({
  initOpenNextCloudflareForDev: vi.fn(),
  buildTraderHostIsolationRedirects: vi.fn(() => [{ source: "/legacy", destination: "/current", permanent: true }]),
}));

vi.mock("@opennextjs/cloudflare", () => ({ initOpenNextCloudflareForDev }));
vi.mock("@/lib/hosts/cross-host-redirects", () => ({ buildTraderHostIsolationRedirects }));

let nextConfigForPhase: typeof import("../../next.config").default;

describe("next config phases", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    nextConfigForPhase = (await import("../../next.config")).default;
  });

  it("initializes the OpenNext dev proxy only for the development server", () => {
    expect(initOpenNextCloudflareForDev).not.toHaveBeenCalled();
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_EXPORT, PHASE_TEST]) {
      nextConfigForPhase(phase);
    }

    expect(initOpenNextCloudflareForDev).not.toHaveBeenCalled();

    nextConfigForPhase(PHASE_DEVELOPMENT_SERVER);

    expect(initOpenNextCloudflareForDev).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing Next config options, redirects, and headers", async () => {
    const config = nextConfigForPhase(PHASE_PRODUCTION_BUILD);

    expect(config).toMatchObject({
      reactStrictMode: true,
      poweredByHeader: false,
      serverExternalPackages: ["better-sqlite3"],
      allowedDevOrigins: ["127.0.0.1"],
    });
    expect(await config.redirects?.()).toEqual([
      { source: "/legacy", destination: "/current", permanent: true },
    ]);
    expect(buildTraderHostIsolationRedirects).toHaveBeenCalledTimes(1);
    expect(await config.headers?.()).toEqual([
      {
        source: "/api/dashboard/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/auth/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ]);
    expect(initOpenNextCloudflareForDev).not.toHaveBeenCalled();
  });
});
