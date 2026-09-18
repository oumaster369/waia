import { describe, expect, it } from "vitest";

import { computeKnowledgeEdgeVersionContentDigestHex } from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import {
  applyQualifiedVerdictToNavigatorCandidateV2,
  qualifyFutureCycleEpistemicEffectV2,
  type KnowledgeNavigatorCandidateV2,
} from "@/lib/trader/knowledge/navigator";

const PLAN = "a".repeat(64);
const DIGEST_A = "b".repeat(64);
const DIGEST_B = "c".repeat(64);
const RECEIPT = "d".repeat(64);
const PRIOR_PIT = "2026-01-15T12:00:00.000Z";
const FUTURE_PIT = "2026-01-16T12:00:00.000Z";

function candidate(
  overrides: Partial<KnowledgeNavigatorCandidateV2> &
    Pick<KnowledgeNavigatorCandidateV2, "knowledgeEdgeId">,
): KnowledgeNavigatorCandidateV2 {
  return {
    version: 1,
    contentDigestHex: DIGEST_A,
    organizationId: "org-1",
    symbol: "BTCUSDT",
    questionId: "WHAT_HAPPENING",
    pitEventAt: "2026-01-15T11:00:00.000Z",
    lifecycleState: "ACTIVE",
    verified: true,
    fromRef: "btc-regime",
    toRef: "btc-move",
    relationKind: "EXPLAINS",
    ...overrides,
  };
}

const baseSelect = {
  organizationId: "org-1",
  runId: "run-1",
  symbol: "BTCUSDT",
  purpose: "NEW_OPPORTUNITY_SEARCH",
  questionId: "WHAT_HAPPENING",
  informationNeedPlanDigestHex: PLAN,
  evidenceBudget: 2,
  maxStalenessMs: 48 * 60 * 60 * 1000,
};

describe("DEE-773 future-cycle epistemic effect", () => {
  it("changes later Navigator selection after a sealed qualified support update and is deterministic", () => {
    const priorCandidate = candidate({ knowledgeEdgeId: "edge-1" });
    const supported = applyQualifiedVerdictToNavigatorCandidateV2(priorCandidate, {
      version: 2,
      contentDigestHex: computeKnowledgeEdgeVersionContentDigestHex({
        fromRef: priorCandidate.fromRef,
        toRef: priorCandidate.toRef,
        relationKind: priorCandidate.relationKind,
        confidence: "0.7500",
        strength: "1",
        regimeScope: "ALL",
        failureCasesJson: "[]",
        hypothesisId: null,
        verified: true,
        lifecycleState: "ACTIVE",
      }),
      lifecycleState: "ACTIVE",
      verified: true,
      relationKind: "EXPLAINS",
    });
    const first = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "SUPPORT",
      producedByReceiptDigestHex: RECEIPT,
      prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
      future: {
        ...baseSelect,
        runId: "run-2",
        pitAnchor: FUTURE_PIT,
        candidates: [supported],
      },
    });
    const second = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "SUPPORT",
      producedByReceiptDigestHex: RECEIPT,
      prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
      future: {
        ...baseSelect,
        runId: "run-2",
        pitAnchor: FUTURE_PIT,
        candidates: [supported],
      },
    });
    expect(first.effectKind).toBe("SUPPORT");
    expect(first.capitalAuthority).toBe("NONE");
    expect(first.futureNavigatorReceiptContentDigestHex).not.toBe(
      first.priorNavigatorReceiptContentDigestHex,
    );
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
  });

  it("returns ZERO_EFFECT for unsealed, PnL-only, same-cycle and lookahead evidence", () => {
    const priorCandidate = candidate({ knowledgeEdgeId: "edge-1" });
    const retired = applyQualifiedVerdictToNavigatorCandidateV2(priorCandidate, {
      version: 2,
      contentDigestHex: DIGEST_B,
      lifecycleState: "RETIRED",
      verified: false,
      relationKind: "EXPLAINS",
    });
    for (const evidenceClass of [
      "UNSEALED_OUTCOME",
      "PNL_ONLY",
      "SAME_CYCLE",
      "LOOKAHEAD",
    ] as const) {
      const receipt = qualifyFutureCycleEpistemicEffectV2({
        evidenceClass,
        effectKind: "INVALIDATION",
        producedByReceiptDigestHex: RECEIPT,
        prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
        future: {
          ...baseSelect,
          runId: "run-2",
          pitAnchor: FUTURE_PIT,
          candidates: [retired],
        },
      });
      expect(receipt.effectKind).toBe("ZERO_EFFECT");
      expect(receipt.futureNavigatorReceiptContentDigestHex).toBe(
        receipt.priorNavigatorReceiptContentDigestHex,
      );
    }
  });

  it("lets sealed decay and invalidation change later Navigator selection", () => {
    const priorCandidate = candidate({ knowledgeEdgeId: "edge-1" });
    const decayed = applyQualifiedVerdictToNavigatorCandidateV2(priorCandidate, {
      version: 2,
      contentDigestHex: DIGEST_B,
      lifecycleState: "ACTIVE",
      verified: false,
      relationKind: "EXPLAINS",
    });
    const decayReceipt = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "DECAY",
      producedByReceiptDigestHex: RECEIPT,
      prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
      future: {
        ...baseSelect,
        runId: "run-2",
        pitAnchor: FUTURE_PIT,
        candidates: [decayed],
      },
    });
    expect(decayReceipt.effectKind).toBe("DECAY");
    expect(decayReceipt.futureKnowledgeDigestHex).not.toBe(decayReceipt.priorKnowledgeDigestHex);

    const retired = applyQualifiedVerdictToNavigatorCandidateV2(priorCandidate, {
      version: 2,
      contentDigestHex: DIGEST_B,
      lifecycleState: "RETIRED",
      verified: false,
      relationKind: "EXPLAINS",
    });
    const invalidation = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "INVALIDATION",
      producedByReceiptDigestHex: RECEIPT,
      prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
      future: {
        ...baseSelect,
        runId: "run-2",
        pitAnchor: FUTURE_PIT,
        candidates: [retired],
      },
    });
    expect(invalidation.effectKind).toBe("INVALIDATION");
    expect(invalidation.futureNavigatorReceiptContentDigestHex).not.toBe(
      invalidation.priorNavigatorReceiptContentDigestHex,
    );
  });

  it("keeps another tenant's later cycle unchanged when foreign sealed evidence is presented", () => {
    const priorCandidate = candidate({ knowledgeEdgeId: "edge-1" });
    const foreign = applyQualifiedVerdictToNavigatorCandidateV2(
      candidate({ knowledgeEdgeId: "edge-1", organizationId: "org-2" }),
      {
        version: 2,
        contentDigestHex: DIGEST_B,
        lifecycleState: "RETIRED",
        verified: false,
        relationKind: "EXPLAINS",
      },
    );
    const receipt = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "INVALIDATION",
      producedByReceiptDigestHex: RECEIPT,
      prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
      future: {
        ...baseSelect,
        runId: "run-2",
        pitAnchor: FUTURE_PIT,
        candidates: [priorCandidate, foreign],
      },
    });
    expect(receipt.futureKnowledgeDigestHex).toBe(receipt.priorKnowledgeDigestHex);
  });

  it("lets a sealed contradiction change later Navigator outcome to UNKNOWN_UNRESOLVED", () => {
    const priorCandidate = candidate({ knowledgeEdgeId: "edge-1" });
    const contradicted = applyQualifiedVerdictToNavigatorCandidateV2(priorCandidate, {
      version: 2,
      contentDigestHex: DIGEST_B,
      lifecycleState: "ACTIVE",
      verified: true,
      relationKind: "CONTRADICTS",
    });
    const receipt = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION",
      effectKind: "CONTRADICTION",
      producedByReceiptDigestHex: RECEIPT,
      prior: { ...baseSelect, pitAnchor: PRIOR_PIT, candidates: [priorCandidate] },
      future: {
        ...baseSelect,
        runId: "run-2",
        pitAnchor: FUTURE_PIT,
        candidates: [
          priorCandidate,
          { ...contradicted, knowledgeEdgeId: "edge-2", fromRef: "btc-regime", toRef: "btc-move" },
        ],
      },
    });
    expect(receipt.effectKind).toBe("CONTRADICTION");
    expect(receipt.futureKnowledgeDigestHex).not.toBe(receipt.priorKnowledgeDigestHex);
  });
});
