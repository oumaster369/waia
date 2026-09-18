import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  KNOWLEDGE_NAVIGATOR_CAPITAL_FIELDS_V2,
  selectKnowledgeForQuestionV2,
  type KnowledgeNavigatorCandidateV2,
} from "@/lib/trader/knowledge/navigator";

const PIT = "2026-01-15T12:00:00.000Z";
const PLAN = "a".repeat(64);
const DIGEST_A = "b".repeat(64);
const DIGEST_B = "c".repeat(64);

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

const baseInput = {
  organizationId: "org-1",
  runId: "run-1",
  symbol: "BTCUSDT",
  purpose: "NEW_OPPORTUNITY_SEARCH",
  questionId: "WHAT_HAPPENING",
  pitAnchor: PIT,
  informationNeedPlanDigestHex: PLAN,
  evidenceBudget: 2,
  maxStalenessMs: 24 * 60 * 60 * 1000,
};

describe("DEE-772 Knowledge Navigator V2", () => {
  it("selects the minimal sufficient PIT-visible set and is deterministic", () => {
    const first = selectKnowledgeForQuestionV2({
      ...baseInput,
      candidates: [candidate({ knowledgeEdgeId: "edge-1" })],
    });
    const second = selectKnowledgeForQuestionV2({
      ...baseInput,
      candidates: [candidate({ knowledgeEdgeId: "edge-1" })],
    });
    expect(first.outcome).toBe("SELECTED_MINIMAL_SUFFICIENT");
    expect(first.selected).toEqual([
      { knowledgeEdgeId: "edge-1", version: 1, contentDigestHex: DIGEST_A },
    ]);
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
    expect(first.authority).toBe("KNOWLEDGE_SELECTION_ONLY");
    for (const field of KNOWLEDGE_NAVIGATOR_CAPITAL_FIELDS_V2) {
      expect(first).not.toHaveProperty(field);
    }
  });

  it("rejects lookahead, other tenants, other symbols, stale, retired and irrelevant questions", () => {
    const receipt = selectKnowledgeForQuestionV2({
      ...baseInput,
      maxStalenessMs: 60 * 60 * 1000,
      candidates: [
        candidate({ knowledgeEdgeId: "future", pitEventAt: "2026-01-15T13:00:00.000Z" }),
        candidate({ knowledgeEdgeId: "other-org", organizationId: "org-2" }),
        candidate({ knowledgeEdgeId: "other-symbol", symbol: "ETHUSDT" }),
        candidate({ knowledgeEdgeId: "stale", pitEventAt: "2026-01-01T00:00:00.000Z" }),
        candidate({ knowledgeEdgeId: "retired", lifecycleState: "RETIRED" }),
        candidate({ knowledgeEdgeId: "other-q", questionId: "WHY_HAPPENING" }),
        candidate({ knowledgeEdgeId: "bad-digest", contentDigestHex: "nope" }),
      ],
    });
    expect(receipt.outcome).toBe("INSUFFICIENT_EVIDENCE");
    expect(receipt.selected).toEqual([]);
    expect(receipt.rejected.map((row) => row.reason).sort()).toEqual([
      "IRRELEVANT_QUESTION",
      "LOOKAHEAD",
      "MISSING_DIGEST",
      "RETIRED",
      "STALE",
      "WRONG_SYMBOL",
      "WRONG_TENANT",
    ]);
  });

  it("returns UNKNOWN_UNRESOLVED for verified contradictory relation kinds on the same edge identity", () => {
    const receipt = selectKnowledgeForQuestionV2({
      ...baseInput,
      candidates: [
        candidate({ knowledgeEdgeId: "a", relationKind: "EXPLAINS" }),
        candidate({
          knowledgeEdgeId: "b",
          relationKind: "CONTRADICTS",
          contentDigestHex: DIGEST_B,
        }),
      ],
    });
    expect(receipt.outcome).toBe("UNKNOWN_UNRESOLVED");
    expect(receipt.selected).toEqual([]);
    expect(receipt.rejected.every((row) => row.reason === "CONTRADICTORY")).toBe(true);
  });

  it("drops redundant identical content and enforces the evidence budget", () => {
    const receipt = selectKnowledgeForQuestionV2({
      ...baseInput,
      evidenceBudget: 1,
      candidates: [
        candidate({ knowledgeEdgeId: "edge-a", fromRef: "one" }),
        candidate({ knowledgeEdgeId: "edge-a-dup", fromRef: "two" }),
        candidate({
          knowledgeEdgeId: "edge-b",
          fromRef: "three",
          contentDigestHex: DIGEST_B,
        }),
      ],
    });
    expect(receipt.selected).toEqual([
      { knowledgeEdgeId: "edge-a", version: 1, contentDigestHex: DIGEST_A },
    ]);
    expect(receipt.rejected.map((row) => row.reason).sort()).toEqual([
      "BUDGET_EXCLUDED",
      "REDUNDANT",
    ]);
    expect(receipt.knowledgeDigestHex).toBe(
      computeSemanticSha256Hex({
        outcome: "SELECTED_MINIMAL_SUFFICIENT",
        selected: receipt.selected,
      }),
    );
  });
});
