import { describe, expect, it } from "vitest";

import {
  appendHistoricalSimulationReasonLedgerV2,
  assertHistoricalSimulationReasonLedgerChainV2,
  createHistoricalSimulationReasonLedgerV2,
  validateHistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationReasonLedgerV2Draft,
} from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const digest = (character: string) => character.repeat(64);
const membership = () => {
  const body = { schemaVersion: "waia.trader.historical_dataset_membership.v2" as const, organizationId: "22222222-2222-4222-8222-222222222222", cycleId: "cycle-0", manifestSemanticDigestHex: digest("1"), sealReceiptDigestHex: digest("2"), partitionDigestHex: digest("3"), partitionRawSha256Hex: digest("4"), partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const, recordIndex: 0, barContentDigestHex: digest("5"), sealedCycleContentDigestHex: digest("6") };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
};

function completeDraft(
  patch: Partial<HistoricalSimulationReasonLedgerV2Draft> = {},
): HistoricalSimulationReasonLedgerV2Draft {
  return {
    entryId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    accountId: "33333333-3333-4333-8333-333333333333",
    runId: "preholdout-run",
    cycleId: "cycle-0",
    cycleSequence: 0,
    symbol: "BTCUSDT",
    partition: "DEVELOPMENT",
    replayBarClosedAtUtc: "2026-08-01T00:00:00.000Z",
    datasetMembership: membership(),
    previousContentDigestHex: null,
    forecast: { status: "AUTHORIZED", authorityContentDigestHex: digest("a"), reasonCodes: [] },
    decision: {
      status: "ENTER_LONG", decisionContentDigestHex: digest("b"),
      whyNotCashReceiptDigestHex: digest("c"), evLower: "1", evBase: "2", evUpper: "3",
      reasonCodes: [],
    },
    portfolio: { status: "PROPOSED", proposalContentDigestHex: digest("d"), reasonCodes: [] },
    risk: {
      status: "APPROVE", verdictContentDigestHex: digest("e"),
      allowanceContentDigestHex: digest("f"), reasonCodes: [],
    },
    execution: {
      status: "COMMITTED", planContentDigestHex: digest("1"), attemptContentDigestHex: digest("2"),
      reportContentDigestHex: null, fillContentDigestHexes: [], reasonCodes: [],
    },
    observedExecutionEffects: [],
    accounting: { status: "APPLIED", frontierContentDigestHex: digest("5"), reasonCodes: [] },
    guardian: { status: "NONE", assessmentContentDigestHex: digest("6"), reasonCodes: [] },
    learning: {
      status: "APPLIED", calibrationObservationContentDigestHex: digest("7"),
      knowledgeUpdateContentDigestHex: digest("8"),
      eligibleResolutionAtUtc: "2026-08-01T00:30:00.000Z",
      visibleFromPitAnchorUtc: "2026-08-01T00:31:00.000Z", reasonCodes: [],
    },
    ...patch,
  };
}

describe("Historical Simulation V2 reason ledger", () => {
  it("creates an immutable complete non-capital pre-holdout entry", () => {
    const entry = createHistoricalSimulationReasonLedgerV2(completeDraft());
    expect(entry.capitalEligible).toBe(false);
    expect(entry.partition).toBe("DEVELOPMENT");
    expect(validateHistoricalSimulationReasonLedgerV2(entry)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.forecast)).toBe(true);
  });

  it("chains entries by exact prior digest and rejects a broken chain", () => {
    const { cycleSequence: _sequence, previousContentDigestHex: _previous, ...genesisDraft } = completeDraft();
    void _sequence;
    void _previous;
    const first = appendHistoricalSimulationReasonLedgerV2(null, genesisDraft);
    const second = appendHistoricalSimulationReasonLedgerV2(first, {
      ...genesisDraft,
      entryId: "33333333-3333-4333-8333-333333333333",
      cycleId: "cycle-1",
      datasetMembership: (() => { const value = membership(); const body = { ...value, cycleId: "cycle-1", partition: "WALK_FORWARD" as const }; const { contentDigestHex: _old, ...unsigned } = body; void _old; return { ...unsigned, contentDigestHex: computeSemanticSha256Hex(unsigned) }; })(),
      replayBarClosedAtUtc: "2026-08-01T00:01:00.000Z",
      partition: "WALK_FORWARD",
    });
    expect(second.cycleSequence).toBe(1);
    expect(second.previousContentDigestHex).toBe(first.contentDigestHex);
    expect(() => assertHistoricalSimulationReasonLedgerChainV2([first, second])).not.toThrow();
    expect(() => assertHistoricalSimulationReasonLedgerChainV2([
      first,
      { ...second, previousContentDigestHex: digest("9") },
    ])).toThrow(/invalid ledger entry|broken digest chain/);
  });

  it("requires reasons for every blocked or non-effect stage", () => {
    expect(() => createHistoricalSimulationReasonLedgerV2(completeDraft({
      forecast: { status: "NON_ACTIONABLE", authorityContentDigestHex: null, reasonCodes: [] },
    }))).toThrow(/forecast.NON_ACTIONABLE requires reasonCodes/);
    expect(() => createHistoricalSimulationReasonLedgerV2(completeDraft({
      risk: { status: "VETO", verdictContentDigestHex: digest("e"), allowanceContentDigestHex: null, reasonCodes: [] },
    }))).toThrow(/risk.VETO requires reasonCodes/);
    expect(() => createHistoricalSimulationReasonLedgerV2(completeDraft({
      execution: {
        status: "NOT_DISPATCHED", planContentDigestHex: null, attemptContentDigestHex: null,
        reportContentDigestHex: null, fillContentDigestHexes: [], reasonCodes: [],
      },
    }))).toThrow(/execution.NOT_DISPATCHED requires reasonCodes/);
  });

  it("rejects holdout, capital eligibility substitution and same-cycle learning visibility", () => {
    expect(() => createHistoricalSimulationReasonLedgerV2({
      ...completeDraft(), partition: "BLIND_HOLDOUT" as "DEVELOPMENT",
    })).toThrow(/only DEVELOPMENT\/WALK_FORWARD/);
    const valid = createHistoricalSimulationReasonLedgerV2(completeDraft());
    expect(validateHistoricalSimulationReasonLedgerV2({ ...valid, capitalEligible: true as false })).toBe(false);
    expect(() => createHistoricalSimulationReasonLedgerV2(completeDraft({
      learning: {
        ...completeDraft().learning,
        visibleFromPitAnchorUtc: "2026-08-01T00:00:00.000Z",
      },
    }))).toThrow(/strictly future PIT anchor/);
  });

  it("detects semantic tampering", () => {
    const entry = createHistoricalSimulationReasonLedgerV2(completeDraft());
    expect(validateHistoricalSimulationReasonLedgerV2({
      ...entry,
      decision: { ...entry.decision, evLower: "999" },
    })).toBe(false);
  });

  it("separates prior-decision realized fills from current-decision submission", () => {
    const effect = {
      effectId: "effect-1", originatingDecisionId: "decision-previous",
      originatingDecisionContentDigestHex: digest("a"), originatingPlanId: "plan-previous",
      originatingPlanContentDigestHex: digest("b"), originatingAttemptId: "attempt-previous",
      originatingAttemptContentDigestHex: digest("c"), originatingOrderId: "order-previous",
      originatingOrderContentDigestHex: digest("d"), status: "FILLED" as const,
      reportContentDigestHexes: [digest("e")], fillContentDigestHexes: [digest("f")], reasonCodes: [],
    };
    expect(validateHistoricalSimulationReasonLedgerV2(createHistoricalSimulationReasonLedgerV2(completeDraft({
      observedExecutionEffects: [effect],
    })))).toBe(true);
    expect(() => createHistoricalSimulationReasonLedgerV2(completeDraft({
      execution: { ...completeDraft().execution, status: "FILLED" as "COMMITTED", reportContentDigestHex: digest("e"), fillContentDigestHexes: [digest("f")] },
    }))).toThrow(/submission-only/);
  });
});
