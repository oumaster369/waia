import { describe, expect, it } from "vitest";

import { buildResearchEvidenceDocument } from "@/lib/trader/research/build-research-evidence-export";
import { MultiRegimeCoverageError } from "@/lib/trader/research/errors";
import {
  assertResearchPipelineRegimeCoverage,
  collectRegimeLabelsFromMetrics,
} from "@/lib/trader/research/regime-coverage";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

const ORG_ID = "00000000-0000-4000-8000-00000000e001";

function buildMetrics(regimeLabels: string[]): ResearchValidationMetrics {
  return {
    schemaVersion: "1.0.0",
    tradeCount: regimeLabels.length,
    periodRealizedPnl: "1.0",
    periodTotalFees: "0.1",
    byRegime: regimeLabels.map((regimeLabel) => ({
      regimeLabel,
      tradeCount: 1,
      periodRealizedPnl: "1.0",
      periodTotalFees: "0.1",
    })),
  };
}

const EMPTY_METRICS: ResearchValidationMetrics = {
  schemaVersion: "1.0.0",
  tradeCount: 0,
  periodRealizedPnl: "0",
  periodTotalFees: "0",
  byRegime: [],
};

describe("research pipeline regime coverage (DEE-369)", () => {
  it("assertResearchPipelineRegimeCoverage unions validation, walk-forward, and blind metrics", () => {
    expect(() =>
      assertResearchPipelineRegimeCoverage([
        buildMetrics(["RANGE"]),
        EMPTY_METRICS,
        buildMetrics(["TREND_BEAR"]),
      ]),
    ).not.toThrow();
  });

  it("assertResearchPipelineRegimeCoverage rejects when combined metrics lack required regimes", () => {
    expect(() =>
      assertResearchPipelineRegimeCoverage([
        buildMetrics(["RANGE"]),
        EMPTY_METRICS,
        buildMetrics(["TREND_BULL"]),
      ]),
    ).toThrow(MultiRegimeCoverageError);
  });

  it("validation-only union fails when down-regime attribution is missing", () => {
    expect(() =>
      assertResearchPipelineRegimeCoverage([buildMetrics(["RANGE"]), EMPTY_METRICS]),
    ).toThrow(MultiRegimeCoverageError);
  });

  it("collectRegimeLabelsFromMetrics returns none for all-empty walk-forward windows", () => {
    expect(
      collectRegimeLabelsFromMetrics(Array.from({ length: 1296 }, () => EMPTY_METRICS)),
    ).toEqual([]);
  });

  it("buildResearchEvidenceDocument includes validation metrics in regimeCoverage", () => {
    const document = buildResearchEvidenceDocument({
      organizationId: ORG_ID,
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      datasetId: "00000000-0000-4000-8000-00000000e010",
      backtestRunId: "00000000-0000-4000-8000-00000000e011",
      strategyCandidateId: "00000000-0000-4000-8000-00000000e012",
      blindValidationResultId: "00000000-0000-4000-8000-00000000e013",
      costModelVersion: "waia.trader.cost-model.v1",
      validationMetrics: buildMetrics(["RANGE"]),
      walkForwardMetrics: [EMPTY_METRICS],
      blindMetrics: buildMetrics(["TREND_BEAR"]),
    });

    expect(document.evidenceBody.regimeCoverage).toMatchObject({
      regimes: ["RANGE", "TREND_BEAR"],
      satisfiesRequirement: true,
    });
  });
});
