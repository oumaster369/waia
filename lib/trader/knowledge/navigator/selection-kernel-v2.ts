/** Pure Navigator policy; returns data, never a receipt or authority. */
import type { KnowledgeCandidateRejectionReasonV2, KnowledgeCandidateRejectionV2,
  KnowledgeSelectionIdentityV2, KnowledgeSelectionOutcomeV2 } from "./knowledge-selection-receipt-v2";

export type SelectionPolicyCandidateV2 = Readonly<{
  knowledgeEdgeId: string;
  version: number;
  contentDigestHex: string;
  organizationId: string;
  symbol: string;
  questionId: string;
  pitEventAt: string;
  lifecycleState: "ACTIVE" | "RETIRED";
  verified: boolean;
  fromRef: string;
  toRef: string;
  relationKind: string;
}>;

export type SelectionPolicyInputV2 = Readonly<{
  organizationId: string;
  runId: string;
  symbol: string;
  purpose: string;
  questionId: string;
  pitAnchor: string;
  evidenceBudget: number;
  maxStalenessMs: number;
  candidates: readonly SelectionPolicyCandidateV2[];
}>;

export type SelectionPolicyResultV2 = Readonly<{ outcome: KnowledgeSelectionOutcomeV2;
  selected: readonly KnowledgeSelectionIdentityV2[]; rejected: readonly KnowledgeCandidateRejectionV2[] }>;

function pitMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("KNOWLEDGE_NAVIGATOR_PIT_INVALID");
  }
  return parsed;
}

function identityKey(candidate: SelectionPolicyCandidateV2): string {
  return `${candidate.fromRef}\0${candidate.toRef}`;
}

function compareIdentities(
  left: SelectionPolicyCandidateV2,
  right: SelectionPolicyCandidateV2,
): number {
  if (left.knowledgeEdgeId !== right.knowledgeEdgeId) {
    return left.knowledgeEdgeId < right.knowledgeEdgeId ? -1 : 1;
  }
  return left.version - right.version;
}

export function selectByKnowledgePolicyV2(
  input: SelectionPolicyInputV2,
): SelectionPolicyResultV2 {
  if (
    !input.organizationId.trim() ||
    !input.runId.trim() ||
    !input.symbol.trim() ||
    !input.questionId.trim() ||
    !input.purpose.trim() ||
    !Number.isSafeInteger(input.evidenceBudget) ||
    input.evidenceBudget < 1 ||
    !Number.isSafeInteger(input.maxStalenessMs) ||
    input.maxStalenessMs < 0
  ) {
    throw new Error("KNOWLEDGE_NAVIGATOR_INPUT_INVALID");
  }

  const pitAnchorMs = pitMs(input.pitAnchor);
  const rejected: KnowledgeCandidateRejectionV2[] = [];
  const admissible: SelectionPolicyCandidateV2[] = [];

  for (const candidate of input.candidates) {
    const reason = classifyRejection(candidate, input, pitAnchorMs);
    if (reason) {
      rejected.push({
        knowledgeEdgeId: candidate.knowledgeEdgeId,
        version: candidate.version,
        reason,
      });
      continue;
    }
    admissible.push(candidate);
  }

  const grouped = new Map<string, SelectionPolicyCandidateV2[]>();
  for (const candidate of admissible) {
    const key = identityKey(candidate);
    const group = grouped.get(key) ?? [];
    group.push(candidate);
    grouped.set(key, group);
  }

  let contradictory = false;
  const independent: SelectionPolicyCandidateV2[] = [];
  for (const group of grouped.values()) {
    const kinds = new Set(group.map((item) => item.relationKind));
    if (kinds.size > 1 && group.every((item) => item.verified)) {
      contradictory = true;
      for (const item of group) {
        rejected.push({
          knowledgeEdgeId: item.knowledgeEdgeId,
          version: item.version,
          reason: "CONTRADICTORY",
        });
      }
      continue;
    }
    independent.push(...group);
  }

  independent.sort(compareIdentities);
  const uniqueByDigest = new Map<string, SelectionPolicyCandidateV2>();
  for (const candidate of independent) {
    const existing = uniqueByDigest.get(candidate.contentDigestHex);
    if (existing) {
      rejected.push({
        knowledgeEdgeId: candidate.knowledgeEdgeId,
        version: candidate.version,
        reason: "REDUNDANT",
      });
      continue;
    }
    uniqueByDigest.set(candidate.contentDigestHex, candidate);
  }

  const unique = [...uniqueByDigest.values()].sort(compareIdentities);
  let selected: KnowledgeSelectionIdentityV2[] = [];
  let outcome: KnowledgeSelectionOutcomeV2;

  if (contradictory) {
    outcome = "UNKNOWN_UNRESOLVED";
    for (const leftover of unique) {
      rejected.push({
        knowledgeEdgeId: leftover.knowledgeEdgeId,
        version: leftover.version,
        reason: "CONTRADICTORY",
      });
    }
  } else {
    const selectedCandidates = unique.slice(0, input.evidenceBudget);
    for (const extra of unique.slice(input.evidenceBudget)) {
      rejected.push({
        knowledgeEdgeId: extra.knowledgeEdgeId,
        version: extra.version,
        reason: "BUDGET_EXCLUDED",
      });
    }
    selected = selectedCandidates.map((candidate) => ({
      knowledgeEdgeId: candidate.knowledgeEdgeId,
      version: candidate.version,
      contentDigestHex: candidate.contentDigestHex,
    }));
    outcome = selected.length === 0 ? "INSUFFICIENT_EVIDENCE" : "SELECTED_MINIMAL_SUFFICIENT";
  }

  rejected.sort((left, right) => {
    if (left.knowledgeEdgeId !== right.knowledgeEdgeId) {
      return left.knowledgeEdgeId < right.knowledgeEdgeId ? -1 : 1;
    }
    return left.version - right.version;
  });

  return { outcome, selected, rejected };
}

function classifyRejection(
  candidate: SelectionPolicyCandidateV2,
  input: SelectionPolicyInputV2,
  pitAnchorMs: number,
): KnowledgeCandidateRejectionReasonV2 | null {
  if (candidate.organizationId !== input.organizationId) return "WRONG_TENANT";
  if (candidate.symbol !== input.symbol) return "WRONG_SYMBOL";
  if (candidate.questionId !== input.questionId) return "IRRELEVANT_QUESTION";
  if (!/^[0-9a-f]{64}$/.test(candidate.contentDigestHex)) return "MISSING_DIGEST";
  if (candidate.lifecycleState === "RETIRED") return "RETIRED";
  const eventMs = pitMs(candidate.pitEventAt);
  if (eventMs > pitAnchorMs) return "LOOKAHEAD";
  if (pitAnchorMs - eventMs > input.maxStalenessMs) return "STALE";
  return null;
}
