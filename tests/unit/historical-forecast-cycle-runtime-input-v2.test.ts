import { describe, expect, it } from "vitest";

import { buildHistoricalForecastCycleRuntimeInputV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-cycle-runtime-input-v2";

function invoke(evaluation: unknown) {
  return () => buildHistoricalForecastCycleRuntimeInputV2({
    releaseSha: "1".repeat(40), organizationId: "org", accountId: null,
    symbol: "BTCUSDT", venue: "HTX", analyticalTimeframe: "1m", horizon: "33m",
    pitAnchor: "2026-01-01T00:01:00.000Z", runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    sourceProfileDigestHex: "2".repeat(64), representationProfileDigestHex: "3".repeat(64),
    runtimeContext: {}, activeKnowledgeState: {}, selectedKnowledgeClaimDigestsHex: [],
    selectedFailureBoundaryDigestsHex: [], knowledgeEdgeId: "00000000-0000-4000-8000-000000000001",
    knowledgeContentDigestHex: "4".repeat(64), evaluation: evaluation as never,
    requiredInformationProfile: {} as never, informationSufficiencyReceipt: {} as never,
    forecastContractBinding: {} as never, scientificAdmissionReceipt: {} as never,
    scientificAdmissionExpectedBindings: {} as never, predictivePackage: {} as never,
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
});
