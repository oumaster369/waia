import { describe, expect, it } from "vitest";

import { computeBrierScore } from "@/lib/trader/intelligence/calibration/brier-score";
import { computeLogLoss } from "@/lib/trader/intelligence/calibration/log-loss";
import { formatEpistemicScore } from "@/lib/trader/intelligence/calibration/brier-score";
import {
  EPISTEMIC_CONFIDENCE_BOUNDS,
  EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS,
  EPISTEMIC_CONFIDENCE_UPDATE_CAP,
  EPISTEMIC_MIN_CALIBRATION_SAMPLES,
} from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import {
  computeKnowledgeConfidenceDecay,
  computeKnowledgeConfidenceUpdate,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import { FORECAST_OUTCOME_SCHEMA_VERSION } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { ForecastOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { wp21Provenance } from "./wp21-test-helpers";

function forecastOutcome(partial: Partial<ForecastOutcomeRecord> = {}): ForecastOutcomeRecord {
  return {
    id: "00000000-0000-4000-8021-000000000050",
    organizationId: "org",
    runId: "run-a",
    cycleId: "0",
    symbol: "BTC/USDT",
    forecastRecordId: "00000000-0000-4000-8021-000000000051",
    decisionRecordId: null,
    hypothesisRecordId: null,
    modelVersion: "waia.trader.forecast_model.v1",
    strategyVersion: null,
    regime: "TREND",
    horizon: "1h",
    issuedAt: "2024-01-01T00:00:00.000Z",
    eligibleResolutionAt: "2024-01-01T01:00:00.000Z",
    resolvedAt: "2024-01-01T01:00:00.000Z",
    pitEvidenceBoundary: "2024-01-01T01:00:00.000Z",
    outcomeClass: "RESOLVED",
    outcomeVerdict: "CORRECT",
    score: "1",
    sourceRecordIdsJson: "{}",
    contentDigest: "a".repeat(64),
    idempotencyKey: "k",
    provenance: wp21Provenance(),
    terminalReason: "RESOLVED",
    schemaVersion: FORECAST_OUTCOME_SCHEMA_VERSION,
    ...partial,
  };
}

describe("trader wp21 calibration boundary proof", () => {
  it("enforces approved scoring contract constants", () => {
    expect(EPISTEMIC_MIN_CALIBRATION_SAMPLES).toBe(30);
    expect(EPISTEMIC_CONFIDENCE_UPDATE_CAP).toBe("0.0500");
    expect(EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS).toBe(120);
    expect(EPISTEMIC_CONFIDENCE_BOUNDS).toEqual({ min: "0.0000", max: "1.0000" });
  });

  it("handles probability boundaries and half-even rounding", () => {
    expect(computeBrierScore("0.0000", "1")).toBe("1.0000");
    expect(computeBrierScore("1.0000", "0")).toBe("1.0000");
    expect(formatEpistemicScore("0.1250")).toBe("0.1250");
    expect(formatEpistemicScore("0.12505")).toBe("0.1250");
    expect(Number(computeLogLoss("0.0000", "1"))).toBeGreaterThan(0);
  });

  it("bounds machine confidence delta to ±0.0500", () => {
    const update = computeKnowledgeConfidenceUpdate({
      organizationId: "org",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      knowledgeEdgeId: "00000000-0000-4000-8021-000000000060",
      priorConfidence: "0.5000",
      forecastOutcome: forecastOutcome({ outcomeVerdict: "CORRECT" }),
      calibrationSnapshot: null,
      asOf: "2024-01-01T02:00:00.000Z",
      provenance: wp21Provenance(),
      sequence: 1,
    });
    expect(Number(update.machineRecommendedDelta)).toBeLessThanOrEqual(0.05);
    expect(Number(update.machineRecommendedDelta)).toBeGreaterThanOrEqual(-0.05);
    expect(update.operatorDisposition).toBe("PENDING");
  });

  it("treats invalidated forecasts as non-scoring evidence", () => {
    const invalidated = forecastOutcome({
      outcomeClass: "INVALIDATED",
      outcomeVerdict: null,
      score: null,
      terminalReason: "INVALIDATED",
    });
    expect(invalidated.outcomeClass).toBe("INVALIDATED");
    expect(invalidated.outcomeVerdict).toBeNull();
  });

  it("derives decay as staleness evidence with half-life 120 bars", () => {
    const decay = computeKnowledgeConfidenceDecay({
      organizationId: "org",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      knowledgeEdgeId: "00000000-0000-4000-8021-000000000060",
      priorConfidence: "0.8000",
      ageBars: 120,
      asOf: "2024-01-01T02:00:00.000Z",
      provenance: wp21Provenance(),
      sequence: 1,
    });
    expect(decay.terminalReason).toBe("CONFIDENCE_DECAY");
    expect(Number(decay.machineRecommendedConfidence)).toBeLessThan(0.8);
  });
});
