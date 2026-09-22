import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertKnowledgeSelectionReceiptV2,
  type KnowledgeSelectionReceiptV2,
} from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import type { FutureCycleEpistemicEffectReceiptV2 } from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
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
