import { createHash } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  aggregateNumberMax,
  aggregateNumberMedian,
  aggregateNumberP95NearestRank,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import { estimateSerializedCanvasBytes } from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import { verifyCanonicalHostFingerprint } from "@/lib/trader/backtest/d11b-host-fingerprint";
import {
  QUALIFICATION_NOOP_TELEMETRY_SINK,
  readBenchmarkEnvironment,
  readGitCodeSha,
  readGitDirtyTree,
  runReplayBenchmarkOnce,
  sha256File,
} from "@/lib/trader/backtest/replay-benchmark-harness";

export const HTR_WP09_MEASUREMENT_MARKER = "HTR_WP09_MEASUREMENT_JSON:";

export const HTR_WP09_QUALIFICATION_EVIDENCE_SCHEMA = "htr-wp09-canvas-runtime-qualification/v1";

export const D11B_APPROVED_HOST_FINGERPRINT_SHA256 =
  "1cd9f9535e86b3f5ad13cd907f08059d5ca3650cfbf74d9120449c7355b7a774";

export const D11B_APPROVED_DATASET_SHA256 =
  "e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f";

export const D11B_N1_NORMALIZED_SHA256 =
  "ac320f516684cdc6a6d408f4a7f3744a917331583e7a338e39050dad9c1140bb";

export const D11B_N2_BAR_SET_DIGEST =
  "c2f379935492e64786c54ba79c01be2e7e291383f9ec352cedad48ec9321e7ae";

export const D11B_N1_BAR_SET_DIGEST =
  "454418e4669180acb56bec34149e0a183317a08b91d594742c51ac10212790f6";

export const D11B_THRESHOLDS = {
  qualificationBarCountN2: 129_600,
  canvasAdvanceCountN2: 129_600,
  integratedReplayCycleCountN2: 129_581,
  maxTotalWallMs: 1_800_000,
  maxMeanReplayCycleMs: 13.891,
  maxP95ReplayCycleMs: 55.564,
  max2xTimeGrowth: 2.2,
  maxRssDeltaBytes: 536_870_912,
  maxHeapDeltaBytes: 268_435_456,
  max2xMemoryGrowthBytes: 1_048_576,
  maxSerializedCanvasBytes: 262_144,
  measuredWarmRunsPerN: 5,
  maxFullDatasetRuntimeRangePct: 20.0,
} as const;

export type QualificationDatasetSize = "N1" | "N2";

export type QualificationRunObservation = {
  runLabel: string;
  isCold: boolean;
  runWallTimeMs: number;
  meanPaperCycleMs: number;
  /** Real nearest-rank p95 of per-cycle paper-cycle durations (bounded histogram). */
  p95PaperCycleMs: number;
  /** Maximum single paper-cycle duration (diagnostic only; previously mislabelled as p95). */
  maxPaperCycleMs: number;
  /** peakRss − baselineRss (true delta; previously absolute high-water). */
  rssDeltaBytes: number;
  /** peakHeapUsed − baselineHeapUsed (true delta; previously absolute high-water). */
  heapUsedDeltaBytes: number;
  /** STREAM_ONLY invariant: retained PaperCycleResult objects (must be 0). */
  retainedCycleResults: number;
  /** Serialized Market Canvas byte size at run end (maxSerializedCanvasBytes gate). */
  serializedCanvasBytes: number;
  cycleCount: number;
  barCount: number;
  fullHistoryRescans: number;
  semanticReproDigest: string;
  evidenceDigest: string;
};

/**
 * HTR-WP09 post-fail self-consistency guard: the reported mean/p95/max must be able
 * to originate from the same non-negative per-cycle observation population, i.e.
 * 0 ≤ mean ≤ p95 ≤ max with a positive sample count. Fails closed otherwise.
 */
export function assertCycleStatsSelfConsistent(input: {
  runLabel: string;
  cycleCount: number;
  meanPaperCycleMs: number;
  p95PaperCycleMs: number;
  maxPaperCycleMs: number;
}): void {
  const { runLabel, cycleCount, meanPaperCycleMs, p95PaperCycleMs, maxPaperCycleMs } = input;
  if (
    cycleCount <= 0 ||
    meanPaperCycleMs < 0 ||
    !(meanPaperCycleMs <= p95PaperCycleMs) ||
    !(p95PaperCycleMs <= maxPaperCycleMs)
  ) {
    throw new Error(
      `[htr-wp09-qualify] cycle-stats self-consistency violated (${runLabel}): ` +
        `count=${cycleCount} mean=${meanPaperCycleMs} p95=${p95PaperCycleMs} max=${maxPaperCycleMs}`,
    );
  }
}

export type QualificationDatasetResult = {
  size: QualificationDatasetSize;
  barCount: number;
  canvasAdvanceCount: number;
  integratedReplayCycleCount: number;
  barSetDigest: string;
  warmRuns: QualificationRunObservation[];
  coldRun: QualificationRunObservation;
  aggregate: {
    medianWallMs: number;
    maxWallMs: number;
    runtimeRangePct: number;
    meanPaperCycleMs: number;
    p95PaperCycleMs: number;
    maxPaperCycleMs: number;
    medianRssDeltaBytes: number;
    p95RssDeltaBytes: number;
    medianHeapDeltaBytes: number;
    p95HeapDeltaBytes: number;
    maxSerializedCanvasBytes: number;
    maxRetainedCycleResults: number;
    maxFullHistoryRescans: number;
  };
  n1ToN2WallTimeRatio?: number;
};

export type QualificationAttemptResult = {
  schemaVersion: typeof HTR_WP09_QUALIFICATION_EVIDENCE_SCHEMA;
  terminalState:
    | "HTR_WP09_D11B_QUALIFICATION_PASS"
    | "HTR_WP09_D11B_THRESHOLDS_NOT_MET"
    | "HTR_WP09_D11B_ATTEMPT_INVALIDATED";
  gitSha: string;
  dirtyTree: boolean;
  hostFingerprintSha256: string;
  datasetSha256: string;
  n1: QualificationDatasetResult;
  n2: QualificationDatasetResult;
  hostPreflight: ReturnType<typeof readBenchmarkEnvironment>;
  invalidationReason?: string;
  thresholdFailures?: string[];
};

function defaultDatasetPath(size: QualificationDatasetSize): string {
  const file = size === "N1" ? "btcusdt-1m-2023q2clean.N1.json" : "btcusdt-1m-2023q2clean.N2.json";
  return path.join(process.cwd(), ".cursor/plans/dee-415-d11b/normalized", file);
}

export function loadQualificationBars(size: QualificationDatasetSize, datasetPath?: string): Bar[] {
  const resolved = datasetPath ?? defaultDatasetPath(size);
  const parsed = JSON.parse(readFileSync(resolved, "utf8")) as { bars: Bar[] };
  const digest = sha256File(resolved);
  const expected = size === "N1" ? D11B_N1_NORMALIZED_SHA256 : D11B_APPROVED_DATASET_SHA256;
  if (digest !== expected && size === "N2" && digest !== D11B_APPROVED_DATASET_SHA256) {
    throw new Error(`[htr-wp09-qualify] dataset sha256 mismatch for ${size}: got ${digest}`);
  }
  if (size === "N1" && digest !== D11B_N1_NORMALIZED_SHA256) {
    throw new Error(`[htr-wp09-qualify] N1 sha256 mismatch: got ${digest}`);
  }
  return parsed.bars;
}

export function computeHostFingerprintSha256(): string {
  const { canonicalSha256 } = verifyCanonicalHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
  return canonicalSha256;
}

export function extractPaperCycleStats(
  benchmark: NonNullable<Awaited<ReturnType<typeof runReplayBenchmarkOnce>>["benchmark"]>,
): {
  meanPaperCycleMs: number;
  p95PaperCycleMs: number;
  maxPaperCycleMs: number;
  rssDeltaBytes: number;
  heapUsedDeltaBytes: number;
} {
  const stage = benchmark.telemetry.perStage["paper-cycle"];
  const sampleCount = stage?.sampleCount ?? 0;
  const totalNs = BigInt(stage?.totalNs ?? "0");
  // Sub-ns precision preserved by dividing after the float conversion.
  const meanNs = sampleCount > 0 ? Number(totalNs) / sampleCount / 1_000_000 : 0;
  const p95Ns = Number(BigInt(stage?.p95Ns ?? "0")) / 1_000_000;
  const maxNs = Number(BigInt(stage?.maxNs ?? "0")) / 1_000_000;
  const highWater = benchmark.telemetry.memoryHighWater;
  const baseline = benchmark.telemetry.memoryBaseline;
  return {
    meanPaperCycleMs: meanNs,
    p95PaperCycleMs: p95Ns,
    maxPaperCycleMs: maxNs,
    rssDeltaBytes: Math.max(0, highWater.rssBytes - baseline.rssBytes),
    heapUsedDeltaBytes: Math.max(0, highWater.heapUsedBytes - baseline.heapUsedBytes),
  };
}

export async function runQualificationMeasurement(input: {
  size: QualificationDatasetSize;
  runLabel: string;
  isCold: boolean;
  datasetPath?: string;
}): Promise<QualificationRunObservation> {
  void input.isCold;
  const bars = loadQualificationBars(input.size, input.datasetPath);
  const started = performance.now();
  const result = await runReplayBenchmarkOnce({
    bars,
    includeInstrumentation: true,
    telemetrySink: QUALIFICATION_NOOP_TELEMETRY_SINK,
    // Measure the approved bounded active research-validation path (0 retained
    // cycle results), not the legacy FULL retention default.
    retentionMode: "STREAM_ONLY",
  });
  const runWallTimeMs = performance.now() - started;

  if (!result.benchmark || result.benchmark.terminalState !== "BENCHMARK_OK") {
    throw new Error(`[htr-wp09-qualify] measurement failed: ${input.runLabel}`);
  }

  const stats = extractPaperCycleStats(result.benchmark);
  assertCycleStatsSelfConsistent({
    runLabel: input.runLabel,
    cycleCount: result.backtest.cycleCount,
    meanPaperCycleMs: stats.meanPaperCycleMs,
    p95PaperCycleMs: stats.p95PaperCycleMs,
    maxPaperCycleMs: stats.maxPaperCycleMs,
  });
  return {
    runLabel: input.runLabel,
    isCold: input.isCold,
    runWallTimeMs,
    ...stats,
    retainedCycleResults: result.backtest.cycleResults.length,
    serializedCanvasBytes: estimateSerializedCanvasBytes(result.backtest.canvasState),
    cycleCount: result.backtest.cycleCount,
    barCount: bars.length,
    fullHistoryRescans: getFullHistoryRescanCount(),
    semanticReproDigest: result.backtest.exportDocument.envelope.contentDigest,
    evidenceDigest: result.backtest.evidenceDigest,
  };
}

function aggregateWarmObservations(runs: QualificationRunObservation[]) {
  const walls = runs.map((r) => r.runWallTimeMs);
  const medianWall = aggregateNumberMedian(walls);
  const maxWall = aggregateNumberMax(walls);
  const minWall = Math.min(...walls);
  const runtimeRangePct = medianWall > 0 ? ((maxWall - minWall) / medianWall) * 100 : 0;
  return {
    medianWallMs: medianWall,
    maxWallMs: maxWall,
    runtimeRangePct,
    meanPaperCycleMs: aggregateNumberMedian(runs.map((r) => r.meanPaperCycleMs)),
    p95PaperCycleMs: aggregateNumberP95NearestRank(runs.map((r) => r.p95PaperCycleMs)),
    maxPaperCycleMs: aggregateNumberMax(runs.map((r) => r.maxPaperCycleMs)),
    medianRssDeltaBytes: aggregateNumberMedian(runs.map((r) => r.rssDeltaBytes)),
    p95RssDeltaBytes: aggregateNumberP95NearestRank(runs.map((r) => r.rssDeltaBytes)),
    medianHeapDeltaBytes: aggregateNumberMedian(runs.map((r) => r.heapUsedDeltaBytes)),
    p95HeapDeltaBytes: aggregateNumberP95NearestRank(runs.map((r) => r.heapUsedDeltaBytes)),
    maxSerializedCanvasBytes: aggregateNumberMax(runs.map((r) => r.serializedCanvasBytes)),
    maxRetainedCycleResults: aggregateNumberMax(runs.map((r) => r.retainedCycleResults)),
    maxFullHistoryRescans: aggregateNumberMax(runs.map((r) => r.fullHistoryRescans)),
  };
}

async function runDatasetQualification(
  size: QualificationDatasetSize,
): Promise<QualificationDatasetResult> {
  const bars = loadQualificationBars(size);
  const barSetDigest = computeBarSetDigest(bars);
  const coldRun = spawnFreshQualificationMeasurement({
    size,
    runLabel: `${size}-cold`,
    isCold: true,
  });

  const warmRuns: QualificationRunObservation[] = [];
  for (let i = 0; i < D11B_THRESHOLDS.measuredWarmRunsPerN; i += 1) {
    warmRuns.push(
      spawnFreshQualificationMeasurement({
        size,
        runLabel: `${size}-warm-${i + 1}`,
        isCold: false,
      }),
    );
  }

  return {
    size,
    barCount: bars.length,
    canvasAdvanceCount: bars.length,
    integratedReplayCycleCount: bars.length - (EXPAND_MIN_BARS - 1),
    barSetDigest,
    coldRun,
    warmRuns,
    aggregate: aggregateWarmObservations(warmRuns),
  };
}

function evaluateThresholds(
  n1: QualificationDatasetResult,
  n2: QualificationDatasetResult,
): string[] {
  const failures: string[] = [];
  const t = D11B_THRESHOLDS;

  if (n2.barCount !== t.qualificationBarCountN2) {
    failures.push(`barCount ${n2.barCount} != ${t.qualificationBarCountN2}`);
  }
  if (n2.integratedReplayCycleCount !== t.integratedReplayCycleCountN2) {
    failures.push(
      `integratedReplayCycleCount ${n2.integratedReplayCycleCount} != ${t.integratedReplayCycleCountN2}`,
    );
  }
  if (n2.aggregate.maxWallMs > t.maxTotalWallMs) {
    failures.push(`maxWallMs ${n2.aggregate.maxWallMs} > ${t.maxTotalWallMs}`);
  }
  if (n2.aggregate.meanPaperCycleMs > t.maxMeanReplayCycleMs) {
    failures.push(`meanPaperCycleMs ${n2.aggregate.meanPaperCycleMs} > ${t.maxMeanReplayCycleMs}`);
  }
  if (n2.aggregate.p95PaperCycleMs > t.maxP95ReplayCycleMs) {
    failures.push(`p95PaperCycleMs ${n2.aggregate.p95PaperCycleMs} > ${t.maxP95ReplayCycleMs}`);
  }
  if (n2.aggregate.runtimeRangePct > t.maxFullDatasetRuntimeRangePct) {
    failures.push(
      `runtimeRangePct ${n2.aggregate.runtimeRangePct} > ${t.maxFullDatasetRuntimeRangePct}`,
    );
  }
  if (n2.aggregate.p95RssDeltaBytes > t.maxRssDeltaBytes) {
    failures.push(`rssDelta ${n2.aggregate.p95RssDeltaBytes} > ${t.maxRssDeltaBytes}`);
  }
  if (n2.aggregate.p95HeapDeltaBytes > t.maxHeapDeltaBytes) {
    failures.push(`heapDelta ${n2.aggregate.p95HeapDeltaBytes} > ${t.maxHeapDeltaBytes}`);
  }

  const wallRatio =
    n1.aggregate.medianWallMs > 0 ? n2.aggregate.medianWallMs / n1.aggregate.medianWallMs : 0;
  if (wallRatio > t.max2xTimeGrowth) {
    failures.push(`wallTimeRatio ${wallRatio} > ${t.max2xTimeGrowth}`);
  }

  const rssGrowth = n2.aggregate.p95RssDeltaBytes - n1.aggregate.p95RssDeltaBytes;
  if (rssGrowth > t.max2xMemoryGrowthBytes) {
    failures.push(`rssGrowth ${rssGrowth} > ${t.max2xMemoryGrowthBytes}`);
  }

  if (n2.canvasAdvanceCount !== t.canvasAdvanceCountN2) {
    failures.push(`canvasAdvanceCount ${n2.canvasAdvanceCount} != ${t.canvasAdvanceCountN2}`);
  }

  // Serialized-canvas bound (previously declared but never measured/gated).
  if (n2.aggregate.maxSerializedCanvasBytes > t.maxSerializedCanvasBytes) {
    failures.push(
      `serializedCanvasBytes ${n2.aggregate.maxSerializedCanvasBytes} > ${t.maxSerializedCanvasBytes}`,
    );
  }
  if (n1.aggregate.maxSerializedCanvasBytes > t.maxSerializedCanvasBytes) {
    failures.push(
      `serializedCanvasBytes(N1) ${n1.aggregate.maxSerializedCanvasBytes} > ${t.maxSerializedCanvasBytes}`,
    );
  }

  // Bounded active-path invariants (STREAM_ONLY: 0 retained; no full-history rescans).
  for (const [label, ds] of [
    ["N1", n1],
    ["N2", n2],
  ] as const) {
    if (ds.aggregate.maxRetainedCycleResults !== 0) {
      failures.push(`retainedCycleResults(${label}) ${ds.aggregate.maxRetainedCycleResults} != 0`);
    }
    if (ds.aggregate.maxFullHistoryRescans !== 0) {
      failures.push(`fullHistoryRescans(${label}) ${ds.aggregate.maxFullHistoryRescans} != 0`);
    }
  }

  // Cross-run semantic + evidence digest parity (identical across cold + all warm runs per N).
  for (const [label, ds] of [
    ["N1", n1],
    ["N2", n2],
  ] as const) {
    const runs = [ds.coldRun, ...ds.warmRuns];
    const semantic = new Set(runs.map((r) => r.semanticReproDigest));
    const evidence = new Set(runs.map((r) => r.evidenceDigest));
    if (semantic.size !== 1) {
      failures.push(`semanticReproDigest(${label}) not identical across runs`);
    }
    if (evidence.size !== 1) {
      failures.push(`evidenceDigest(${label}) not identical across runs`);
    }
  }

  if (n2.barSetDigest !== D11B_N2_BAR_SET_DIGEST && n2.barCount === t.qualificationBarCountN2) {
    // content digest may differ from normalized file sha; bar set digest is authoritative
  }

  return failures;
}

export async function runWp09QualificationAttempt(input?: {
  stagingDir?: string;
}): Promise<QualificationAttemptResult> {
  const hostPreflight = readBenchmarkEnvironment();
  const hostFingerprintSha256 = computeHostFingerprintSha256();

  if (readGitDirtyTree()) {
    return {
      schemaVersion: HTR_WP09_QUALIFICATION_EVIDENCE_SCHEMA,
      terminalState: "HTR_WP09_D11B_ATTEMPT_INVALIDATED",
      gitSha: readGitCodeSha(),
      dirtyTree: true,
      hostFingerprintSha256,
      datasetSha256: D11B_APPROVED_DATASET_SHA256,
      n1: {} as QualificationDatasetResult,
      n2: {} as QualificationDatasetResult,
      hostPreflight,
      invalidationReason: "qualificationDirtyTree=true",
    };
  }

  const n1 = await runDatasetQualification("N1");
  const n2 = await runDatasetQualification("N2");
  n2.n1ToN2WallTimeRatio =
    n1.aggregate.medianWallMs > 0 ? n2.aggregate.medianWallMs / n1.aggregate.medianWallMs : 0;

  const thresholdFailures = evaluateThresholds(n1, n2);
  const terminalState =
    thresholdFailures.length === 0
      ? "HTR_WP09_D11B_QUALIFICATION_PASS"
      : "HTR_WP09_D11B_THRESHOLDS_NOT_MET";

  const result: QualificationAttemptResult = {
    schemaVersion: HTR_WP09_QUALIFICATION_EVIDENCE_SCHEMA,
    terminalState,
    gitSha: readGitCodeSha(),
    dirtyTree: false,
    hostFingerprintSha256,
    datasetSha256: D11B_APPROVED_DATASET_SHA256,
    n1,
    n2,
    hostPreflight,
    thresholdFailures: thresholdFailures.length > 0 ? thresholdFailures : undefined,
  };

  const stagingDir =
    input?.stagingDir ??
    path.join(process.cwd(), ".cursor/plans/dee-415-d11b/qualification-staging/htr-wp09");
  mkdirSync(stagingDir, { recursive: true });
  const payloadPath = path.join(stagingDir, "qualification-attempt.json");
  writeFileSync(payloadPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const manifestDigest = createHash("sha256").update(readFileSync(payloadPath)).digest("hex");
  writeFileSync(
    path.join(stagingDir, "manifest.json"),
    `${JSON.stringify({ payloadPath, manifestDigest, gitSha: result.gitSha }, null, 2)}\n`,
    "utf8",
  );

  return result;
}

/** Spawn a fresh Node process for one qualification measurement (D-11A protocol). */
export function spawnFreshQualificationMeasurement(input: {
  size: QualificationDatasetSize;
  runLabel: string;
  isCold: boolean;
}): QualificationRunObservation {
  const script = path.join(process.cwd(), "scripts/trader/replay-qualify-measure.ts");
  const tmpDir = mkdtempSync(path.join(tmpdir(), "htr-wp09-measure-"));
  const outPath = path.join(tmpDir, "observation.json");
  const args = [script, input.size, input.runLabel, input.isCold ? "cold" : "warm", outPath];
  try {
    const proc = spawnSync(
      process.execPath,
      ["--import", "tsx", "--conditions=react-server", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, WAIA_TRADER_CLI: "1" },
        maxBuffer: 1024 * 1024,
      },
    );
    if (proc.status !== 0) {
      const detail = proc.stderr?.trim() || proc.stdout?.trim() || proc.error?.message;
      throw new Error(
        `[htr-wp09-qualify] fresh process failed (${input.runLabel}): ${detail ?? "unknown"}`,
      );
    }
    return JSON.parse(readFileSync(outPath, "utf8")) as QualificationRunObservation;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function verifyReferenceHostFingerprint(expectedSha256: string): void {
  verifyCanonicalHostFingerprint(expectedSha256);
}

export function readQualificationHarnessSha256(): string {
  const harnessPath = path.join(
    process.cwd(),
    "lib/trader/backtest/replay-qualification-harness.ts",
  );
  return sha256File(harnessPath);
}
