import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  computeBarSetDigest,
  sealResearchDataset,
  splitBarsThreeWay,
} from "@/lib/trader/market-data/research-dataset";
import { ResearchFailureReconstructionError } from "@/lib/trader/research/errors";
import { parseResearchValidationMetricsJson } from "@/lib/trader/research/parse-research-validation-metrics";
import { buildRejectionArtifactsFromContext } from "@/lib/trader/research/reconstruct-research-failure-artifacts";
import type { ResearchFailureReconstructionContext } from "@/lib/trader/research/research-failure-reconstruction.types";
import { verifySealedResearchDatasetFromBars } from "@/lib/trader/research/verify-sealed-research-dataset";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { writeCampaignFailureVaultArtifacts } from "@/lib/trader/research/write-campaign-failure-vault";

type Org0ReconstructionFixture = {
  organizationId: string;
  candidate: ResearchFailureReconstructionContext["candidate"];
  blindResult: ResearchFailureReconstructionContext["blindResult"];
  walkForwardWindowCount: number;
  validationBacktestRun: ResearchFailureReconstructionContext["validationBacktestRun"];
  dataset: ResearchFailureReconstructionContext["dataset"];
  validationMetrics: ResearchValidationMetrics;
};

function loadOrg0ReconstructionFixture(): Org0ReconstructionFixture {
  const path = resolve(
    process.cwd(),
    "tests/fixtures/evolution/org0-reconstruction-persisted-context.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as Org0ReconstructionFixture;
}

function buildBars(count: number): Bar[] {
  const startMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const openTime = new Date(startMs + index * 60_000).toISOString();
    const closeTime = new Date(startMs + (index + 1) * 60_000 - 1).toISOString();
    const price = (100 + index * 0.01).toFixed(2);
    return {
      symbol: "BTC/USDT" as const,
      interval: "1m" as const,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: "1",
      barOpenTime: openTime,
      barCloseTime: closeTime,
    };
  });
}

describe("research failure reconstruction (SEE-A1.5)", () => {
  it("parseResearchValidationMetricsJson accepts persisted walk-forward shape", () => {
    const metrics = parseResearchValidationMetricsJson(
      JSON.stringify({
        schemaVersion: "1.0.0",
        tradeCount: 0,
        periodRealizedPnl: "0",
        periodTotalFees: "0",
        byRegime: [],
      }),
    );
    expect(metrics.byRegime).toEqual([]);
  });

  it("verifySealedResearchDatasetFromBars passes when digests match", () => {
    const bars = buildBars(100);
    const splits = splitBarsThreeWay(bars);
    const sealed = sealResearchDataset(bars, splits);
    const dataset = {
      id: "dataset-1",
      organizationId: "org-1",
      name: "test-dataset",
      symbol: "BTC/USDT" as const,
      interval: "1m" as const,
      trainBarCount: sealed.trainBarCount,
      validationBarCount: sealed.validationBarCount,
      blindBarCount: sealed.blindBarCount,
      trainDigest: sealed.trainDigest,
      validationDigest: sealed.validationDigest,
      blindDigest: sealed.blindDigest,
      sealedAt: new Date(sealed.sealedAt),
      metadataJson: "{}",
      createdAt: new Date(),
    };

    const verified = verifySealedResearchDatasetFromBars(bars, dataset);
    expect(verified.barCount).toBe(100);
    expect(computeBarSetDigest(verified.splits.validation)).toBe(dataset.validationDigest);
  });

  it("verifySealedResearchDatasetFromBars fails closed on digest mismatch", () => {
    const bars = buildBars(100);
    const splits = splitBarsThreeWay(bars);
    const sealed = sealResearchDataset(bars, splits);
    const dataset = {
      id: "dataset-1",
      organizationId: "org-1",
      name: "test-dataset",
      symbol: "BTC/USDT" as const,
      interval: "1m" as const,
      trainBarCount: sealed.trainBarCount,
      validationBarCount: sealed.validationBarCount,
      blindBarCount: sealed.blindBarCount,
      trainDigest: sealed.trainDigest,
      validationDigest: "deadbeef",
      blindDigest: sealed.blindDigest,
      sealedAt: new Date(sealed.sealedAt),
      metadataJson: "{}",
      createdAt: new Date(),
    };

    expect(() => verifySealedResearchDatasetFromBars(bars, dataset)).toThrow(
      ResearchFailureReconstructionError,
    );
  });

  it("buildRejectionArtifactsFromContext produces Org-0 rejection and evolution artifacts", () => {
    const fixture = loadOrg0ReconstructionFixture();
    const emptyMetrics: ResearchValidationMetrics = {
      schemaVersion: "1.0.0",
      tradeCount: 0,
      periodRealizedPnl: "0",
      periodTotalFees: "0",
      byRegime: [],
    };

    const context: ResearchFailureReconstructionContext = {
      candidate: {
        ...fixture.candidate,
        createdAt: new Date(fixture.candidate.createdAt),
        updatedAt: new Date(fixture.candidate.updatedAt),
      },
      blindResult: {
        ...fixture.blindResult,
        validatedAt: new Date(fixture.blindResult.validatedAt),
        createdAt: new Date(fixture.blindResult.createdAt),
      },
      walkForwardWindows: [],
      walkForwardMetrics: Array.from(
        { length: fixture.walkForwardWindowCount },
        () => emptyMetrics,
      ),
      blindMetrics: parseResearchValidationMetricsJson(fixture.blindResult.metricsJson),
      dataset: {
        ...fixture.dataset,
        sealedAt: new Date(fixture.dataset.sealedAt),
        createdAt: new Date(fixture.dataset.createdAt),
      },
      validationBacktestRun: {
        ...fixture.validationBacktestRun,
        startedAt: new Date(fixture.validationBacktestRun.startedAt!),
        completedAt: new Date(fixture.validationBacktestRun.completedAt!),
        createdAt: new Date(fixture.validationBacktestRun.createdAt),
      },
    };

    const { rejectionRecord, evolutionCycle } = buildRejectionArtifactsFromContext({
      context,
      validationMetrics: fixture.validationMetrics,
    });

    expect(rejectionRecord.recordBody.failureCode).toBe("MULTI_REGIME_COVERAGE_INSUFFICIENT");
    expect(rejectionRecord.recordBody.observedRegimes).toEqual(["CHOP", "RANGE"]);
    expect(rejectionRecord.recordBody.missingBuckets).toContain("down_regime");
    expect(evolutionCycle.envelope.sourceOutcomeKind).toBe("rejected");
    expect(evolutionCycle.cycleBody.knowledgeNeed.needType).toBe("missing_regime_context");
    expect(evolutionCycle.cycleBody.humanReview.disposition).toBe("pending");
  });

  it("writeCampaignFailureVaultArtifacts supports flat naming", () => {
    const fixture = loadOrg0ReconstructionFixture();
    const emptyMetrics: ResearchValidationMetrics = {
      schemaVersion: "1.0.0",
      tradeCount: 0,
      periodRealizedPnl: "0",
      periodTotalFees: "0",
      byRegime: [],
    };
    const context: ResearchFailureReconstructionContext = {
      candidate: {
        ...fixture.candidate,
        createdAt: new Date(fixture.candidate.createdAt),
        updatedAt: new Date(fixture.candidate.updatedAt),
      },
      blindResult: {
        ...fixture.blindResult,
        validatedAt: new Date(fixture.blindResult.validatedAt),
        createdAt: new Date(fixture.blindResult.createdAt),
      },
      walkForwardWindows: [],
      walkForwardMetrics: [emptyMetrics],
      blindMetrics: emptyMetrics,
      dataset: {
        ...fixture.dataset,
        sealedAt: new Date(fixture.dataset.sealedAt),
        createdAt: new Date(fixture.dataset.createdAt),
      },
      validationBacktestRun: {
        ...fixture.validationBacktestRun,
        startedAt: new Date(fixture.validationBacktestRun.startedAt!),
        completedAt: new Date(fixture.validationBacktestRun.completedAt!),
        createdAt: new Date(fixture.validationBacktestRun.createdAt),
      },
    };

    const { rejectionRecord, evolutionCycle } = buildRejectionArtifactsFromContext({
      context,
      validationMetrics: fixture.validationMetrics,
    });

    const vaultDir = mkdtempSync(join(tmpdir(), "see-a15-vault-"));
    try {
      const paths = writeCampaignFailureVaultArtifacts({
        vaultDir,
        naming: "flat",
        rejectionRecord,
        evolutionCycle,
      });

      expect(paths.rejectionRecordPath.endsWith("research-rejection-record.json")).toBe(true);
      expect(paths.evolutionCyclePath.endsWith("evolution-cycle-mvp.json")).toBe(true);
    } finally {
      rmSync(vaultDir, { recursive: true, force: true });
    }
  });

  it("buildRejectionArtifactsFromContext rejects when bundle coverage satisfies requirement", () => {
    const fixture = loadOrg0ReconstructionFixture();
    const qualifyingMetrics: ResearchValidationMetrics = {
      schemaVersion: "1.0.0",
      tradeCount: 3,
      periodRealizedPnl: "3",
      periodTotalFees: "0.3",
      byRegime: [
        { regimeLabel: "CHOP", tradeCount: 1, periodRealizedPnl: "1", periodTotalFees: "0.1" },
        { regimeLabel: "RANGE", tradeCount: 1, periodRealizedPnl: "1", periodTotalFees: "0.1" },
        {
          regimeLabel: "TREND_BEAR",
          tradeCount: 1,
          periodRealizedPnl: "1",
          periodTotalFees: "0.1",
        },
      ],
    };

    const context: ResearchFailureReconstructionContext = {
      candidate: {
        ...fixture.candidate,
        createdAt: new Date(fixture.candidate.createdAt),
        updatedAt: new Date(fixture.candidate.updatedAt),
      },
      blindResult: {
        ...fixture.blindResult,
        validatedAt: new Date(fixture.blindResult.validatedAt),
        createdAt: new Date(fixture.blindResult.createdAt),
      },
      walkForwardWindows: [],
      walkForwardMetrics: [qualifyingMetrics],
      blindMetrics: qualifyingMetrics,
      dataset: {
        ...fixture.dataset,
        sealedAt: new Date(fixture.dataset.sealedAt),
        createdAt: new Date(fixture.dataset.createdAt),
      },
      validationBacktestRun: {
        ...fixture.validationBacktestRun,
        startedAt: new Date(fixture.validationBacktestRun.startedAt!),
        completedAt: new Date(fixture.validationBacktestRun.completedAt!),
        createdAt: new Date(fixture.validationBacktestRun.createdAt),
      },
    };

    expect(() =>
      buildRejectionArtifactsFromContext({
        context,
        validationMetrics: qualifyingMetrics,
      }),
    ).toThrow(ResearchFailureReconstructionError);
  });
});
