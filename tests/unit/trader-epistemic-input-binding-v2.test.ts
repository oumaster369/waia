import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  qualifyFutureCycleEpistemicEffectV2,
  type FutureCycleEpistemicEffectReceiptV2,
} from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import { selectKnowledgeForQuestionV2 } from "@/lib/trader/knowledge/navigator/knowledge-navigator-v2";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import { composeCanonicalEpistemicSpineV2 } from "@/lib/trader/runtime-v2/canonical-epistemic-compose-v2";

const D = "a".repeat(64);
const OTHER = "b".repeat(64);
const PRIOR = "2026-02-01T11:00:00.000Z";
const PIT = "2026-02-01T12:00:00.000Z";
const LATER = "2026-02-01T13:00:00.000Z";

function selection(pitAnchor = PIT) {
  return {
    organizationId: "org-1", runId: "run-1", symbol: "BTCUSDT",
    purpose: "NEW_OPPORTUNITY_SEARCH", questionId: "q-1", pitAnchor,
    informationNeedPlanDigestHex: D, evidenceBudget: 2, maxStalenessMs: 7200000,
    candidates: [{
      knowledgeEdgeId: "edge-1", version: 1, contentDigestHex: D,
      organizationId: "org-1", symbol: "BTCUSDT", questionId: "q-1",
      pitEventAt: PRIOR, lifecycleState: "ACTIVE" as const, verified: true,
      fromRef: "a", toRef: "b", relationKind: "EXPLAINS",
    }],
  };
}

function fixture() {
  return {
    context: buildAuthoritativeRuntimeContextV2({
      organizationId: "org-1", accountId: "account-1", symbol: "BTCUSDT", pitAnchor: PIT,
      runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK", runtimeAssessmentDigestHex: D,
      driftPosture: "NORMAL", driftRestrictionDigestHex: D, qualificationTupleDigestHex: D,
      packageDigestHex: D, informationContractDigestHex: D, informationNeedPlanDigestHex: D,
      releaseDigestHex: D,
    }),
    navigatorReceipt: selectKnowledgeForQuestionV2(selection()),
    predictiveAdmissionVerdict: "ADMITTED" as const,
    futureCycleEffect: qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION", effectKind: "SUPPORT",
      producedByReceiptDigestHex: D, prior: selection(PRIOR), future: selection(),
    }),
  };
}

function reseal(
  receipt: FutureCycleEpistemicEffectReceiptV2,
  patch: Record<string, unknown>,
): FutureCycleEpistemicEffectReceiptV2 {
  const { contentDigestHex: _digest, ...body } = receipt;
  void _digest;
  const changed = { ...body, ...patch };
  return { ...changed, contentDigestHex: computeSemanticSha256Hex(changed) } as FutureCycleEpistemicEffectReceiptV2;
}

function expectRefused(
  input: Parameters<typeof composeCanonicalEpistemicSpineV2>[0],
  reason: string,
) {
  const first = composeCanonicalEpistemicSpineV2(input);
  expect(first.status).toBe("NO_TRADE");
  expect(first.reasonCodes).toContain(reason);
  expect(composeCanonicalEpistemicSpineV2(input)).toEqual(first);
}

describe("DEE-1105 exact epistemic input binding", () => {
  it("preserves canonical current-cycle feedback and no-feedback composition", () => {
    const input = fixture();
    const result = composeCanonicalEpistemicSpineV2(input);
    expect(result.status).toBe("ADMITTED");
    expect(result).toEqual(composeCanonicalEpistemicSpineV2(fixture()));
    expect(composeCanonicalEpistemicSpineV2({ ...input, futureCycleEffect: null }).status).toBe("ADMITTED");
  });

  it.each([PRIOR, LATER])("refuses a correctly hashed Navigator from PIT %s", (pit) => {
    expectRefused({ ...fixture(), navigatorReceipt: selectKnowledgeForQuestionV2(selection(pit)) }, "NAVIGATOR_PIT_MISMATCH");
  });

  it.each([
    ["effectKind", "INVALIDATION"],
    ["priorKnowledgeDigestHex", OTHER],
    ["futureKnowledgeDigestHex", OTHER],
    ["priorNavigatorReceiptContentDigestHex", OTHER],
    ["futureNavigatorReceiptContentDigestHex", OTHER],
    ["producedByReceiptDigestHex", OTHER],
    ["priorCyclePitAnchor", "2026-02-01T10:00:00.000Z"],
    ["futureCyclePitAnchor", LATER],
  ])("refuses changed %s under the original feedback hash", (field, value) => {
    const input = fixture();
    expectRefused({ ...input, futureCycleEffect: { ...input.futureCycleEffect, [field]: value } }, "UNQUALIFIED_FEEDBACK_FORBIDDEN");
  });

  it.each([
    ["schemaVersion", "unknown"], ["policyVersion", "unknown"],
    ["authority", "CAPITAL_AUTHORITY"], ["effectKind", "UNKNOWN_EFFECT"],
    ["evidenceClass", "UNKNOWN_CLASS"], ["producedByReceiptDigestHex", "not-a-digest"],
    ["priorKnowledgeDigestHex", ""], ["priorNavigatorReceiptContentDigestHex", ""],
    ["priorCyclePitAnchor", "not-a-date"], ["futureCyclePitAnchor", "not-a-date"],
  ])("refuses rehashed invalid metadata %s", (field, value) => {
    const input = fixture();
    expectRefused({ ...input, futureCycleEffect: reseal(input.futureCycleEffect, { [field]: value }) }, "UNQUALIFIED_FEEDBACK_FORBIDDEN");
  });

  it("refuses correctly hashed feedback belonging to another future Navigator", () => {
    const input = fixture();
    const foreign = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION", effectKind: "SUPPORT",
      producedByReceiptDigestHex: D, prior: selection(PRIOR),
      future: { ...selection(), organizationId: "other-org", candidates: [] },
    });
    expectRefused({ ...input, futureCycleEffect: foreign }, "FUTURE_CYCLE_NAVIGATOR_MISMATCH");
  });

  it("refuses rehashed feedback whose knowledge differs from its Navigator", () => {
    const input = fixture();
    expectRefused({ ...input, futureCycleEffect: reseal(input.futureCycleEffect, { futureKnowledgeDigestHex: OTHER }) }, "FUTURE_CYCLE_KNOWLEDGE_MISMATCH");
  });

  it("refuses correctly hashed feedback for another future PIT", () => {
    const input = fixture();
    expectRefused({ ...input, futureCycleEffect: reseal(input.futureCycleEffect, { futureCyclePitAnchor: LATER }) }, "FUTURE_CYCLE_PIT_MISMATCH");
  });

  it.each([PIT, LATER])("refuses nonzero feedback from a non-earlier prior PIT %s", (priorCyclePitAnchor) => {
    const input = fixture();
    expectRefused({ ...input, futureCycleEffect: reseal(input.futureCycleEffect, { priorCyclePitAnchor }) }, "UNQUALIFIED_FEEDBACK_FORBIDDEN");
  });

  it.each(["UNSEALED_OUTCOME", "PNL_ONLY", "SAME_CYCLE", "LOOKAHEAD"] as const)(
    "preserves qualified ZERO_EFFECT semantics for %s without importing prior identities",
    (evidenceClass) => {
      const input = fixture();
      const zero = qualifyFutureCycleEpistemicEffectV2({
        evidenceClass, effectKind: "INVALIDATION", producedByReceiptDigestHex: D,
        prior: selection(PRIOR), future: selection(),
      });
      expect(zero.effectKind).toBe("ZERO_EFFECT");
      expect(zero.futureNavigatorReceiptContentDigestHex).not.toBe(input.navigatorReceipt.contentDigestHex);
      expect(composeCanonicalEpistemicSpineV2({ ...input, futureCycleEffect: zero }).status).toBe("ADMITTED");
    },
  );

  it.each([PIT, LATER])("preserves the producer's ZERO_EFFECT for non-forward chronology from %s", (priorPit) => {
    const input = fixture();
    const zero = qualifyFutureCycleEpistemicEffectV2({
      evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION", effectKind: "SUPPORT",
      producedByReceiptDigestHex: D, prior: selection(priorPit), future: selection(),
    });
    expect(zero.effectKind).toBe("ZERO_EFFECT");
    expect(composeCanonicalEpistemicSpineV2({ ...input, futureCycleEffect: zero }).status).toBe("ADMITTED");
  });
});
