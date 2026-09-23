import { describe, expect, it } from "vitest";

import { presentPromotionProposal } from "@/lib/trader/admin-console/research/promotion-proposal";

describe("promotion proposal summary", () => {
  it("keeps the decision fields and drops evidence arrays", () => {
    const summary = presentPromotionProposal({
      id: "p-1",
      organizationId: "org-1",
      disposition: "pending",
      createdAt: "2026-09-23T00:00:00.000Z",
      payloadJson: JSON.stringify({
        proposalId: "proposal-1",
        approvalAuthority: "HUMAN_ONLY",
        capitalAuthority: "NONE",
        proposedEligibleSymbols: ["BTCUSDT"],
        positiveEvidence: [{ note: "EVIDENCE-SHOULD-NOT-LEAK" }],
        negativeEvidence: [{ note: "NEGATIVE-SHOULD-NOT-LEAK" }],
      }),
    });
    const encoded = JSON.stringify(summary);
    expect(summary.proposalId).toBe("proposal-1");
    expect(summary.symbols).toEqual(["BTCUSDT"]);
    expect(summary.approvalAuthority).toBe("HUMAN_ONLY");
    expect(summary.capitalAuthority).toBe("NONE");
    expect(summary.readable).toBe(true);
    expect(encoded).not.toContain("EVIDENCE-SHOULD-NOT-LEAK");
    expect(encoded).not.toContain("NEGATIVE-SHOULD-NOT-LEAK");
    expect(
      presentPromotionProposal({
        id: "p-2",
        organizationId: "org-1",
        disposition: "pending",
        createdAt: null,
        payloadJson: "{",
      }).readable,
    ).toBe(false);
  });
});
