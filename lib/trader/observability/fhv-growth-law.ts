import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import type { FhvFullHistoricalProgressV1 } from "@/lib/trader/observability/fhv-full-historical-progress";

/**
 * FHV growth law (WP-4).
 *
 * PR452 run 31011816726 showed end-to-end throughput decaying from ~1667 to ~400 cps while the
 * session database grew linearly. Two independent factors compose to the observed 1.562x
 * over-prediction of the probe: checkpoint overhead (1.2767x) and hot-path throughput below the
 * probe measurement (1.2232x). This module fits both from a progress time series so a projection
 * accounts for cost that grows with run length instead of assuming a constant cost per bar.
 */

export const FHV_GROWTH_LAW_SCHEMA = "fhv-growth-law-report/v2" as const;
export const FHV_GROWTH_LAW_REPORT_FILENAME = "fhv-growth-law-report.v2.json";
export const FHV_GROWTH_LAW_LEGACY_V1_FILENAME = "fhv-growth-law-report.v1.json";

/** Human-approved pre-launch safety headroom (plan section A-3). */
export const FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S = 6480;

/** Canonical terminal acceptance. Never relaxed. */
export const FHV_CANONICAL_MAX_RUNTIME_S = 7200;

export type FhvLinearFit = Readonly<{
  slope: number;
  intercept: number;
  rSquared: number;
  sampleCount: number;
}>;

export type FhvThroughputWindow = Readonly<{
  fromGlobalEventSequence: number;
  toGlobalEventSequence: number;
  elapsedSeconds: number;
  barsPerSecond: number;
  checkpointExcludedBarsPerSecond: number | null;
}>;

export const FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION =
  "fhv-hot-path-stability-assessor/v1" as const;
/** Minimum windows so a single first/last pair cannot decide sustained decay. */
export const FHV_HOT_PATH_STABILITY_MIN_WINDOWS = 4;
/** 10% mirrors the stability gate's decay cap. Unchanged. */
export const FHV_HOT_PATH_STABILITY_DECAY_RATIO_CAP = 0.1;

export type FhvHotPathStabilityAssessment = Readonly<{
  assessorVersion: typeof FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION;
  firstHotCps: number | null;
  lastHotCps: number | null;
  firstHalfMedianCps: number | null;
  lastHalfMedianCps: number | null;
  decayRatio: number | null;
  windowCount: number;
  minWindowsRequired: typeof FHV_HOT_PATH_STABILITY_MIN_WINDOWS;
  verdict: "DECAYING" | "FLAT" | "INSUFFICIENT_SAMPLES";
}>;

export type FhvHotspot = Readonly<{
  stage: string;
  totalMs: number;
  sampleCount: number;
  shareOfMeasuredMs: number;
}>;

export type FhvGrowthAwareProjection = Readonly<{
  totalBars: number;
  checkpointEveryCycles: number;
  hotPathSeconds: number;
  checkpointSeconds: number;
  projectedRuntimeSeconds: number;
  projectedRuntimeSecondsLowerBound: number;
  projectedRuntimeSecondsUpperBound: number;
  finalSessionDatabaseBytes: number;
  withinCanonicalLimit: boolean;
  withinPreLaunchHeadroom: boolean;
}>;

export function fitFhvLinearPoints(points: readonly (readonly [number, number])[]): FhvLinearFit {
  return linearFit(points);
}

function linearFit(points: readonly (readonly [number, number])[]): FhvLinearFit {
  const n = points.length;
  if (n < 2) {
    return { slope: 0, intercept: points[0]?.[1] ?? 0, rSquared: 0, sampleCount: n };
  }
  const meanX = points.reduce((acc, [x]) => acc + x, 0) / n;
  const meanY = points.reduce((acc, [, y]) => acc + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) ** 2;
    syy += (y - meanY) ** 2;
  }
  if (sxx === 0) {
    return { slope: 0, intercept: meanY, rSquared: 0, sampleCount: n };
  }
  const slope = sxy / sxx;
  return {
    slope,
    intercept: meanY - slope * meanX,
    rSquared: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy),
    sampleCount: n,
  };
}

/** Session database bytes as a function of cycles processed. */
export function fitFhvSessionGrowthLaw(
  series: readonly FhvFullHistoricalProgressV1[],
): FhvLinearFit {
  return linearFit(
    series
      .filter((entry) => entry.sqliteDatabaseBytes != null)
      .map((entry) => [entry.globalEventSequence, entry.sqliteDatabaseBytes as number] as const),
  );
}

/** Checkpoint duration as a function of the session database size it copies. */
export function fitFhvCheckpointDurationVsSize(
  series: readonly FhvFullHistoricalProgressV1[],
): FhvLinearFit {
  const gigabyte = 1_073_741_824;
  return linearFit(
    series
      .filter(
        (entry) => entry.lastCheckpointBytes != null && entry.lastCheckpointDurationMs != null,
      )
      .map(
        (entry) =>
          [
            (entry.lastCheckpointBytes as number) / gigabyte,
            entry.lastCheckpointDurationMs as number,
          ] as const,
      ),
  );
}

/** Per-window throughput, with and without checkpoint time. */
export function computeFhvThroughputWindows(
  series: readonly FhvFullHistoricalProgressV1[],
): FhvThroughputWindow[] {
  const windows: FhvThroughputWindow[] = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1]!;
    const current = series[index]!;
    const elapsedSeconds = current.elapsedSeconds - previous.elapsedSeconds;
    const deltaSeq = current.globalEventSequence - previous.globalEventSequence;
    if (elapsedSeconds <= 0 || deltaSeq <= 0) {
      continue;
    }
    windows.push({
      fromGlobalEventSequence: previous.globalEventSequence,
      toGlobalEventSequence: current.globalEventSequence,
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      barsPerSecond: Number((deltaSeq / elapsedSeconds).toFixed(3)),
      checkpointExcludedBarsPerSecond: current.windowCheckpointExcludedBarsPerSecond,
    });
  }
  return windows;
}

/**
 * Does checkpoint-excluded throughput decline across the run?
 *
 * First-vs-last pair is retained as a diagnostic, not the verdict. Sustained decay is decided
 * from equal-sized first/last half medians so a single noisy endpoint cannot fail a stationary
 * series. Fewer than {@link FHV_HOT_PATH_STABILITY_MIN_WINDOWS} windows fail closed.
 */
export function assessFhvHotPathDecay(
  windows: readonly FhvThroughputWindow[],
): FhvHotPathStabilityAssessment {
  const hot = windows
    .map((window) => window.checkpointExcludedBarsPerSecond)
    .filter((value): value is number => value != null && value > 0);
  const windowCount = hot.length;
  if (windowCount < FHV_HOT_PATH_STABILITY_MIN_WINDOWS) {
    return {
      assessorVersion: FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION,
      firstHotCps: hot[0] ?? null,
      lastHotCps: hot[windowCount - 1] ?? null,
      firstHalfMedianCps: null,
      lastHalfMedianCps: null,
      decayRatio: null,
      windowCount,
      minWindowsRequired: FHV_HOT_PATH_STABILITY_MIN_WINDOWS,
      verdict: "INSUFFICIENT_SAMPLES",
    };
  }
  const half = Math.floor(windowCount / 2);
  const firstHalfMedianCps = median(hot.slice(0, half));
  const lastHalfMedianCps = median(hot.slice(windowCount - half));
  const decayRatio = Number((1 - lastHalfMedianCps / firstHalfMedianCps).toFixed(4));
  return {
    assessorVersion: FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION,
    firstHotCps: hot[0]!,
    lastHotCps: hot[windowCount - 1]!,
    firstHalfMedianCps,
    lastHalfMedianCps,
    decayRatio,
    windowCount,
    minWindowsRequired: FHV_HOT_PATH_STABILITY_MIN_WINDOWS,
    verdict: decayRatio > FHV_HOT_PATH_STABILITY_DECAY_RATIO_CAP ? "DECAYING" : "FLAT",
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Growth-aware full-corpus projection.
 *
 * Checkpoint cost is summed per epoch against the database size at that epoch rather than
 * extrapolated as a constant, which is what made the flat `totalBars / cps` model over-predict.
 */
export function projectFhvGrowthAwareRuntime(input: {
  hotPathBarsPerSecond: number;
  hotPathBarsPerSecondLowerBound?: number;
  hotPathBarsPerSecondUpperBound?: number;
  sessionGrowthBytesPerCycle: number;
  initialSessionBytes?: number;
  checkpointInterceptMs: number;
  checkpointMsPerGigabyte: number;
  checkpointEveryCycles: number;
  totalBars?: number;
}): FhvGrowthAwareProjection {
  const totalBars = input.totalBars ?? FHV_OFFICIAL_TOTAL_BARS;
  const gigabyte = 1_073_741_824;
  const epochs = Math.max(1, Math.floor(totalBars / input.checkpointEveryCycles));
  const initialSessionBytes = input.initialSessionBytes ?? 0;

  let checkpointMs = 0;
  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    const bytes =
      initialSessionBytes + input.sessionGrowthBytesPerCycle * input.checkpointEveryCycles * epoch;
    checkpointMs +=
      input.checkpointInterceptMs + input.checkpointMsPerGigabyte * (bytes / gigabyte);
  }
  const checkpointSeconds = checkpointMs / 1000;

  const hotSeconds = totalBars / Math.max(input.hotPathBarsPerSecond, Number.EPSILON);
  const projectedRuntimeSeconds = hotSeconds + checkpointSeconds;
  const upperHot =
    totalBars /
    Math.max(input.hotPathBarsPerSecondLowerBound ?? input.hotPathBarsPerSecond, Number.EPSILON);
  const lowerHot =
    totalBars /
    Math.max(input.hotPathBarsPerSecondUpperBound ?? input.hotPathBarsPerSecond, Number.EPSILON);

  const finalSessionBytes = initialSessionBytes + input.sessionGrowthBytesPerCycle * totalBars;

  return {
    totalBars,
    checkpointEveryCycles: input.checkpointEveryCycles,
    hotPathSeconds: Number(hotSeconds.toFixed(1)),
    checkpointSeconds: Number(checkpointSeconds.toFixed(1)),
    projectedRuntimeSeconds: Number(projectedRuntimeSeconds.toFixed(1)),
    projectedRuntimeSecondsLowerBound: Number((lowerHot + checkpointSeconds).toFixed(1)),
    projectedRuntimeSecondsUpperBound: Number((upperHot + checkpointSeconds).toFixed(1)),
    finalSessionDatabaseBytes: Math.round(finalSessionBytes),
    withinCanonicalLimit: projectedRuntimeSeconds <= FHV_CANONICAL_MAX_RUNTIME_S,
    withinPreLaunchHeadroom: projectedRuntimeSeconds <= FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
  };
}

/** Rank measured stages by wall-time contribution. WP-6B may only target ranked hotspots. */
export function rankFhvHotspots(
  perStage: Readonly<Record<string, { totalMs: number; sampleCount: number }>>,
): FhvHotspot[] {
  const entries = Object.entries(perStage);
  const measuredMs = entries.reduce((acc, [, value]) => acc + value.totalMs, 0);
  return entries
    .map(([stage, value]) => ({
      stage,
      totalMs: Number(value.totalMs.toFixed(3)),
      sampleCount: value.sampleCount,
      shareOfMeasuredMs: measuredMs > 0 ? Number((value.totalMs / measuredMs).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export class FhvCheckpointSampleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvCheckpointSampleError";
  }
}

/**
 * Count distinct committed checkpoints from progress `checkpointCount` progression.
 *
 * Last-checkpoint fields are sticky on later progress rows, so a non-null
 * `lastCheckpointBytes`/`lastCheckpointDurationMs` pair is not an independent checkpoint.
 * `checkpointCount === 0` is not a committed checkpoint. Non-monotonic or malformed counters
 * fail closed.
 */
export function countFhvIndependentCheckpointObservations(
  series: readonly FhvFullHistoricalProgressV1[],
): number {
  let lastCount = 0;
  let independent = 0;
  for (const entry of series) {
    const raw = entry.checkpointCount;
    if (!Number.isInteger(raw) || raw < 0) {
      throw new FhvCheckpointSampleError(
        "FHV_CHECKPOINT_SAMPLE_MALFORMED",
        `checkpointCount=${String(raw)} is not a non-negative integer`,
      );
    }
    if (raw < lastCount) {
      throw new FhvCheckpointSampleError(
        "FHV_CHECKPOINT_SAMPLE_NON_MONOTONIC",
        `checkpointCount decreased from ${lastCount} to ${raw}`,
      );
    }
    if (raw > lastCount) {
      if (raw > 0) {
        independent += 1;
      }
      lastCount = raw;
    }
  }
  return independent;
}

/** @deprecated Use {@link countFhvIndependentCheckpointObservations}. */
export function countFhvCheckpointBearingObservations(
  series: readonly FhvFullHistoricalProgressV1[],
): number {
  return countFhvIndependentCheckpointObservations(series);
}
