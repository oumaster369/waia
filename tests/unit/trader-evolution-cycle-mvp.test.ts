import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

type Org0Fixture = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  datasetId: string;
  backtestRunId: string;
  blindValidationResultId: string;
  failureMessage: string;
  blindConsumed: boolean;
  walkForwardWindowCount: number;
  validationMetrics: ResearchValidationMetrics;
  walkForwardMetrics: ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
};

function loadOrg0Fixture(): Org0Fixture {
  const path = resolve(
    process.cwd(),
    "tests/fixtures/evolution/org0-mean-reversion-rejection.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as Org0Fixture;
}

describe("evolution cycle MVP (SEE-A2)", () => {
  it("transforms Org-0 rejection into RQ, knowledge need, and hypothesis proposal", () => {
    const fixture = loadOrg0Fixture();
    const rejectionRecord = buildResearchRejectionRecord({
      organizationId: fixture.organizationId,
      strategyId: fixture.strategyId,
      strategyVersion: fixture.strategyVersion,
      candidateId: fixture.candidateId,
      datasetId: fixture.datasetId,
      backtestRunId: fixture.backtestRunId,
      blindValidationResultId: fixture.blindValidationResultId,
      failureCode: "MULTI_REGIME_COVERAGE_INSUFFICIENT",
      failureMessage: fixture.failureMessage,
      blindConsumed: fixture.blindConsumed,
      walkForwardWindowCount: fixture.walkForwardWindowCount,
      validationMetrics: fixture.validationMetrics,
      walkForwardMetrics: fixture.walkForwardMetrics,
      blindMetrics: fixture.blindMetrics,
    });

    const cycle = buildEvolutionCycleMvp({ rejectionRecord });

    expect(cycle.schemaVersion).toBe("waia.trader.evolution-cycle-mvp.v1");
    expect(cycle.envelope.sourceOutcomeKind).toBe("rejected");
    expect(cycle.envelope.sourceRejectionDigest).toBe(rejectionRecord.envelope.contentDigest);
    expect(cycle.cycleBody.observation.observedRegimes).toEqual(["CHOP", "RANGE"]);
    expect(cycle.cycleBody.researchQuestion.researchProgram).toBe(
      "mean_reversion_research_program",
    );
    expect(cycle.cycleBody.researchQuestion.questionText).toContain("mean_reversion_v0@0.1.0");
    expect(cycle.cycleBody.knowledgeNeed.needType).toBe("missing_regime_context");
    expect(cycle.cycleBody.knowledgeNeed.evidenceRefs).toContain(
      rejectionRecord.envelope.contentDigest,
    );
    expect(cycle.cycleBody.hypothesisProposal.falsificationConditions.length).toBeGreaterThan(0);
    expect(cycle.cycleBody.hypothesisProposal.mapsToMiRegisterHypothesis.hypothesisKind).toBe(
      "market_claim",
    );
    expect(cycle.cycleBody.humanReview.disposition).toBe("pending");
    expect(cycle.envelope.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
