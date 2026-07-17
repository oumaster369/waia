import { describe, expect, it } from "vitest";

import {
  computeKnowledgeConfidenceDecay,
  computeKnowledgeConfidenceUpdate,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import {
  EPISTEMIC_CONFIDENCE_BOUNDS,
  EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS,
  EPISTEMIC_CONFIDENCE_UPDATE_CAP,
  EPISTEMIC_SAME_RUN_DECISION_AUTHORITY_PROHIBITED,
} from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
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

describe("trader wp21 confidence update decay", () => {
  it("uses approved contract constants", () => {
    expect(EPISTEMIC_CONFIDENCE_UPDATE_CAP).toBe("0.0500");
    expect(EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS).toBe(120);
    expect(EPISTEMIC_CONFIDENCE_BOUNDS).toEqual({ min: "0.0000", max: "1.0000" });
    expect(EPISTEMIC_SAME_RUN_DECISION_AUTHORITY_PROHIBITED).toBe(true);
  });

  it("applies bounded confidence update for correct outcomes", () => {
    const update = computeKnowledgeConfidenceUpdate({
      organizationId: "org",
      runId: "run-b",
      cycleId: "1",
      symbol: "BTC/USDT",
      knowledgeEdgeId: "00000000-0000-4000-8021-000000000060",
      priorConfidence: "0.5000",
      forecastOutcome: forecastOutcome({ runId: "run-a", cycleId: "0" }),
      calibrationSnapshot: null,
      asOf: "2024-01-01T02:00:00.000Z",
      provenance: wp21Provenance(),
      sequence: 1,
    });
    expect(update.posteriorConfidence).toBe("0.5500");
    expect(update.updateKind).toBe("UPDATE");
  });

  it("prohibits same-run decision authority for confidence updates", () => {
    expect(() =>
      computeKnowledgeConfidenceUpdate({
        organizationId: "org",
        runId: "run-a",
        cycleId: "0",
        symbol: "BTC/USDT",
        knowledgeEdgeId: "00000000-0000-4000-8021-000000000060",
        priorConfidence: "0.5000",
        forecastOutcome: forecastOutcome({ runId: "run-a", cycleId: "0" }),
        calibrationSnapshot: null,
        asOf: "2024-01-01T02:00:00.000Z",
        provenance: wp21Provenance(),
        sequence: 1,
      }),
    ).toThrow(/same-run decision authority prohibited/i);
  });

  it("applies deterministic decay", () => {
    const decay = computeKnowledgeConfidenceDecay({
      organizationId: "org",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      knowledgeEdgeId: "00000000-0000-4000-8021-000000000060",
      priorConfidence: "0.8000",
      ageBars: 240,
      asOf: "2024-01-01T02:00:00.000Z",
      provenance: wp21Provenance(),
      sequence: 1,
    });
    expect(decay.updateKind).toBe("DECAY");
    expect(Number(decay.posteriorConfidence)).toBeLessThan(0.8);
  });
});
