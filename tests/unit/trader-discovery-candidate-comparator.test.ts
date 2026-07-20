import { describe, expect, it } from "vitest";

import { rankCandidatesByEpistemicEvidence } from "@/lib/trader/discovery/candidate-comparator";
import { EpistemicEvidenceDimension } from "@/lib/trader/discovery/evidence.types";
import { appendEvidenceRecord } from "@/lib/trader/discovery/evidence-ledger";

describe("candidate comparator (M8)", () => {
  it("ranks by epistemic dimensions only", () => {
    const strong = appendEvidenceRecord(
      {
        organizationId: "org-1",
        campaignId: "camp-1",
        candidateRef: "cand-strong",
        dimension: EpistemicEvidenceDimension.RegimeCoverage,
        direction: "FOR",
        strength: "0.90",
        uncertaintyBandLow: "0.7",
        uncertaintyBandHigh: "0.95",
        sourceRunDigest: "run-1",
        relevanceScore: "1",
        rationaleJson: "{}",
      },
      "ev-1",
    );
    const weak = appendEvidenceRecord(
      {
        organizationId: "org-1",
        campaignId: "camp-1",
        candidateRef: "cand-weak",
        dimension: EpistemicEvidenceDimension.RegimeCoverage,
        direction: "AGAINST",
        strength: "0.20",
        uncertaintyBandLow: "0.1",
        uncertaintyBandHigh: "0.3",
        sourceRunDigest: "run-1",
        relevanceScore: "1",
        rationaleJson: "{}",
      },
      "ev-2",
    );

    const result = rankCandidatesByEpistemicEvidence({
      candidates: ["cand-weak", "cand-strong"],
      evidenceByCandidate: new Map([
        ["cand-strong", [strong]],
        ["cand-weak", [weak]],
      ]),
    });

    expect(result.ranked[0]?.candidateRef).toBe("cand-strong");
    expect(result.ranked[1]?.candidateRef).toBe("cand-weak");
    expect(result.comparisonDigest.length).toBeGreaterThan(0);
  });
});
