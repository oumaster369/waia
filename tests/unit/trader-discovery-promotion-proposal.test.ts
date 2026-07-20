import { describe, expect, it } from "vitest";

import { buildPromotionProposal } from "@/lib/trader/discovery/promotion-proposal-builder";

describe("promotion proposal builder (M8)", () => {
  it("never recommends promote", () => {
    const proposal = buildPromotionProposal({
      organizationId: "org-1",
      campaignId: "camp-1",
      candidateId: "cand-1",
      comparison: {
        ranked: [
          {
            candidateRef: "cand-1",
            aggregateRankScore: "0.80",
            dimensionScores: [],
            rank: 1,
          },
        ],
        comparisonDigest: "digest-1",
      },
      proposalId: "pp-1",
    });

    expect(proposal.humanGateRequired).toBe(true);
    expect(["human_review", "defer", "reject"]).toContain(proposal.recommends);
    expect(proposal.recommends).not.toBe("promote" as never);
  });
});
