import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_CONFIDENCE_VALUE_CLASS,
  WP21_EPISTEMIC_AUTHORITY_DEFAULTS,
} from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";
import { EPISTEMIC_PROBABILITY_SOURCE } from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import {
  computeKnowledgeConfidenceUpdate,
  computeKnowledgeConfidenceDecay,
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

describe("trader wp21 canonical epistemic authority", () => {
  it("separates forecast probability source from machine knowledge confidence recommendation", () => {
    expect(EPISTEMIC_PROBABILITY_SOURCE).toBe("forecast_confidence_json.confidence_value");
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
    expect(update.confidenceValueClass).toBe(
      KNOWLEDGE_CONFIDENCE_VALUE_CLASS.machineRecommendedBoundedDelta,
    );
    expect(update.authorityClass).toBe(
      WP21_EPISTEMIC_AUTHORITY_DEFAULTS.knowledgeUpdate.authorityClass,
    );
    expect(update.operatorDisposition).toBe("PENDING");
    expect(update.capitalAuthority).toBe("NONE");
    expect(update.strategyAuthority).toBe("NONE");
  });

  it("classifies decay as derived staleness evidence not operator judgment rewrite", () => {
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
    expect(decay.confidenceValueClass).toBe(
      KNOWLEDGE_CONFIDENCE_VALUE_CLASS.derivedStalenessEvidence,
    );
    expect(decay.terminalReason).toBe("CONFIDENCE_DECAY");
  });
});
