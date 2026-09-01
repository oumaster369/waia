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
import { buildHistoricalForecastKnowledgeBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";

const organizationId = "00000000-0000-4000-8000-000000000001";
const packageDigest = "a".repeat(64);

describe("historical Forecast cycle persistence v2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists exact replayed authority and source input atomically", async () => {
    const knowledgeBootstrap = buildHistoricalForecastKnowledgeBootstrapV2({
      organizationId, symbol: "BTCUSDT", horizonMinutes: 33,
      predictivePackageContentDigestHex: packageDigest,
    });
    const runtimeInput = {
      source: "exact", executionHorizonMinutes: 33,
      knowledgeEdgeId: knowledgeBootstrap.knowledgeEdgeId,
      knowledgeContentDigestHex: knowledgeBootstrap.contentDigestHex,
    };
    const outcome = {
      status: "FORECAST_AUTHORIZED",
      authority: { organizationId, anchorClosedBarEpochMs: 123,
        selectedPredictivePackageContentDigestHex: packageDigest },
      issuance: { id: "issuance", package: { family: { symbol: "BTCUSDT" } } },
    };
    mocked.issue.mockReturnValue(outcome);
    mocked.requireOutcome.mockReturnValue(outcome);
    mocked.persist.mockResolvedValue({ bundleId: "b", terminalForecastId: "t",
      executionForecastId: "e", retriedExisting: false });
    await expect(persistHistoricalForecastCycleV2({} as never, {
      organizationId, packageId: "p", runId: "r", cycleId: "c",
      symbol: "BTCUSDT", runtimeInput: runtimeInput as never, issuanceSequence: 7,
    })).resolves.toMatchObject({ bundleId: "b" });
    expect(mocked.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      authorizedOutcome: outcome, runtimeInput, anchorClosedBarEpochMs: 123,
      issuanceSequence: 7, historicalKnowledgeBootstrap: knowledgeBootstrap,
    }));
  });

  it("refuses arbitrary knowledge lineage before writing", async () => {
    const outcome = {
      status: "FORECAST_AUTHORIZED",
      authority: { organizationId, anchorClosedBarEpochMs: 123,
        selectedPredictivePackageContentDigestHex: packageDigest },
      issuance: { package: { family: { symbol: "BTCUSDT" } } },
    };
    mocked.issue.mockReturnValue(outcome);
    mocked.requireOutcome.mockReturnValue(outcome);
    await expect(persistHistoricalForecastCycleV2({} as never, {
      organizationId, packageId: "p", runId: "r", cycleId: "c",
      symbol: "BTCUSDT", runtimeInput: {
        executionHorizonMinutes: 33,
        knowledgeEdgeId: "00000000-0000-4000-8000-000000000099",
        knowledgeContentDigestHex: "b".repeat(64),
      } as never, issuanceSequence: 7,
    })).rejects.toThrowError("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:KNOWLEDGE_LINEAGE");
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it("refuses invalid sequence before issuing Forecast", async () => {
    await expect(persistHistoricalForecastCycleV2({} as never, {
      organizationId: "org", packageId: "p", runId: "r", cycleId: "c",
      symbol: "BTCUSDT", runtimeInput: {} as never, issuanceSequence: -1,
    })).rejects.toThrowError("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:SEQUENCE");
    expect(mocked.issue).not.toHaveBeenCalled();
  });

  it("refuses an ETH issuance substituted into BTC persistence before writing", async () => {
    const outcome = {
      status: "FORECAST_AUTHORIZED",
      authority: { organizationId: "org", anchorClosedBarEpochMs: 123 },
      issuance: { package: { family: { symbol: "ETHUSDT" } } },
    };
    mocked.issue.mockReturnValue(outcome);
    mocked.requireOutcome.mockReturnValue(outcome);

    await expect(persistHistoricalForecastCycleV2({} as never, {
      organizationId: "org", packageId: "p", runId: "r", cycleId: "c",
      symbol: "BTCUSDT", runtimeInput: {} as never, issuanceSequence: 0,
    })).rejects.toThrowError("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:SYMBOL");
    expect(mocked.persist).not.toHaveBeenCalled();
  });
});
