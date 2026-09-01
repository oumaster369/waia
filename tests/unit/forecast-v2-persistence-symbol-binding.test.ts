import { describe, expect, it } from "vitest";

import { persistForecastBundleV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";

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

  it("refuses a historical package relabeled as general before any database access", async () => {
    const sql = new Proxy(() => undefined, {
      apply: () => {
        throw new Error("database must not be reached");
      },
    });
    await expect(persistForecastBundleV2(sql as never, {
      organizationId: "11111111-1111-4111-8111-111111111111",
      packageId: "22222222-2222-4222-8222-222222222222",
      runId: "authority-substitution",
      cycleId: "0",
      symbol: "BTCUSDT",
      anchorClosedBarEpochMs: 1_700_000_000_000,
      issuance: {
        package: { family: {
          symbol: "BTCUSDT",
          packageSubjectVersion: HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2,
        } },
      } as never,
      authorizedOutcome: {} as never,
      runtimeInput: {
        predictivePackage: { family: {
          packageSubjectVersion: HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2,
        } },
      } as never,
      runtimeAuthorityClass: "GENERAL_FORECAST_V2",
    })).rejects.toThrowError(
      "[forecast-v2/persistence] runtime authority class contradicts package provenance (fail closed)",
    );
  });

  it("refuses a historical package with its runtime authority source omitted", async () => {
    await expect(persistForecastBundleV2({} as never, {
      organizationId: "11111111-1111-4111-8111-111111111111",
      packageId: "22222222-2222-4222-8222-222222222222",
      runId: "authority-omission",
      cycleId: "0",
      symbol: "BTCUSDT",
      anchorClosedBarEpochMs: 1_700_000_000_000,
      issuance: {
        package: { family: {
          symbol: "BTCUSDT",
          packageSubjectVersion: HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2,
        } },
      } as never,
    })).rejects.toThrowError(
      "[forecast-v2/persistence] historical package requires exact runtime authority source (fail closed)",
    );
  });
});
