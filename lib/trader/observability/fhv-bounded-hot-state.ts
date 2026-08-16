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
 *
 * BOUNDED requires a terminal/steady retained-state plateau. An earlier HWM plateau followed by
 * resumed linear growth is UNBOUNDED even when the resumed slope is below the known ~320 B/cycle
 * fast-failure signature.
 */

/** Known AD-1 failure signature: append-only economic history (~321 B/cycle on PR452). */
export const FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE = 256;

/**
 * SQLite page/WAL envelope around a high-water mark. Distinguishes a single restabilizing page
 * bump from resumed linear growth. Not a bytes/cycle pass ceiling.
 */
export const FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES = 65_536;

export const FHV_BOUNDED_HOT_STATE_MIN_SIZE_SAMPLES = 4;
export const FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES = 3;

export const FHV_BOUNDED_HOT_STATE_ASSESSOR_VERSION = "fhv-bounded-hot-state-assessor/v2" as const;

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
  terminalHwmPlateauSampleCount: number;
  postSaturationBytesPerCycle: number | null;
  lateWindowBytesPerCycle: number | null;
  reason: string;
}>;

type HwmRun = Readonly<{ start: number; end: number; value: number }>;

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

function constantHwmRuns(hwm: readonly number[]): HwmRun[] {
  const runs: HwmRun[] = [];
  let runStart = 0;
  for (let index = 1; index <= hwm.length; index += 1) {
    if (index === hwm.length || hwm[index] !== hwm[runStart]) {
      runs.push({ start: runStart, end: index - 1, value: hwm[runStart]! });
      runStart = index;
    }
  }
  return runs;
}

function runLength(run: HwmRun): number {
  return run.end - run.start + 1;
}

function assessment(input: {
  classification: FhvBoundednessClassification;
  sampleCount: number;
  saturationCycle: number | null;
  postSaturationSampleCount: number;
  longestHwmPlateauSampleCount: number;
  terminalHwmPlateauSampleCount: number;
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
 * A. startup/fill-up then a stable *terminal* HWM plateau → BOUNDED
 * B. persistent ~320 B/cycle growth → UNBOUNDED (fast-failure signature)
 * C. plateau then resumed linear growth, including slopes below 256 B/cycle → UNBOUNDED
 * D. not enough terminal plateau observations → INSUFFICIENT_EVIDENCE
 */
export function assessFhvBoundedHotState(
  series: readonly Readonly<{
    globalEventSequence: number;
    sqliteDatabaseBytes: number | null;
  }>[],
): FhvBoundedHotStateAssessment {
  const samples = toSizeSamples(series);
  const sampleCount = samples.length;
  const empty = {
    saturationCycle: null as number | null,
    postSaturationSampleCount: 0,
    longestHwmPlateauSampleCount: 0,
    terminalHwmPlateauSampleCount: 0,
    postSaturationBytesPerCycle: null as number | null,
    lateWindowBytesPerCycle: null as number | null,
  };
  if (sampleCount < FHV_BOUNDED_HOT_STATE_MIN_SIZE_SAMPLES) {
    return assessment({
      classification: "INSUFFICIENT_EVIDENCE",
      sampleCount,
      ...empty,
      reason: `size_samples=${sampleCount} < ${FHV_BOUNDED_HOT_STATE_MIN_SIZE_SAMPLES}`,
    });
  }

  const hwm: number[] = [];
  let runningMax = 0;
  for (const sample of samples) {
    runningMax = Math.max(runningMax, sample.bytes);
    hwm.push(runningMax);
  }

  const runs = constantHwmRuns(hwm);
  const terminal = runs[runs.length - 1]!;
  const terminalHwmPlateauSampleCount = runLength(terminal);
  const longestHwmPlateauSampleCount = Math.max(...runs.map(runLength));
  const lateStart = Math.floor(sampleCount / 2);
  const lateWindowBytesPerCycle = slopeOf(samples.slice(lateStart));
  const last = samples[sampleCount - 1]!;
  const first = samples[0]!;

  if (terminalHwmPlateauSampleCount >= FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES) {
    const saturationCycle = samples[terminal.start]!.cycle;
    return assessment({
      classification: "BOUNDED",
      sampleCount,
      saturationCycle,
      postSaturationSampleCount: terminalHwmPlateauSampleCount,
      longestHwmPlateauSampleCount,
      terminalHwmPlateauSampleCount,
      postSaturationBytesPerCycle: 0,
      lateWindowBytesPerCycle,
      reason: "terminal_hwm_plateau_after_startup_or_restabilized_page_bump",
    });
  }

  if ((lateWindowBytesPerCycle ?? 0) >= FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE) {
    return assessment({
      classification: "UNBOUNDED",
      sampleCount,
      ...empty,
      longestHwmPlateauSampleCount,
      terminalHwmPlateauSampleCount,
      lateWindowBytesPerCycle,
      reason: `persistent_linear_growth late_slope=${lateWindowBytesPerCycle}`,
    });
  }

  const earlierAdequate = [...runs]
    .slice(0, -1)
    .reverse()
    .find((run) => runLength(run) >= FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES);
  if (earlierAdequate) {
    const after = samples.slice(earlierAdequate.end + 1);
    const postSaturationBytesPerCycle = slopeOf(after);
    const growthAfter = last.bytes - earlierAdequate.value;
    const samplesAfter = after.length;
    const resumedLinear =
      (postSaturationBytesPerCycle ?? 0) > 0 &&
      samplesAfter >= FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES;
    if (resumedLinear || growthAfter > FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES) {
      return assessment({
        classification: "UNBOUNDED",
        sampleCount,
        saturationCycle: samples[earlierAdequate.start]!.cycle,
        postSaturationSampleCount: samplesAfter,
        longestHwmPlateauSampleCount,
        terminalHwmPlateauSampleCount,
        postSaturationBytesPerCycle: postSaturationBytesPerCycle ?? growthAfter,
        lateWindowBytesPerCycle,
        reason: resumedLinear
          ? `resumed_linear_growth_after_hwm_plateau slope=${postSaturationBytesPerCycle}`
          : `resumed_net_growth_after_hwm_plateau delta=${growthAfter}`,
      });
    }
    return assessment({
      classification: "INSUFFICIENT_EVIDENCE",
      sampleCount,
      saturationCycle: samples[earlierAdequate.start]!.cycle,
      postSaturationSampleCount: samplesAfter,
      longestHwmPlateauSampleCount,
      terminalHwmPlateauSampleCount,
      postSaturationBytesPerCycle,
      lateWindowBytesPerCycle,
      reason: `no_terminal_hwm_plateau_of_${FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES}_samples`,
    });
  }

  const netGrowth = last.bytes - first.bytes;
  if (netGrowth > FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES && (lateWindowBytesPerCycle ?? 0) > 0) {
    return assessment({
      classification: "UNBOUNDED",
      sampleCount,
      ...empty,
      longestHwmPlateauSampleCount,
      terminalHwmPlateauSampleCount,
      lateWindowBytesPerCycle,
      reason: `persistent_net_growth_without_terminal_plateau net=${netGrowth}`,
    });
  }

  return assessment({
    classification: "INSUFFICIENT_EVIDENCE",
    sampleCount,
    ...empty,
    longestHwmPlateauSampleCount,
    terminalHwmPlateauSampleCount,
    lateWindowBytesPerCycle,
    reason: `no_terminal_hwm_plateau_of_${FHV_BOUNDED_HOT_STATE_MIN_POST_SATURATION_SAMPLES}_samples`,
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
