import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertKnowledgeSelectionReceiptV2,
  type KnowledgeSelectionReceiptV2,
} from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import {
  FUTURE_CYCLE_EFFECT_KINDS_V2,
  FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2,
  FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2,
  FUTURE_CYCLE_EVIDENCE_CLASSES_V2,
  type FutureCycleEpistemicEffectReceiptV2,
} from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import type { AuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";

export const CANONICAL_EPISTEMIC_COMPOSE_SCHEMA_V2 =
  "waia.trader.canonical_epistemic_compose.v2" as const;

export type CanonicalEpistemicComposeV2 = Readonly<{
  schemaVersion: typeof CANONICAL_EPISTEMIC_COMPOSE_SCHEMA_V2;
  authority: "EPISTEMIC_COMPOSE_ONLY";
  capitalAuthority: "NONE";
  status: "ADMITTED" | "NO_TRADE";
  reasonCodes: readonly string[];
  runtimeContextDigestHex: string;
  informationNeedPlanDigestHex: string;
  navigatorReceiptDigestHex: string | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffectKind: string | null;
  contentDigestHex: string;
}>;

export type ComposeCanonicalEpistemicSpineV2Input = Readonly<{
  context: AuthoritativeRuntimeContextV2;
  navigatorReceipt: KnowledgeSelectionReceiptV2 | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffect: FutureCycleEpistemicEffectReceiptV2 | null;
  mkbInjectionAttempted?: boolean;
  legacyKnowledgeMutationAttempted?: boolean;
}>;

function freezeCompose(
  body: Omit<CanonicalEpistemicComposeV2, "contentDigestHex">,
): CanonicalEpistemicComposeV2 {
  return Object.freeze({
    ...body,
    reasonCodes: Object.freeze([...new Set(body.reasonCodes)].sort()),
    contentDigestHex: computeSemanticSha256Hex({
      ...body,
      reasonCodes: [...new Set(body.reasonCodes)].sort(),
    }),
  });
}

export function predictiveAdmissionReasonCode(
  verdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY",
): "PREDICTIVE_ADMISSION_NOT_ADMITTED" | "RESEARCH_ONLY_NOT_CAPITAL_ELIGIBLE" | null {
  if (verdict === "ADMITTED") return null;
  if (verdict === "RESEARCH_ONLY") return "RESEARCH_ONLY_NOT_CAPITAL_ELIGIBLE";
  return "PREDICTIVE_ADMISSION_NOT_ADMITTED";
}

function hasCanonicalFeedbackBody(value: FutureCycleEpistemicEffectReceiptV2): boolean {
  try {
    const { contentDigestHex, ...body } = value;
    return (
      value.schemaVersion === FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2 &&
      value.policyVersion === FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2 &&
      value.authority === "EPISTEMIC_EFFECT_ONLY" &&
      value.capitalAuthority === "NONE" &&
      FUTURE_CYCLE_EFFECT_KINDS_V2.includes(value.effectKind) &&
      FUTURE_CYCLE_EVIDENCE_CLASSES_V2.includes(value.evidenceClass) &&
      [
        contentDigestHex,
        value.priorKnowledgeDigestHex,
        value.futureKnowledgeDigestHex,
        value.priorNavigatorReceiptContentDigestHex,
        value.futureNavigatorReceiptContentDigestHex,
        value.producedByReceiptDigestHex,
      ].every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) &&
      [value.priorCyclePitAnchor, value.futureCyclePitAnchor].every((pit) => {
        const time = Date.parse(pit);
        return Number.isFinite(time) && new Date(time).toISOString() === pit;
      }) &&
      computeSemanticSha256Hex(body) === contentDigestHex
    );
  } catch {
    return false;
  }
}

export function composeCanonicalEpistemicSpineV2(
  input: ComposeCanonicalEpistemicSpineV2Input,
): CanonicalEpistemicComposeV2 {
  const reasonCodes: string[] = [];
  if (input.mkbInjectionAttempted) reasonCodes.push("RAW_MKB_INJECTION_FORBIDDEN");
  if (input.legacyKnowledgeMutationAttempted) {
    reasonCodes.push("LEGACY_KNOWLEDGE_MUTATION_FORBIDDEN");
  }
  if (!input.navigatorReceipt) {
    reasonCodes.push("NAVIGATOR_RECEIPT_MISSING");
  } else {
    assertKnowledgeSelectionReceiptV2(input.navigatorReceipt);
    if (input.navigatorReceipt.organizationId !== input.context.organizationId) {
      reasonCodes.push("NAVIGATOR_TENANT_MISMATCH");
    }
    if (input.navigatorReceipt.symbol !== input.context.symbol) {
      reasonCodes.push("NAVIGATOR_SYMBOL_MISMATCH");
    }
    if (input.navigatorReceipt.pitAnchor !== input.context.pitAnchor) {
      reasonCodes.push("NAVIGATOR_PIT_MISMATCH");
    }
    if (
      input.navigatorReceipt.informationNeedPlanDigestHex !==
      input.context.informationNeedPlanDigestHex
    ) {
      reasonCodes.push("NAVIGATOR_NEED_PLAN_MISMATCH");
    }
    if (input.navigatorReceipt.outcome !== "SELECTED_MINIMAL_SUFFICIENT") {
      reasonCodes.push("NAVIGATOR_NOT_MINIMAL_SUFFICIENT");
    }
  }
  const admissionReason = predictiveAdmissionReasonCode(input.predictiveAdmissionVerdict);
  if (admissionReason) reasonCodes.push(admissionReason);
  if (input.futureCycleEffect) {
    const effect = input.futureCycleEffect;
    if (!hasCanonicalFeedbackBody(effect)) {
      reasonCodes.push("UNQUALIFIED_FEEDBACK_FORBIDDEN");
    } else {
      if (effect.futureCyclePitAnchor !== input.context.pitAnchor) {
        reasonCodes.push("FUTURE_CYCLE_PIT_MISMATCH");
      }
      // ZERO_EFFECT deliberately replays prior identities when evidence cannot
      // affect a later cycle. Only a nonzero effect must bind the current selection.
      if (effect.effectKind !== "ZERO_EFFECT") {
        if (Date.parse(effect.priorCyclePitAnchor) >= Date.parse(effect.futureCyclePitAnchor)) {
          reasonCodes.push("UNQUALIFIED_FEEDBACK_FORBIDDEN");
        }
        if (effect.futureNavigatorReceiptContentDigestHex !== input.navigatorReceipt?.contentDigestHex) {
          reasonCodes.push("FUTURE_CYCLE_NAVIGATOR_MISMATCH");
        }
        if (effect.futureKnowledgeDigestHex !== input.navigatorReceipt?.knowledgeDigestHex) {
          reasonCodes.push("FUTURE_CYCLE_KNOWLEDGE_MISMATCH");
        }
      }
    }
    if (input.futureCycleEffect.capitalAuthority !== "NONE") {
      reasonCodes.push("FUTURE_CYCLE_CAPITAL_AUTHORITY_FORBIDDEN");
    }
    if (
      input.futureCycleEffect.evidenceClass !== "SEALED_FORECAST_OUTCOME_CALIBRATION" &&
      input.futureCycleEffect.effectKind !== "ZERO_EFFECT"
    ) {
      reasonCodes.push("UNQUALIFIED_FEEDBACK_FORBIDDEN");
    }
  }
  if (input.context.runtimePosture === "HALT") reasonCodes.push("RUNTIME_HALTED");
  if (input.context.driftPosture === "SUPERVISED_STOP") reasonCodes.push("DRIFT_SUPERVISED_STOP");

  const admitted = reasonCodes.length === 0;
  return freezeCompose({
    schemaVersion: CANONICAL_EPISTEMIC_COMPOSE_SCHEMA_V2,
    authority: "EPISTEMIC_COMPOSE_ONLY",
    capitalAuthority: "NONE",
    status: admitted ? "ADMITTED" : "NO_TRADE",
    reasonCodes,
    runtimeContextDigestHex: input.context.contentDigestHex,
    informationNeedPlanDigestHex: input.context.informationNeedPlanDigestHex,
    navigatorReceiptDigestHex: input.navigatorReceipt?.contentDigestHex ?? null,
    predictiveAdmissionVerdict: input.predictiveAdmissionVerdict,
    futureCycleEffectKind: input.futureCycleEffect?.effectKind ?? null,
  });
}
