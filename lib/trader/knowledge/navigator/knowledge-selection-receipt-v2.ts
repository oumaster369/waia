import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const KNOWLEDGE_SELECTION_RECEIPT_SCHEMA_V2 =
  "waia.trader.knowledge_selection_receipt.v2" as const;

export const KNOWLEDGE_NAVIGATOR_POLICY_V2 = "knowledge-navigator-policy/v2" as const;

export const KNOWLEDGE_SELECTION_OUTCOMES_V2 = [
  "SELECTED_MINIMAL_SUFFICIENT",
  "INSUFFICIENT_EVIDENCE",
  "UNKNOWN_UNRESOLVED",
] as const;

export type KnowledgeSelectionOutcomeV2 = (typeof KNOWLEDGE_SELECTION_OUTCOMES_V2)[number];

export const KNOWLEDGE_CANDIDATE_REJECTION_REASONS_V2 = [
  "WRONG_TENANT",
  "WRONG_SYMBOL",
  "IRRELEVANT_QUESTION",
  "LOOKAHEAD",
  "STALE",
  "RETIRED",
  "MISSING_DIGEST",
  "CONTRADICTORY",
  "REDUNDANT",
  "BUDGET_EXCLUDED",
] as const;

export type KnowledgeCandidateRejectionReasonV2 =
  (typeof KNOWLEDGE_CANDIDATE_REJECTION_REASONS_V2)[number];

const DIGEST = /^[0-9a-f]{64}$/;

export type KnowledgeSelectionIdentityV2 = Readonly<{
  knowledgeEdgeId: string;
  version: number;
  contentDigestHex: string;
}>;

export type KnowledgeCandidateRejectionV2 = Readonly<{
  knowledgeEdgeId: string;
  version: number;
  reason: KnowledgeCandidateRejectionReasonV2;
}>;

export type KnowledgeSelectionReceiptV2 = Readonly<{
  schemaVersion: typeof KNOWLEDGE_SELECTION_RECEIPT_SCHEMA_V2;
  policyVersion: typeof KNOWLEDGE_NAVIGATOR_POLICY_V2;
  organizationId: string;
  runId: string;
  symbol: string;
  purpose: string;
  questionId: string;
  pitAnchor: string;
  informationNeedPlanDigestHex: string;
  outcome: KnowledgeSelectionOutcomeV2;
  selected: readonly KnowledgeSelectionIdentityV2[];
  rejected: readonly KnowledgeCandidateRejectionV2[];
  evidenceBudget: number;
  knowledgeDigestHex: string;
  contentDigestHex: string;
  authority: "KNOWLEDGE_SELECTION_ONLY";
}>;

export function assertKnowledgeSelectionReceiptV2(
  value: KnowledgeSelectionReceiptV2,
): KnowledgeSelectionReceiptV2 {
  const { contentDigestHex, ...body } = value;
  if (
    !value ||
    value.schemaVersion !== KNOWLEDGE_SELECTION_RECEIPT_SCHEMA_V2 ||
    value.policyVersion !== KNOWLEDGE_NAVIGATOR_POLICY_V2 ||
    value.authority !== "KNOWLEDGE_SELECTION_ONLY" ||
    !value.organizationId.trim() ||
    !value.runId.trim() ||
    !value.symbol.trim() ||
    !value.questionId.trim() ||
    !DIGEST.test(value.informationNeedPlanDigestHex) ||
    !DIGEST.test(value.knowledgeDigestHex) ||
    !DIGEST.test(contentDigestHex) ||
    computeSemanticSha256Hex(body) !== contentDigestHex
  ) {
    throw new Error("KNOWLEDGE_SELECTION_RECEIPT_INVALID");
  }
  return value;
}

export function buildKnowledgeSelectionReceiptV2(
  input: Omit<
    KnowledgeSelectionReceiptV2,
    "schemaVersion" | "policyVersion" | "authority" | "contentDigestHex"
  >,
): KnowledgeSelectionReceiptV2 {
  const body = {
    schemaVersion: KNOWLEDGE_SELECTION_RECEIPT_SCHEMA_V2,
    policyVersion: KNOWLEDGE_NAVIGATOR_POLICY_V2,
    authority: "KNOWLEDGE_SELECTION_ONLY" as const,
    ...input,
  };
  return assertKnowledgeSelectionReceiptV2(
    Object.freeze({
      ...body,
      contentDigestHex: computeSemanticSha256Hex(body),
    }),
  );
}
