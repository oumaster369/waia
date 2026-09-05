import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { assertHistoricalTechnicalProposalV2, HISTORICAL_TECHNICAL_PROPOSAL_V2,
  type HistoricalTechnicalProposalV2 } from "@/lib/trader/historical-simulation-v2/ratification-split-v2";

const seal = <T extends object>(body: T) => ({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
const scope = { organizationId: "11111111-1111-4111-8111-111111111111",
  runId: "run-a", releaseSha: "a".repeat(40) };
const candidate = seal({ ...scope,
  schemaVersion: "waia.trader.historical_four_surface_technical_candidate.v2" });
const proposal = { ...scope, schemaVersion: HISTORICAL_TECHNICAL_PROPOSAL_V2,
  technicalCandidate: candidate, technicalCandidateContentDigestHex: candidate.contentDigestHex };

describe("Human displayed candidate binding independent of the outer seal", () => {
  it("accepts matching independently sealed candidate identity", () => {
    expect(() => assertHistoricalTechnicalProposalV2(seal(proposal) as HistoricalTechnicalProposalV2))
      .not.toThrow();
  });
  it("rejects a resealed outer proposal displaying a different valid candidate", () => {
    const substituted = seal({ ...scope, runId: "run-b", schemaVersion: candidate.schemaVersion });
    expect(() => assertHistoricalTechnicalProposalV2(seal({ ...proposal,
      technicalCandidate: substituted }) as unknown as HistoricalTechnicalProposalV2)).toThrow();
  });
  it("rejects missing candidate even when the outer digest is correct", () => {
    expect(() => assertHistoricalTechnicalProposalV2(seal({ ...proposal,
      technicalCandidate: null }) as unknown as HistoricalTechnicalProposalV2))
      .toThrow("TECHNICAL_CANDIDATE_BINDING");
  });
});
