import { describe, expect, it } from "vitest";

import { runHypothesisStudio } from "@/lib/trader/discovery/hypothesis-studio";
import {
  RESEARCH_QUESTION_SCHEMA_VERSION,
  ResearchQuestionKind,
  type ResearchQuestion,
} from "@/lib/trader/discovery/research-question.types";

function makeResearchQuestion(): ResearchQuestion {
  return {
    schemaVersion: RESEARCH_QUESTION_SCHEMA_VERSION,
    campaignRef: {
      campaignId: "camp-1",
      campaignDigest: "digest-camp",
      state: "ACTIVE",
    },
    questionId: "rq-1",
    kind: ResearchQuestionKind.UnansweredMarketQuestion,
    questionText: "Why is down-regime attribution absent?",
    researchProgram: "mean_reversion_regime_gap",
    observationRefs: ["obs-1"],
    structureClusterRef: null,
    status: "open",
    contentDigest: "digest-rq",
    createdAt: "2026-07-05T00:00:00.000Z",
  };
}

describe("hypothesis studio (M8)", () => {
  it("requires research question ref on proposal", () => {
    const output = runHypothesisStudio({
      organizationId: "org-1",
      campaignId: "camp-1",
      researchQuestion: makeResearchQuestion(),
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      proposalId: "prop-1",
    });

    expect(output.researchQuestionRef).toBe("rq-1");
    expect(output.proposal.researchQuestionRef).toBe("rq-1");
    expect(
      output.proposal.mapsToMiRegisterHypothesis.definition.falsificationConditions.length,
    ).toBeGreaterThan(0);
  });
});
