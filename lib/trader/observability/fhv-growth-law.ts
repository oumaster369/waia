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

export const FHV_GROWTH_LAW_SCHEMA = "fhv-growth-law-report/v1" as const;
export const FHV_GROWTH_LAW_REPORT_FILENAME = "fhv-growth-law-report.v1.json";

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
 * Separates genuine hot-path decay from probe-segment bias: a flat series means the probe simply
 * sampled an unrepresentative segment, a declining series means the hot path itself degrades.
 */
export function assessFhvHotPathDecay(windows: readonly FhvThroughputWindow[]): {
  firstHotCps: number | null;
  lastHotCps: number | null;
  decayRatio: number | null;
  verdict: "DECAYING" | "FLAT" | "INSUFFICIENT_SAMPLES";
} {
  const hot = windows
    .map((window) => window.checkpointExcludedBarsPerSecond)
    .filter((value): value is number => value != null && value > 0);
  if (hot.length < 2) {
    return {
      firstHotCps: null,
      lastHotCps: null,
      decayRatio: null,
      verdict: "INSUFFICIENT_SAMPLES",
    };
  }
  const first = hot[0]!;
  const last = hot[hot.length - 1]!;
  const decayRatio = Number((1 - last / first).toFixed(4));
  return {
    firstHotCps: first,
    lastHotCps: last,
    decayRatio,
    // 10% mirrors the stability gate's decay cap.
    verdict: decayRatio > 0.1 ? "DECAYING" : "FLAT",
  };
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
