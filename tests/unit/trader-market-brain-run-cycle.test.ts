import { describe, expect, it, vi } from "vitest";

import { loadMarketBrainConfig } from "@/lib/trader/market-brain/build-worker-deps";
import { runMarketBrainCycle } from "@/lib/trader/market-brain/run-market-brain-cycle";
import type { MarketBrainCycleDeps } from "@/lib/trader/market-brain/types";

describe("runMarketBrainCycle (deployed worker path)", () => {
  it("skips when disabled", async () => {
    const logger = { log: vi.fn() };
    const deps: MarketBrainCycleDeps = {
      config: loadMarketBrainConfig({ MARKET_BRAIN_ENABLED: "false" }),
      logger,
    };

    const report = await runMarketBrainCycle({
      deps,
      organizationId: "org-disabled",
    });

    expect(report.outcome).toBe("noop_disabled");
    expect(logger.log).toHaveBeenCalled();
  });
});

describe("loadMarketBrainConfig", () => {
  it("requires organization id when enabled", () => {
    const config = loadMarketBrainConfig({
      MARKET_BRAIN_ENABLED: "true",
      MARKET_BRAIN_ORGANIZATION_ID: "org-0",
    });
    expect(config.enabled).toBe(true);
    expect(config.organizationId).toBe("org-0");
    expect(config.symbols).toHaveLength(2);
  });
});
