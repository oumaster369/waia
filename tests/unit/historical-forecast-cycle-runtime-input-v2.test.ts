import { describe, expect, it } from "vitest";

import { buildHistoricalForecastCycleRuntimeInputV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-cycle-runtime-input-v2";
import { buildHistoricalForecastKnowledgeBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";
import { buildHistoricalKnowledgeSnapshotAuthorityV2 } from
  "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";
import { computeHistoricalSimulationEmptyKnowledgeBindingDigestV2 } from
  "@/lib/trader/historical-simulation-v2/knowledge-snapshot-binding-v2";

const organizationId = "00000000-0000-4000-8000-000000000001";

function invoke(evaluation: unknown, predictivePackage: unknown = {}) {
  return () => buildHistoricalForecastCycleRuntimeInputV2({
    releaseSha: "1".repeat(40), organizationId, runId: "test-run", accountId: null,
    symbol: "BTCUSDT", venue: "HTX", analyticalTimeframe: "1m", horizon: "33m",
    pitAnchor: "2026-01-01T00:01:00.000Z", runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    sourceProfileDigestHex: "2".repeat(64), representationProfileDigestHex: "3".repeat(64),
    runtimeContext: {}, knowledgeBootstrap: {} as never,
    knowledgeSnapshotAuthority: {} as never,
    evaluation: evaluation as never,
    requiredInformationProfile: {} as never, informationSufficiencyReceipt: {} as never,
    forecastContractBinding: {} as never, scientificAdmissionReceipt: {} as never,
    scientificAdmissionExpectedBindings: {} as never,
    predictivePackage: predictivePackage as never,
    packageQuarantinedOrStale: false, integrityAndPitValid: true,
  });
}

describe("historical Forecast cycle runtime input v2", () => {
  it("refuses a cycle before the complete analytical graph exists", () => {
    expect(invoke({ features: { evaluatedAt: "2026-01-01T00:01:00.000Z" } }))
      .toThrowError("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:INCOMPLETE_EVALUATION");
  });

  it("refuses an unavailable realized-volatility predictor", () => {
    expect(invoke({
      reconstruction: {}, hypothesisSet: {}, marketStateSnapshot: {}, decisionChain: {},
      features: {
        evaluatedAt: "2026-01-01T00:01:00.000Z",
        features: { realizedVol20m_1m: "UNAVAILABLE" },
      },
    })).toThrowError("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:REALIZED_VOL");
  });

  it("refuses an ETH evaluation substituted into a requested BTC cycle before admission", () => {
    expect(invoke({
      reconstruction: {}, hypothesisSet: {}, marketStateSnapshot: {}, decisionChain: {},
      features: {
        instrumentId: "ETH/USDT",
        evaluatedAt: "2026-01-01T00:01:00.000Z",
        features: { realizedVol20m_1m: 0.01 },
      },
    }, {
      family: { symbol: "BTCUSDT" },
    })).toThrowError("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:SYMBOL_SCOPE");
  });

  it("refuses an ETH predictive package substituted into a requested BTC cycle", () => {
    expect(invoke({
      reconstruction: {}, hypothesisSet: {}, marketStateSnapshot: {}, decisionChain: {},
      features: {
        instrumentId: "BTC/USDT",
        evaluatedAt: "2026-01-01T00:01:00.000Z",
        features: { realizedVol20m_1m: 0.01 },
      },
    }, {
      family: { symbol: "ETHUSDT" },
    })).toThrowError("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:SYMBOL_SCOPE");
  });

  it("refuses a knowledge bootstrap from a different package lineage", () => {
    const packageDigest = "a".repeat(64);
    const wrongKnowledge = buildHistoricalForecastKnowledgeBootstrapV2({
      organizationId, symbol: "BTCUSDT", horizonMinutes: 33,
      predictivePackageContentDigestHex: "b".repeat(64),
    });
    expect(() => buildHistoricalForecastCycleRuntimeInputV2({
      releaseSha: "1".repeat(40), organizationId, runId: "test-run", accountId: null,
      symbol: "BTCUSDT", venue: "HTX", analyticalTimeframe: "1m", horizon: "33m",
      pitAnchor: "2026-01-01T00:01:00.000Z", runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
      sourceProfileDigestHex: "2".repeat(64), representationProfileDigestHex: "3".repeat(64),
      runtimeContext: {}, knowledgeBootstrap: wrongKnowledge,
      knowledgeSnapshotAuthority: buildHistoricalKnowledgeSnapshotAuthorityV2({
        organizationId,
        runId: "test-run",
        symbol: "BTCUSDT",
        pitAnchor: "2026-01-01T00:01:00.000Z",
        visibleEvidenceCount: 0,
        knowledgeContentDigestHex:
          computeHistoricalSimulationEmptyKnowledgeBindingDigestV2(
            organizationId,
            "BTCUSDT",
          ),
      }),
      evaluation: {
        reconstruction: {}, hypothesisSet: {}, marketStateSnapshot: {}, decisionChain: {},
        features: { instrumentId: "BTC/USDT", evaluatedAt: "2026-01-01T00:01:00.000Z",
          features: { realizedVol20m_1m: 0.01 } },
      } as never,
      requiredInformationProfile: {} as never, informationSufficiencyReceipt: {} as never,
      forecastContractBinding: {} as never, scientificAdmissionReceipt: {} as never,
      scientificAdmissionExpectedBindings: {} as never,
      predictivePackage: { family: { symbol: "BTCUSDT", executionHorizonMinutes: 33 },
        predictivePackageContentDigest: Buffer.from(packageDigest, "hex") } as never,
      packageQuarantinedOrStale: false, integrityAndPitValid: true,
    })).toThrowError("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_LINEAGE");
  });
});
