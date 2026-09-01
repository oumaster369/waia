import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ issue: vi.fn(), requireOutcome: vi.fn(), persist: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issue,
  requireForecastRuntimeAuthorizedOutcomeV2: mocked.requireOutcome,
}));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service", () => ({
  persistForecastBundleV2: mocked.persist,
}));

import { persistHistoricalForecastCycleV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-cycle-persistence-v2";

describe("historical Forecast cycle persistence v2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists exact replayed authority and source input atomically", async () => {
    const runtimeInput = { source: "exact" };
    const outcome = {
      status: "FORECAST_AUTHORIZED",
      authority: { organizationId: "org", anchorClosedBarEpochMs: 123 },
      issuance: { id: "issuance" },
    };
    mocked.issue.mockReturnValue(outcome);
    mocked.requireOutcome.mockReturnValue(outcome);
    mocked.persist.mockResolvedValue({ bundleId: "b", terminalForecastId: "t",
      executionForecastId: "e", retriedExisting: false });
    await expect(persistHistoricalForecastCycleV2({} as never, {
      organizationId: "org", packageId: "p", runId: "r", cycleId: "c",
      symbol: "BTCUSDT", runtimeInput: runtimeInput as never, issuanceSequence: 7,
    })).resolves.toMatchObject({ bundleId: "b" });
    expect(mocked.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authorizedOutcome: outcome, runtimeInput, anchorClosedBarEpochMs: 123,
      issuanceSequence: 7,
    }));
  });

  it("refuses invalid sequence before issuing Forecast", async () => {
    await expect(persistHistoricalForecastCycleV2({} as never, {
      organizationId: "org", packageId: "p", runId: "r", cycleId: "c",
      symbol: "BTCUSDT", runtimeInput: {} as never, issuanceSequence: -1,
    })).rejects.toThrowError("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:SEQUENCE");
    expect(mocked.issue).not.toHaveBeenCalled();
  });
});
