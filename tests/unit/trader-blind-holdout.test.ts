import { describe, expect, it, vi } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import {
  BlindValidationAlreadyExistsError,
  StrategyCandidateBlindLockoutError,
} from "@/lib/trader/research/errors";
import {
  computeBlindValidationEvidenceDigest,
  runBlindHoldoutValidation,
} from "@/lib/trader/research/blind-holdout-engine";
import type {
  BlindValidationResult,
  ResearchValidationMetrics,
  StrategyCandidate,
} from "@/lib/trader/research/strategy-candidate.types";

const ORG_ID = "00000000-0000-4000-8000-00000000d001";
const CANDIDATE_ID = "00000000-0000-4000-8000-00000000d002";
const DATASET_ID = "00000000-0000-4000-8000-00000000d003";

function buildBars(count: number, close = "100"): Bar[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: new Date(Date.parse("2026-06-22T09:40:00.000Z") + index * 60_000).toISOString(),
    barCloseTime: new Date(Date.parse("2026-06-22T09:41:00.000Z") + index * 60_000).toISOString(),
  }));
}

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

function buildCandidate(overrides: Partial<StrategyCandidate> = {}): StrategyCandidate {
  return {
    id: CANDIDATE_ID,
    organizationId: ORG_ID,
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    hypothesisId: null,
    trialId: null,
    status: "walk_forward_validated",
    paramsJson: "{}",
    blindUsed: false,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
    ...overrides,
  };
}

describe("trader blind holdout (RI-P3)", () => {
  it("rejects blind holdout when candidate.blindUsed is true", async () => {
    const repository = {
      getBlindValidationResultForCandidate: vi.fn(),
      insertBlindValidationResult: vi.fn(),
      markStrategyCandidateBlindUsed: vi.fn(),
      updateStrategyCandidateStatus: vi.fn(),
    };

    await expect(
      runBlindHoldoutValidation({
        context: { organizationId: ORG_ID },
        candidate: buildCandidate({ blindUsed: true }),
        datasetId: DATASET_ID,
        blindBars: buildBars(25),
        runBacktest: vi.fn(),
        repository,
      }),
    ).rejects.toBeInstanceOf(StrategyCandidateBlindLockoutError);

    expect(repository.getBlindValidationResultForCandidate).not.toHaveBeenCalled();
  });

  it("rejects blind holdout when an immutable result already exists", async () => {
    const existing: BlindValidationResult = {
      id: "00000000-0000-4000-8000-00000000d004",
      organizationId: ORG_ID,
      candidateId: CANDIDATE_ID,
      datasetId: DATASET_ID,
      metricsJson: "{}",
      evidenceDigest: "abc",
      validatedAt: new Date("2026-06-22T10:00:00.000Z"),
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
    };

    const repository = {
      getBlindValidationResultForCandidate: vi.fn().mockResolvedValue(existing),
      insertBlindValidationResult: vi.fn(),
      markStrategyCandidateBlindUsed: vi.fn(),
      updateStrategyCandidateStatus: vi.fn(),
    };

    await expect(
      runBlindHoldoutValidation({
        context: { organizationId: ORG_ID },
        candidate: buildCandidate(),
        datasetId: DATASET_ID,
        blindBars: buildBars(25),
        runBacktest: vi.fn(),
        repository,
      }),
    ).rejects.toBeInstanceOf(BlindValidationAlreadyExistsError);

    expect(repository.insertBlindValidationResult).not.toHaveBeenCalled();
  });

  it("persists a single immutable blind result and marks blind_used", async () => {
    const blindBars = buildBars(25);
    const metrics = buildMetrics(["RANGE", "TREND_BEAR"]);
    const validatedAt = new Date("2026-06-22T12:00:00.000Z");
    const evidenceDigest = computeBlindValidationEvidenceDigest(
      metrics,
      DATASET_ID,
      CANDIDATE_ID,
      validatedAt.toISOString(),
    );

    const repository = {
      getBlindValidationResultForCandidate: vi.fn().mockResolvedValue(null),
      insertBlindValidationResult: vi.fn().mockImplementation(async (_context, row) => ({
        id: row.id,
        organizationId: ORG_ID,
        candidateId: row.candidateId,
        datasetId: row.datasetId,
        metricsJson: row.metricsJson,
        evidenceDigest: row.evidenceDigest,
        validatedAt: row.validatedAt,
        createdAt: validatedAt,
      })),
      markStrategyCandidateBlindUsed: vi
        .fn()
        .mockResolvedValue(buildCandidate({ blindUsed: true, status: "walk_forward_validated" })),
      updateStrategyCandidateStatus: vi
        .fn()
        .mockResolvedValue(buildCandidate({ blindUsed: true, status: "blind_validated" })),
    };

    const runBacktest = vi.fn().mockResolvedValue(metrics);

    const outcome = await runBlindHoldoutValidation({
      context: { organizationId: ORG_ID },
      candidate: buildCandidate(),
      datasetId: DATASET_ID,
      blindBars,
      expectedBlindDigest: computeBarSetDigest(blindBars),
      runBacktest,
      repository,
      validatedAt,
      newId: () => "00000000-0000-4000-8000-00000000d005",
    });

    expect(runBacktest).toHaveBeenCalledWith({
      bars: blindBars,
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      paramsJson: "{}",
    });
    expect(repository.insertBlindValidationResult).toHaveBeenCalledWith(
      { organizationId: ORG_ID },
      expect.objectContaining({
        id: "00000000-0000-4000-8000-00000000d005",
        candidateId: CANDIDATE_ID,
        datasetId: DATASET_ID,
        evidenceDigest,
      }),
    );
    expect(repository.markStrategyCandidateBlindUsed).toHaveBeenCalledWith(
      { organizationId: ORG_ID },
      CANDIDATE_ID,
    );
    expect(repository.updateStrategyCandidateStatus).toHaveBeenCalledWith(
      { organizationId: ORG_ID },
      CANDIDATE_ID,
      "blind_validated",
    );
    expect(outcome.result.evidenceDigest).toBe(evidenceDigest);
    expect(outcome.metrics).toEqual(metrics);
  });
});
