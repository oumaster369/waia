import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

/**
 * Production-owned ADR-0025 AD-1 bounded-hot-state assessor.
 *
 * `session.sqlite` retained hot state must be bounded in run length. WP-7B and target-host
 * throughput qualification consume this function; tests must not own a competing structural
 * ceiling such as 160 or 280 bytes/cycle.
 *
 * Whole-series OLS remains a diagnostic/projection input elsewhere. It is not the verdict:
 * startup fill-up of a bounded database produces a steep whole-series slope that is not
 * persistent linear growth.
 */

/** Known AD-1 failure signature: append-only economic history (~321 B/cycle on PR452). */
export const FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE = 256;

/**
 * SQLite page/WAL envelope around a high-water mark. Distinguishes a last-sample page bump
 * from resumed unbounded growth. Not a bytes/cycle pass ceiling.
 */
export const FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES = 65_536;

export const FHV_BOUNDED_HOT_STATE_MIN_SIZE_SAMPLES = 4;
export const FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES = 3;

export const FHV_BOUNDED_HOT_STATE_ASSESSOR_VERSION = "fhv-bounded-hot-state-assessor/v1" as const;

export type FhvBoundednessClassification = "BOUNDED" | "UNBOUNDED" | "INSUFFICIENT_EVIDENCE";

export type FhvSizeSample = Readonly<{
  cycle: number;
  bytes: number;
}>;

export type FhvBoundedHotStateAssessment = Readonly<{
  assessorVersion: typeof FHV_BOUNDED_HOT_STATE_ASSESSOR_VERSION;
  classification: FhvBoundednessClassification;
  sampleCount: number;
  saturationCycle: number | null;
  postSaturationSampleCount: number;
  longestHwmPlateauSampleCount: number;
  postSaturationBytesPerCycle: number | null;
  lateWindowBytesPerCycle: number | null;
  reason: string;
}>;

function toSizeSamples(
  series: readonly Readonly<{
    globalEventSequence: number;
    sqliteDatabaseBytes: number | null;
  }>[],
): FhvSizeSample[] {
  const samples: FhvSizeSample[] = [];
  for (const entry of series) {
    if (entry.sqliteDatabaseBytes == null || !Number.isFinite(entry.sqliteDatabaseBytes)) {
      continue;
    }
    samples.push({ cycle: entry.globalEventSequence, bytes: entry.sqliteDatabaseBytes });
  }
  return samples;
}

function slopeOf(samples: readonly FhvSizeSample[]): number | null {
  const n = samples.length;
  if (n < 2) {
    return null;
  }
  const meanX = samples.reduce((acc, sample) => acc + sample.cycle, 0) / n;
  const meanY = samples.reduce((acc, sample) => acc + sample.bytes, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const sample of samples) {
    sxy += (sample.cycle - meanX) * (sample.bytes - meanY);
    sxx += (sample.cycle - meanX) ** 2;
  }
  if (sxx === 0) {
    return 0;
  }
  return sxy / sxx;
}

function longestHwmPlateau(hwm: readonly number[]): { start: number; end: number } {
  let bestStart = 0;
  let bestEnd = 0;
  let runStart = 0;
  for (let index = 1; index <= hwm.length; index += 1) {
    if (index === hwm.length || hwm[index] !== hwm[runStart]) {
      if (index - 1 - runStart > bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = index - 1;
      }
      runStart = index;
    }
  }
  return { start: bestStart, end: bestEnd };
}

function assessment(input: {
  classification: FhvBoundednessClassification;
  sampleCount: number;
  saturationCycle: number | null;
  postSaturationSampleCount: number;
  longestHwmPlateauSampleCount: number;
  postSaturationBytesPerCycle: number | null;
  lateWindowBytesPerCycle: number | null;
  reason: string;
}): FhvBoundedHotStateAssessment {
  return {
    assessorVersion: FHV_BOUNDED_HOT_STATE_ASSESSOR_VERSION,
    ...input,
  };
}

/**
 * Classify whether session.sqlite retained size is bounded in run length.
 *
 * A. startup/fill-up then a stable HWM plateau → BOUNDED
 * B. persistent ~320 B/cycle growth → UNBOUNDED
 * C. plateau then resumed sustained growth → UNBOUNDED
 * D. not enough post-saturation observations → INSUFFICIENT_EVIDENCE
 */
export function assessFhvBoundedHotState(
  series: readonly Readonly<{
    globalEventSequence: number;
    sqliteDatabaseBytes: number | null;
  }>[],
): FhvBoundedHotStateAssessment {
  const samples = toSizeSamples(series);
  const sampleCount = samples.length;
  if (sampleCount < FHV_BOUNDED_HOT_STATE_MIN_SIZE_SAMPLES) {
    return assessment({
      classification: "INSUFFICIENT_EVIDENCE",
      sampleCount,
      saturationCycle: null,
      postSaturationSampleCount: 0,
      longestHwmPlateauSampleCount: 0,
      postSaturationBytesPerCycle: null,
      lateWindowBytesPerCycle: null,
      reason: `size_samples=${sampleCount} < ${FHV_BOUNDED_HOT_STATE_MIN_SIZE_SAMPLES}`,
    });
  }

  const hwm: number[] = [];
  let runningMax = 0;
  for (const sample of samples) {
    runningMax = Math.max(runningMax, sample.bytes);
    hwm.push(runningMax);
  }

  const plateau = longestHwmPlateau(hwm);
  const longestHwmPlateauSampleCount = plateau.end - plateau.start + 1;
  const lateStart = Math.floor(sampleCount / 2);
  const lateWindowBytesPerCycle = slopeOf(samples.slice(lateStart));

  if (longestHwmPlateauSampleCount >= FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES) {
    const saturationCycle = samples[plateau.start]!.cycle;
    const after = samples.slice(plateau.end);
    const afterExclusive = samples.slice(plateau.end + 1);
    const postSaturationBytesPerCycle = slopeOf(afterExclusive) ?? slopeOf(after);
    if ((postSaturationBytesPerCycle ?? 0) >= FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE) {
      return assessment({
        classification: "UNBOUNDED",
        sampleCount,
        saturationCycle,
        postSaturationSampleCount: afterExclusive.length,
        longestHwmPlateauSampleCount,
        postSaturationBytesPerCycle,
        lateWindowBytesPerCycle,
        reason: `resumed_growth_after_hwm_plateau slope=${postSaturationBytesPerCycle}`,
      });
    }
    const last = samples[sampleCount - 1]!;
    const plateauHwm = hwm[plateau.end]!;
    const afterCycleSpan = last.cycle - samples[plateau.end]!.cycle;
    const hwmDelta = last.bytes - plateauHwm;
    if (afterCycleSpan > 0 && hwmDelta > FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES) {
      const afterNetRate = hwmDelta / afterCycleSpan;
      if (afterNetRate >= FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE) {
        return assessment({
          classification: "UNBOUNDED",
          sampleCount,
          saturationCycle,
          postSaturationSampleCount: afterExclusive.length,
          longestHwmPlateauSampleCount,
          postSaturationBytesPerCycle: afterNetRate,
          lateWindowBytesPerCycle,
          reason: `resumed_net_growth_after_hwm_plateau rate=${afterNetRate}`,
        });
      }
    }
    return assessment({
      classification: "BOUNDED",
      sampleCount,
      saturationCycle,
      postSaturationSampleCount: sampleCount - plateau.start,
      longestHwmPlateauSampleCount,
      postSaturationBytesPerCycle: postSaturationBytesPerCycle ?? 0,
      lateWindowBytesPerCycle,
      reason: "hwm_plateau_after_startup_or_flat_retained_state",
    });
  }

  if ((lateWindowBytesPerCycle ?? 0) >= FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE) {
    return assessment({
      classification: "UNBOUNDED",
      sampleCount,
      saturationCycle: null,
      postSaturationSampleCount: 0,
      longestHwmPlateauSampleCount,
      postSaturationBytesPerCycle: null,
      lateWindowBytesPerCycle,
      reason: `persistent_linear_growth late_slope=${lateWindowBytesPerCycle}`,
    });
  }

  return assessment({
    classification: "INSUFFICIENT_EVIDENCE",
    sampleCount,
    saturationCycle: null,
    postSaturationSampleCount: 0,
    longestHwmPlateauSampleCount,
    postSaturationBytesPerCycle: null,
    lateWindowBytesPerCycle,
    reason: `no_hwm_plateau_of_${FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES}_samples`,
  });
}

export function isFhvHotStateStructurallyBounded(
  series: readonly Readonly<{
    globalEventSequence: number;
    sqliteDatabaseBytes: number | null;
  }>[],
): boolean {
  return assessFhvBoundedHotState(series).classification === "BOUNDED";
}
