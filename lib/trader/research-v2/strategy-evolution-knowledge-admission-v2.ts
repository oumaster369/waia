import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertKnowledgeSelectionReceiptV2,
  selectKnowledgeForQuestionV2,
  type KnowledgeSelectionReceiptV2,
  type SelectKnowledgeForQuestionV2Input,
} from "@/lib/trader/knowledge/navigator";
import type { FutureCycleEpistemicEffectReceiptV2 } from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import { uniqueSortedReasonCodes } from "@/lib/trader/research-v2/research-v2-guards";

export const STRATEGY_EVOLUTION_KNOWLEDGE_ADMISSION_V2_SCHEMA =
  "waia.trader.strategy_evolution_knowledge_admission.v2" as const;

export type StrategyEvolutionKnowledgeAdmissionV2 = Readonly<{
  schemaVersion: typeof STRATEGY_EVOLUTION_KNOWLEDGE_ADMISSION_V2_SCHEMA;
  authority: "KNOWLEDGE_SELECTION_ONLY";
  capitalAuthority: "NONE";
  status: "ADMITTED" | "FAIL_CLOSED";
  reasonCodes: readonly string[];
  navigatorReceiptDigestHex: string | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffectKind: string | null;
  contentDigestHex: string;
}>;

export type AdmitStrategyEvolutionKnowledgeV2Input = Readonly<{
  navigatorSelect: SelectKnowledgeForQuestionV2Input | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffect: FutureCycleEpistemicEffectReceiptV2 | null;
  mkbInjectionAttempted?: boolean;
  legacyKnowledgeMutationAttempted?: boolean;
}>;

function freezeAdmission(
  body: Omit<StrategyEvolutionKnowledgeAdmissionV2, "contentDigestHex">,
): StrategyEvolutionKnowledgeAdmissionV2 {
  const reasonCodes = uniqueSortedReasonCodes(body.reasonCodes);
  const next = {
    ...body,
    reasonCodes,
  };
  return Object.freeze({
    ...next,
    contentDigestHex: computeSemanticSha256Hex(next),
  });
}

export function admitStrategyEvolutionKnowledgeV2(
  input: AdmitStrategyEvolutionKnowledgeV2Input,
): StrategyEvolutionKnowledgeAdmissionV2 {
  const reasonCodes: string[] = [];
  let navigatorReceipt: KnowledgeSelectionReceiptV2 | null = null;

  if (input.mkbInjectionAttempted) {
    reasonCodes.push("RAW_MKB_INJECTION_FORBIDDEN");
  }
  if (input.legacyKnowledgeMutationAttempted) {
    reasonCodes.push("LEGACY_KNOWLEDGE_MUTATION_FORBIDDEN");
  }
  if (!input.navigatorSelect) {
    reasonCodes.push("NAVIGATOR_RECEIPT_MISSING");
  } else {
    navigatorReceipt = selectKnowledgeForQuestionV2(input.navigatorSelect);
    assertKnowledgeSelectionReceiptV2(navigatorReceipt);
    if (navigatorReceipt.outcome !== "SELECTED_MINIMAL_SUFFICIENT") {
      reasonCodes.push("NAVIGATOR_NOT_MINIMAL_SUFFICIENT");
    }
  }
  if (input.predictiveAdmissionVerdict === "NOT_ADMITTED") {
    reasonCodes.push("PREDICTIVE_ADMISSION_NOT_ADMITTED");
  }
  if (!input.futureCycleEffect) {
    reasonCodes.push("UNQUALIFIED_FEEDBACK_FORBIDDEN");
  } else {
    if (input.futureCycleEffect.capitalAuthority !== "NONE") {
      reasonCodes.push("FUTURE_CYCLE_CAPITAL_AUTHORITY_FORBIDDEN");
    }
    if (input.futureCycleEffect.evidenceClass !== "SEALED_FORECAST_OUTCOME_CALIBRATION") {
      reasonCodes.push("UNQUALIFIED_FEEDBACK_FORBIDDEN");
    }
  }

  const admitted = reasonCodes.length === 0;
  return freezeAdmission({
    schemaVersion: STRATEGY_EVOLUTION_KNOWLEDGE_ADMISSION_V2_SCHEMA,
    authority: "KNOWLEDGE_SELECTION_ONLY",
    capitalAuthority: "NONE",
    status: admitted ? "ADMITTED" : "FAIL_CLOSED",
    reasonCodes,
    navigatorReceiptDigestHex: navigatorReceipt?.contentDigestHex ?? null,
    predictiveAdmissionVerdict: input.predictiveAdmissionVerdict,
    futureCycleEffectKind: input.futureCycleEffect?.effectKind ?? null,
  });
}
