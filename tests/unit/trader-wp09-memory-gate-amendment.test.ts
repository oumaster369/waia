import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertGlobalGcAvailable,
  computePostGcLiveHeapDeltaBytes,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import {
  computeDiagnosticGrowthMetrics,
  D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS,
  evaluateAmendedThresholds,
  evaluateLegacyThresholds,
  type QualificationDatasetResult,
  type QualificationRunObservation,
} from "@/lib/trader/backtest/replay-qualification-harness";

function makeObservation(
  overrides: Partial<QualificationRunObservation>,
): QualificationRunObservation {
  return {
    runLabel: "warm-1",
    isCold: false,
    runWallTimeMs: 1000,
    meanPaperCycleMs: 0.3,
    p95PaperCycleMs: 0.5,
    maxPaperCycleMs: 1,
    rssDeltaBytes: 20_000_000,
    heapUsedDeltaBytes: 50_000_000,
    retainedCycleResults: 0,
    serializedCanvasBytes: 8687,
    cycleCount: 129_581,
    barCount: 129_600,
    fullHistoryRescans: 0,
    semanticReproDigest: "sem",
    evidenceDigest: "ev",
    postGcLiveHeapDeltaBytes: 2_500_000,
    peakBufferedProjections: 32,
    ...overrides,
  };
}

function makeDataset(
  size: "N1" | "N2",
  warmOverrides: Partial<QualificationRunObservation>[] = [],
): QualificationDatasetResult {
  const barCount = size === "N2" ? 129_600 : 64_800;
  const cycleCount = barCount - 19;
  const warmRuns = [0, 1, 2, 3, 4].map((i) =>
    makeObservation({
      runLabel: `${size}-warm-${i + 1}`,
      barCount,
      cycleCount,
      ...(warmOverrides[i] ?? {}),
    }),
  );
  const coldRun = makeObservation({
    runLabel: `${size}-cold`,
    isCold: true,
    barCount,
    cycleCount,
  });
  const walls = warmRuns.map((r) => r.runWallTimeMs);
  const sortedWalls = [...walls].sort((a, b) => a - b);
  const medianWall = sortedWalls[2]!;
  const maxWall = Math.max(...walls);
  const minWall = Math.min(...walls);
  return {
    size,
    barCount,
    canvasAdvanceCount: barCount,
    integratedReplayCycleCount: cycleCount,
    barSetDigest: "digest",
    coldRun,
    warmRuns,
    aggregate: {
      medianWallMs: medianWall,
      maxWallMs: maxWall,
      runtimeRangePct: medianWall > 0 ? ((maxWall - minWall) / medianWall) * 100 : 0,
      meanPaperCycleMs: 0.3,
      p95PaperCycleMs: 0.5,
      maxPaperCycleMs: 1,
      medianRssDeltaBytes: 20_000_000,
      p95RssDeltaBytes: Math.max(...warmRuns.map((r) => r.rssDeltaBytes)),
      medianHeapDeltaBytes: 50_000_000,
      p95HeapDeltaBytes: Math.max(...warmRuns.map((r) => r.heapUsedDeltaBytes)),
      maxSerializedCanvasBytes: 8687,
      maxRetainedCycleResults: 0,
      maxFullHistoryRescans: 0,
      p95PostGcLiveHeapDeltaBytes: Math.max(
        ...warmRuns.map((r) => r.postGcLiveHeapDeltaBytes ?? 0),
      ),
      maxPeakBufferedProjections: Math.max(...warmRuns.map((r) => r.peakBufferedProjections ?? 0)),
    },
  };
}

describe("D-11B Memory Gate Amendment v1", () => {
  it("assertGlobalGcAvailable fails closed when global.gc is missing", () => {
    const original = (globalThis as { gc?: () => void }).gc;
    try {
      (globalThis as { gc?: undefined }).gc = undefined;
      expect(() => assertGlobalGcAvailable("test")).toThrow(/global\.gc unavailable/);
    } finally {
      (globalThis as { gc?: () => void }).gc = original;
    }
  });

  it("computePostGcLiveHeapDeltaBytes clamps negative deltas to zero", () => {
    expect(computePostGcLiveHeapDeltaBytes(100, 80)).toBe(0);
    expect(computePostGcLiveHeapDeltaBytes(100, 100)).toBe(0);
    expect(computePostGcLiveHeapDeltaBytes(100, 4_194_404)).toBe(4_194_304);
  });

  it("evaluateAmendedThresholds passes when all gates satisfied including post-GC boundary", () => {
    const n1 = makeDataset("N1");
    const n2 = makeDataset("N2");
    expect(evaluateAmendedThresholds(n1, n2)).toEqual([]);
  });

  it("evaluateAmendedThresholds fails at exact 4,194,305 post-GC live-heap p95 (N2)", () => {
    const n1 = makeDataset("N1");
    const n2 = makeDataset("N2", [
      {},
      {},
      {},
      {},
      {
        postGcLiveHeapDeltaBytes:
          D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxN2P95PostGcLiveHeapDeltaBytes + 1,
      },
    ]);
    const failures = evaluateAmendedThresholds(n1, n2);
    expect(failures.some((f) => f.startsWith("postGcLiveHeapDelta"))).toBe(true);
  });

  it("evaluateAmendedThresholds passes at exact 4,194,304 post-GC live-heap p95 boundary", () => {
    const n1 = makeDataset("N1");
    const n2 = makeDataset("N2", [
      {},
      {},
      {},
      {},
      {
        postGcLiveHeapDeltaBytes:
          D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxN2P95PostGcLiveHeapDeltaBytes,
      },
    ]);
    expect(evaluateAmendedThresholds(n1, n2)).toEqual([]);
  });

  it("pre-GC rssGrowth and heapGrowth are diagnostic only under Amendment v1", () => {
    const n1 = makeDataset("N1");
    const n2 = makeDataset("N2");
    n1.aggregate.p95RssDeltaBytes = 1_000_000;
    n2.aggregate.p95RssDeltaBytes = 10_000_000;
    n1.aggregate.p95HeapDeltaBytes = 1_000_000;
    n2.aggregate.p95HeapDeltaBytes = 50_000_000;

    const diagnostic = computeDiagnosticGrowthMetrics(n1, n2);
    expect(diagnostic.rssGrowthFor2xN).toBe(9_000_000);
    expect(diagnostic.heapGrowthFor2xN).toBe(49_000_000);
    expect(diagnostic.rssGrowthGateResult).toBe("DIAGNOSTIC_ONLY");
    expect(diagnostic.heapGrowthGateResult).toBe("DIAGNOSTIC_ONLY");

    const failures = evaluateAmendedThresholds(n1, n2);
    expect(failures.some((f) => f.startsWith("rssGrowth"))).toBe(false);
    expect(failures.some((f) => f.startsWith("heapGrowth"))).toBe(false);
  });

  it("evaluateLegacyThresholds still gates rssGrowth for sealed historical evidence", () => {
    const n1 = makeDataset("N1");
    const n2 = makeDataset("N2");
    n1.aggregate.p95RssDeltaBytes = 17_629_184;
    n2.aggregate.p95RssDeltaBytes = 22_937_600;
    const failures = evaluateLegacyThresholds(n1, n2);
    expect(failures).toContain("rssGrowth 5308416 > 1048576");
  });

  it("forensic annotation records replacement manifest and heap-gate accounting defect", () => {
    const annotationPath = path.join(
      process.cwd(),
      "replay-runs/RI-P7/htr-wp09-d11b-replacement-1-forensic-annotation/annotation.json",
    );
    const annotation = JSON.parse(readFileSync(annotationPath, "utf8")) as {
      schemaVersion: string;
      replacementManifestDigest: string;
      heapGateAccountingClassification: string;
      retroactivePassClaimed: boolean;
    };
    expect(annotation.schemaVersion).toBe("htr-wp09-d11b-forensic-annotation/v1");
    expect(annotation.replacementManifestDigest).toBe(
      "bff973996e69c14e923e4b84421a36f61921345f673367e76cb332da9c73c6cd",
    );
    expect(annotation.heapGateAccountingClassification).toBe("HEAP_GATE_NOT_EVALUATED");
    expect(annotation.retroactivePassClaimed).toBe(false);
  });
});
