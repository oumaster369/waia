import { describe, expect, it } from "vitest";

import { deriveHypothesisOutcomeClass } from "@/lib/trader/intelligence/outcome-resolution/resolve-hypothesis-outcome";
import type { ForecastOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { FORECAST_OUTCOME_SCHEMA_VERSION } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { WP21_EPISTEMIC_AUTHORITY_DEFAULTS } from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";

function outcome(partial: Partial<ForecastOutcomeRecord>): ForecastOutcomeRecord {
  return {
    id: "00000000-0000-4000-8021-000000000020",
    organizationId: "org",
    runId: "run",
    cycleId: "0",
    symbol: "BTC/USDT",
    forecastRecordId: "00000000-0000-4000-8021-000000000021",
    decisionRecordId: null,
    hypothesisRecordId: "00000000-0000-4000-8021-000000000022",
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
    score: "1.0",
    sourceRecordIdsJson: "{}",
    contentDigest: "f".repeat(64),
    idempotencyKey: "key",
    provenance: {
      codeSha: "x",
      datasetContentDigest: "d".repeat(64),
      profileDigest: "p".repeat(64),
      canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
    },
    terminalReason: "RESOLVED",
    schemaVersion: FORECAST_OUTCOME_SCHEMA_VERSION,
    ...partial,
  };
}

describe("trader wp21 hypothesis outcome resolution", () => {
  it("records supporting observation when linked forecast outcome is CORRECT", () => {
    expect(
      deriveHypothesisOutcomeClass({
        linkedOutcomes: [outcome({ outcomeVerdict: "CORRECT" })],
      }),
    ).toBe("SUPPORTING_OBSERVATION");
  });

  it("records contradicting observation on INCORRECT but not on INVALIDATED forecast", () => {
    expect(
      deriveHypothesisOutcomeClass({
        linkedOutcomes: [outcome({ outcomeVerdict: "INCORRECT" })],
      }),
    ).toBe("CONTRADICTING_OBSERVATION");
    expect(
      deriveHypothesisOutcomeClass({
        linkedOutcomes: [outcome({ outcomeClass: "INVALIDATED", outcomeVerdict: null })],
      }),
    ).toBe("INCONCLUSIVE");
  });

  it("returns DATA_INTEGRITY_BLOCKED when linked forecast has data integrity failure", () => {
    expect(
      deriveHypothesisOutcomeClass({
        linkedOutcomes: [
          outcome({ outcomeClass: "UNRESOLVED_DUE_TO_DATA_INTEGRITY", outcomeVerdict: null }),
        ],
      }),
    ).toBe("DATA_INTEGRITY_BLOCKED");
  });

  it("returns INCONCLUSIVE without linked outcomes", () => {
    expect(deriveHypothesisOutcomeClass({ linkedOutcomes: [] })).toBe("INCONCLUSIVE");
  });

  it("does not imply validated hypothesis or strategy promotion authority", () => {
    expect(WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.validatedKnowledgeAuthority).toBe(
      "NONE",
    );
    expect(WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.strategyPromotionAuthority).toBe(
      "NONE",
    );
    expect(WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.hypothesisLifecycleAuthority).toBe(
      "NONE",
    );
  });
});
