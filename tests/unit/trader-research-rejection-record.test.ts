import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import { ResearchPipelineRegimeFailureError } from "@/lib/trader/research/errors";
import { assertResearchPipelineRegimeCoverage } from "@/lib/trader/research/regime-coverage";
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

describe("research rejection record (SEE-A1)", () => {
  it("builds Org-0 rejection record with CHOP/RANGE observed and down_regime missing", () => {
    const fixture = loadOrg0Fixture();
    const record = buildResearchRejectionRecord({
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

    expect(record.schemaVersion).toBe("waia.trader.research-rejection-record.v1");
    expect(record.recordBody.observedRegimes).toEqual(["CHOP", "RANGE"]);
    expect(record.recordBody.missingBuckets).toContain("down_regime");
    expect(record.recordBody.bundleRegimeCoverage.satisfiesRequirement).toBe(false);
    expect(record.envelope.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ResearchPipelineRegimeFailureError carries metrics for finalize path", () => {
    const fixture = loadOrg0Fixture();
    let coverageError: ResearchPipelineRegimeFailureError | undefined;

    try {
      assertResearchPipelineRegimeCoverage([
        fixture.validationMetrics,
        ...fixture.walkForwardMetrics,
        fixture.blindMetrics,
      ]);
    } catch (error) {
      coverageError = new ResearchPipelineRegimeFailureError(
        {
          organizationId: fixture.organizationId,
          strategyId: fixture.strategyId,
          strategyVersion: fixture.strategyVersion,
          candidateId: fixture.candidateId,
          datasetId: fixture.datasetId,
          backtestRunId: fixture.backtestRunId,
          blindValidationResultId: fixture.blindValidationResultId,
          blindConsumed: true,
          walkForwardWindowCount: fixture.walkForwardWindowCount,
          validationMetrics: fixture.validationMetrics,
          walkForwardMetrics: fixture.walkForwardMetrics,
          blindMetrics: fixture.blindMetrics,
        },
        error as import("@/lib/trader/research/errors").MultiRegimeCoverageError,
      );
    }

    expect(coverageError?.code).toBe("RESEARCH_PIPELINE_REGIME_FAILURE");
    expect(coverageError?.validationMetrics.byRegime.map((slice) => slice.regimeLabel)).toEqual([
      "CHOP",
      "RANGE",
    ]);
  });
});
