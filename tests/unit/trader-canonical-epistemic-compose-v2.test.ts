import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2,
  FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2,
  type FutureCycleEpistemicEffectReceiptV2,
} from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import { buildKnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import { composeCanonicalEpistemicSpineV2 } from "@/lib/trader/runtime-v2/canonical-epistemic-compose-v2";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";

const DIGEST = "a".repeat(64);
const ORG = "org-1";
const PIT = "2026-02-01T12:00:00.000Z";

function context() {
  return buildAuthoritativeRuntimeContextV2({
    organizationId: ORG,
    accountId: "account-1",
    symbol: "BTCUSDT",
    pitAnchor: PIT,
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    runtimeAssessmentDigestHex: DIGEST,
    driftPosture: "NORMAL",
    driftRestrictionDigestHex: DIGEST,
    qualificationTupleDigestHex: DIGEST,
    packageDigestHex: DIGEST,
    informationContractDigestHex: DIGEST,
    informationNeedPlanDigestHex: DIGEST,
    releaseDigestHex: DIGEST,
  });
}

function navigator() {
  return buildKnowledgeSelectionReceiptV2({
    organizationId: ORG,
    runId: "run-1",
    symbol: "BTCUSDT",
    purpose: "forecast",
    questionId: "q-1",
    pitAnchor: PIT,
    informationNeedPlanDigestHex: DIGEST,
    outcome: "SELECTED_MINIMAL_SUFFICIENT",
    selected: [{ knowledgeEdgeId: "edge-1", version: 1, contentDigestHex: DIGEST }],
    rejected: [],
    evidenceBudget: 8,
    knowledgeDigestHex: DIGEST,
  });
}

function futureCycle(
  patch: Partial<FutureCycleEpistemicEffectReceiptV2> = {},
): FutureCycleEpistemicEffectReceiptV2 {
  const body = {
    schemaVersion: FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2,
    policyVersion: FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2,
    authority: "EPISTEMIC_EFFECT_ONLY" as const,
    capitalAuthority: "NONE" as const,
    evidenceClass: "SEALED_FORECAST_OUTCOME_CALIBRATION" as const,
    effectKind: "SUPPORT" as const,
    priorCyclePitAnchor: "2026-02-01T11:00:00.000Z",
    futureCyclePitAnchor: PIT,
    priorKnowledgeDigestHex: DIGEST,
    futureKnowledgeDigestHex: DIGEST,
    priorNavigatorReceiptContentDigestHex: DIGEST,
    futureNavigatorReceiptContentDigestHex: navigator().contentDigestHex,
    producedByReceiptDigestHex: DIGEST,
    ...patch,
  };
  return {
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  };
}

describe("DEE-639 canonical epistemic compose", () => {
  it("admits Navigator + Predictive Admission and is deterministic", () => {
    const first = composeCanonicalEpistemicSpineV2({
      context: context(),
      navigatorReceipt: navigator(),
      predictiveAdmissionVerdict: "ADMITTED",
      futureCycleEffect: futureCycle(),
    });
    const second = composeCanonicalEpistemicSpineV2({
      context: context(),
      navigatorReceipt: navigator(),
      predictiveAdmissionVerdict: "ADMITTED",
      futureCycleEffect: futureCycle(),
    });
    expect(first.status).toBe("ADMITTED");
    expect(first.capitalAuthority).toBe("NONE");
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
  });

  it("fails closed on raw MKB, missing Navigator, RESEARCH_ONLY, unqualified feedback and halt", () => {
    expect(
      composeCanonicalEpistemicSpineV2({
        context: context(),
        navigatorReceipt: navigator(),
        predictiveAdmissionVerdict: "ADMITTED",
        futureCycleEffect: null,
        mkbInjectionAttempted: true,
      }).reasonCodes,
    ).toContain("RAW_MKB_INJECTION_FORBIDDEN");
    expect(
      composeCanonicalEpistemicSpineV2({
        context: context(),
        navigatorReceipt: null,
        predictiveAdmissionVerdict: "ADMITTED",
        futureCycleEffect: null,
      }).reasonCodes,
    ).toContain("NAVIGATOR_RECEIPT_MISSING");
    expect(
      composeCanonicalEpistemicSpineV2({
        context: context(),
        navigatorReceipt: navigator(),
        predictiveAdmissionVerdict: "RESEARCH_ONLY",
        futureCycleEffect: null,
      }).reasonCodes,
    ).toContain("RESEARCH_ONLY_NOT_CAPITAL_ELIGIBLE");
    expect(
      composeCanonicalEpistemicSpineV2({
        context: context(),
        navigatorReceipt: navigator(),
        predictiveAdmissionVerdict: "ADMITTED",
        futureCycleEffect: futureCycle({
          evidenceClass: "PNL_ONLY",
          effectKind: "SUPPORT",
        }),
      }).reasonCodes,
    ).toContain("UNQUALIFIED_FEEDBACK_FORBIDDEN");
    expect(
      composeCanonicalEpistemicSpineV2({
        context: buildAuthoritativeRuntimeContextV2({
          organizationId: ORG,
          accountId: "account-1",
          symbol: "BTCUSDT",
          pitAnchor: PIT,
          runtimePosture: "HALT",
          runtimeAssessmentDigestHex: DIGEST,
          driftPosture: "NORMAL",
          driftRestrictionDigestHex: DIGEST,
          qualificationTupleDigestHex: DIGEST,
          packageDigestHex: DIGEST,
          informationContractDigestHex: DIGEST,
          informationNeedPlanDigestHex: DIGEST,
          releaseDigestHex: DIGEST,
        }),
        navigatorReceipt: navigator(),
        predictiveAdmissionVerdict: "ADMITTED",
        futureCycleEffect: null,
      }).reasonCodes,
    ).toContain("RUNTIME_HALTED");
  });
});
