import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildKnowledgeSelectionReceiptV2, type KnowledgeSelectionReceiptV2 } from "./knowledge-selection-receipt-v2";
import { selectByKnowledgePolicyV2, type SelectionPolicyCandidateV2, type SelectionPolicyInputV2 } from "./selection-kernel-v2";

export type KnowledgeNavigatorCandidateV2 = SelectionPolicyCandidateV2;
export type SelectKnowledgeForQuestionV2Input = SelectionPolicyInputV2 & Readonly<{ informationNeedPlanDigestHex: string }>;

/** Ordinary receipt boundary; the shared policy itself grants no authority. */
export function selectKnowledgeForQuestionV2(input: SelectKnowledgeForQuestionV2Input): KnowledgeSelectionReceiptV2 {
  for (const candidate of input.candidates) {
    const marker = candidate as unknown as { authority?: unknown; schemaVersion?: unknown };
    if (marker.authority === "RESEARCH_APPLICATION_ONLY" ||
      (typeof marker.schemaVersion === "string" && marker.schemaVersion.startsWith("waia.trader.research_application")))
      throw new Error("RESEARCH_APPLICATION_BOUNDARY");
  }
  const { outcome, selected, rejected } = selectByKnowledgePolicyV2(input);
  return buildKnowledgeSelectionReceiptV2({
    organizationId: input.organizationId, runId: input.runId, symbol: input.symbol, purpose: input.purpose,
    questionId: input.questionId, pitAnchor: input.pitAnchor, informationNeedPlanDigestHex: input.informationNeedPlanDigestHex,
    outcome, selected, rejected, evidenceBudget: input.evidenceBudget,
    knowledgeDigestHex: computeSemanticSha256Hex({ outcome, selected }),
  });
}
