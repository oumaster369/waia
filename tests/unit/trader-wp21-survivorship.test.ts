import { describe, expect, it } from "vitest";

import { buildCalibrationSnapshots } from "@/lib/trader/intelligence/calibration/calibration-scorer";
import { CALIBRATION_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/intelligence/calibration/calibration.types";
import { wp21Provenance } from "./wp21-test-helpers";

describe("trader wp21 survivorship", () => {
  it("counts expired and invalid probability rows in denominator", () => {
    const provenance = wp21Provenance();
    const base = {
      organizationId: "org",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      forecastRecordId: "f1",
      modelVersion: "waia.trader.forecast_model.v1",
      strategyVersion: null,
      regime: "TREND",
      horizon: "1h",
      issuedAt: "2024-01-01T00:00:00.000Z",
      eligibleResolutionAt: "2024-01-01T01:00:00.000Z",
      resolvedAt: "2024-01-01T01:00:00.000Z",
      pitEvidenceBoundary: "2024-01-01T01:00:00.000Z",
      idempotencyKey: "k",
      provenance,
      terminalReason: "x",
      schemaVersion: CALIBRATION_OBSERVATION_SCHEMA_VERSION,
    };

    const snapshots = buildCalibrationSnapshots({
      context: { organizationId: "org" },
      runId: "run",
      asOf: "2024-01-01T02:00:00.000Z",
      provenance,
      observations: [
        {
          ...base,
          id: "00000000-0000-4000-8021-000000000031",
          forecastOutcomeId: "o1",
          probability: "0.7000",
          outcomeEncoding: "1",
          brierScore: "0.0900",
          logLossScore: "0.3567",
          scoringEligible: true,
          nonScoringReason: null,
          contentDigest: "a".repeat(64),
        },
        {
          ...base,
          id: "00000000-0000-4000-8021-000000000032",
          forecastOutcomeId: "o2",
          probability: null,
          outcomeEncoding: null,
          brierScore: null,
          logLossScore: null,
          scoringEligible: false,
          nonScoringReason: "EXPIRED_NO_DIRECTIONAL_CONFIRMATION",
          contentDigest: "b".repeat(64),
        },
      ],
    });

    expect(snapshots[0]?.sampleCount).toBe(2);
    expect(snapshots[0]?.scoringSampleCount).toBe(1);
    expect(snapshots[0]?.calibrationStatus).toBe("INSUFFICIENT_CALIBRATION");
  });
});
