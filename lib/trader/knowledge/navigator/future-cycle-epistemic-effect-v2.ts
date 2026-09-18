import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

import {
  selectKnowledgeForQuestionV2,
  type KnowledgeNavigatorCandidateV2,
  type SelectKnowledgeForQuestionV2Input,
} from "@/lib/trader/knowledge/navigator/knowledge-navigator-v2";
import type { KnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";

export const FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2 =
  "waia.trader.future_cycle_epistemic_effect.v2" as const;

export const FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2 =
  "future-cycle-epistemic-effect-policy/v2" as const;

export const FUTURE_CYCLE_EFFECT_KINDS_V2 = [
  "SUPPORT",
  "CONTRADICTION",
  "DECAY",
  "INVALIDATION",
  "ZERO_EFFECT",
] as const;

export type FutureCycleEffectKindV2 = (typeof FUTURE_CYCLE_EFFECT_KINDS_V2)[number];

export const FUTURE_CYCLE_EVIDENCE_CLASSES_V2 = [
  "SEALED_FORECAST_OUTCOME_CALIBRATION",
  "UNSEALED_OUTCOME",
  "PNL_ONLY",
  "SAME_CYCLE",
  "LOOKAHEAD",
] as const;

export type FutureCycleEvidenceClassV2 = (typeof FUTURE_CYCLE_EVIDENCE_CLASSES_V2)[number];

export type FutureCycleEpistemicEffectReceiptV2 = Readonly<{
  schemaVersion: typeof FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2;
  policyVersion: typeof FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2;
  authority: "EPISTEMIC_EFFECT_ONLY";
  capitalAuthority: "NONE";
  evidenceClass: FutureCycleEvidenceClassV2;
  effectKind: FutureCycleEffectKindV2;
  priorCyclePitAnchor: string;
  futureCyclePitAnchor: string;
  priorKnowledgeDigestHex: string;
  futureKnowledgeDigestHex: string;
  priorNavigatorReceiptContentDigestHex: string;
  futureNavigatorReceiptContentDigestHex: string;
  producedByReceiptDigestHex: string;
  contentDigestHex: string;
}>;

export type QualifyFutureCycleEpistemicEffectV2Input = Readonly<{
  evidenceClass: FutureCycleEvidenceClassV2;
  effectKind: FutureCycleEffectKindV2;
  producedByReceiptDigestHex: string;
  prior: SelectKnowledgeForQuestionV2Input;
  future: SelectKnowledgeForQuestionV2Input;
}>;

function pitMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("FUTURE_CYCLE_PIT_INVALID");
  }
  return parsed;
}

export function qualifyFutureCycleEpistemicEffectV2(
  input: QualifyFutureCycleEpistemicEffectV2Input,
): FutureCycleEpistemicEffectReceiptV2 {
  if (!/^[0-9a-f]{64}$/.test(input.producedByReceiptDigestHex)) {
    throw new Error("FUTURE_CYCLE_RECEIPT_INVALID");
  }

  const priorReceipt = selectKnowledgeForQuestionV2(input.prior);
  const unauthorized =
    input.evidenceClass === "UNSEALED_OUTCOME" ||
    input.evidenceClass === "PNL_ONLY" ||
    input.evidenceClass === "SAME_CYCLE" ||
    input.evidenceClass === "LOOKAHEAD" ||
    pitMs(input.future.pitAnchor) <= pitMs(input.prior.pitAnchor);

  const futureReceipt: KnowledgeSelectionReceiptV2 = unauthorized
    ? priorReceipt
    : selectKnowledgeForQuestionV2(input.future);

  const effectKind: FutureCycleEffectKindV2 = unauthorized ? "ZERO_EFFECT" : input.effectKind;

  const body = {
    schemaVersion: FUTURE_CYCLE_EPISTEMIC_EFFECT_SCHEMA_V2,
    policyVersion: FUTURE_CYCLE_EPISTEMIC_EFFECT_POLICY_V2,
    authority: "EPISTEMIC_EFFECT_ONLY" as const,
    capitalAuthority: "NONE" as const,
    evidenceClass: input.evidenceClass,
    effectKind,
    priorCyclePitAnchor: input.prior.pitAnchor,
    futureCyclePitAnchor: input.future.pitAnchor,
    priorKnowledgeDigestHex: priorReceipt.knowledgeDigestHex,
    futureKnowledgeDigestHex: futureReceipt.knowledgeDigestHex,
    priorNavigatorReceiptContentDigestHex: priorReceipt.contentDigestHex,
    futureNavigatorReceiptContentDigestHex: futureReceipt.contentDigestHex,
    producedByReceiptDigestHex: input.producedByReceiptDigestHex,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function applyQualifiedVerdictToNavigatorCandidateV2(
  candidate: KnowledgeNavigatorCandidateV2,
  next: Pick<
    KnowledgeNavigatorCandidateV2,
    "version" | "contentDigestHex" | "lifecycleState" | "verified" | "relationKind"
  >,
): KnowledgeNavigatorCandidateV2 {
  return {
    ...candidate,
    version: next.version,
    contentDigestHex: next.contentDigestHex,
    lifecycleState: next.lifecycleState,
    verified: next.verified,
    relationKind: next.relationKind,
  };
}
