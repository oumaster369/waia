import { describe, expect, it } from "vitest";

import { persistForecastBundleV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";

describe("Forecast V2 persistence symbol binding", () => {
  it("refuses an ETH issuance passed through the generic BTC persistence boundary", async () => {
    await expect(persistForecastBundleV2({} as never, {
      organizationId: "11111111-1111-4111-8111-111111111111",
      packageId: "22222222-2222-4222-8222-222222222222",
      runId: "symbol-substitution",
      cycleId: "0",
      symbol: "BTCUSDT",
      anchorClosedBarEpochMs: 1_700_000_000_000,
      issuance: {
        package: { family: { symbol: "ETHUSDT" } },
      } as never,
    })).rejects.toThrowError(
      "[forecast-v2/persistence] symbol mismatch vs predictive package family (fail closed)",
    );
  });
});
