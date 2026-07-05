import { describe, expect, it } from "vitest";

import {
  assertNoBannedFields,
  BANNED_DISCOVERY_FIELDS,
  NoReinforcementGuardError,
} from "@/lib/trader/discovery/no-reinforcement-guard";
import { rankCandidatesByEpistemicEvidence } from "@/lib/trader/discovery/candidate-comparator";
import { EpistemicEvidenceDimension } from "@/lib/trader/discovery/evidence.types";
import { appendEvidenceRecord } from "@/lib/trader/discovery/evidence-ledger";

describe("no reinforcement guard (M8)", () => {
  it("lists banned discovery fields", () => {
    expect(BANNED_DISCOVERY_FIELDS).toContain("pnl");
    expect(BANNED_DISCOVERY_FIELDS).toContain("fitness");
  });

  it("rejects banned fields in comparator input", () => {
    expect(() =>
      rankCandidatesByEpistemicEvidence({
        candidates: ["cand-1"],
        evidenceByCandidate: new Map([
          [
            "cand-1",
            [
              {
                schemaVersion: "waia.trader.discovery-evidence.v1",
                evidenceId: "e1",
                organizationId: "org-1",
                campaignId: "camp-1",
                hypothesisRef: null,
                candidateRef: "cand-1",
                dimension: EpistemicEvidenceDimension.RegimeCoverage,
                direction: "FOR",
                strength: "0.8",
                uncertaintyBandLow: "0.1",
                uncertaintyBandHigh: "0.9",
                contradictionRefs: [],
                sourceRunDigest: "digest-1",
                relevanceScore: "1",
                rationaleJson: "{}",
                contentDigest: "cd1",
                createdAt: new Date().toISOString(),
                tradePnl: "1",
              } as never,
            ],
          ],
        ]),
      }),
    ).toThrow(NoReinforcementGuardError);
  });

  it("allows epistemic evidence without PnL fields", () => {
    const record = appendEvidenceRecord(
      {
        organizationId: "org-1",
        campaignId: "camp-1",
        candidateRef: "cand-1",
        dimension: EpistemicEvidenceDimension.Reproducibility,
        direction: "FOR",
        strength: "0.75",
        uncertaintyBandLow: "0.5",
        uncertaintyBandHigh: "0.9",
        sourceRunDigest: "run-digest",
        relevanceScore: "1",
        rationaleJson: '{"note":"epistemic_not_success_probability"}',
      },
      "evidence-1",
    );
    expect(() => assertNoBannedFields(record, "evidence")).not.toThrow();
  });
});
