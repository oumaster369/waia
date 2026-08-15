import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assessFhvBoundedHotState,
  type FhvBoundedHotStateAssessment,
} from "@/lib/trader/observability/fhv-bounded-hot-state";
import { FHV_DEFAULT_CHECKPOINT_EVERY_CYCLES } from "@/lib/trader/observability/fhv-execution-wal";
import {
  assessFhvHotPathDecay,
  computeFhvThroughputWindows,
  countFhvIndependentCheckpointObservations,
  FhvCheckpointSampleError,
  fitFhvCheckpointDurationVsSize,
  fitFhvSessionGrowthLaw,
  FHV_GROWTH_LAW_LEGACY_V1_FILENAME,
  FHV_GROWTH_LAW_REPORT_FILENAME,
  FHV_GROWTH_LAW_SCHEMA,
  projectFhvGrowthAwareRuntime,
  rankFhvHotspots,
  type FhvGrowthAwareProjection,
  type FhvHotPathStabilityAssessment,
  type FhvHotspot,
  type FhvLinearFit,
} from "@/lib/trader/observability/fhv-growth-law";
import {
  FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME,
  type FhvFullHistoricalProgressV1,
} from "@/lib/trader/observability/fhv-full-historical-progress";
import type { FhvCheckpointCostModelV1 } from "@/lib/trader/observability/fhv-checkpoint-cost-model";
import {
  assertFhvCleanTrackedHeadCheckout,
  FhvT4CheckoutIdentityError,
} from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import {
  assertFhvThroughputProducerBinding,
  assertProgressSeriesMatchesProducerBinding,
  type FhvThroughputProducerBindingV1,
} from "@/lib/trader/observability/fhv-throughput-producer-binding";
import {
  assertCanonicalFhvThroughputSamplerContract,
  type FhvThroughputQualifierSamplerContract,
} from "@/lib/trader/observability/fhv-throughput-sampler";

export class FhvGrowthLawReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvGrowthLawReportError";
  }
}

export type FhvGrowthLawReportV2 = Readonly<{
  schemaVersion: typeof FHV_GROWTH_LAW_SCHEMA;
  capturedAtUtc: string;
  runDir: string;
  runIdentity: Readonly<{ runDir: string }>;
  checkout: Readonly<{
    headSha: string;
    trackedTreeClean: true;
  }>;
  producer: Readonly<{
    headSha: string;
    trackedTreeClean: true;
    runId: string;
    bindingDigest: string;
  }>;
  samplerContract: FhvThroughputQualifierSamplerContract;
  progressJsonlFilename: typeof FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME;
  progressBytesSha256: string;
  progressSamples: number;
  checkpointSamples: number;
  sessionGrowthDiagnostic: Readonly<{
    bytesPerCycle: number;
    interceptBytes: number;
    rSquared: number;
    sampleCount: number;
    role: "DIAGNOSTIC_PROJECTION_ONLY";
  }>;
  boundedHotState: FhvBoundedHotStateAssessment;
  checkpointCost: Readonly<{
    source: "cost-model" | "progress-series";
    msPerGigabyte: number;
    interceptMs: number;
    seriesRSquared: number;
    ficloneSucceeded: boolean | null;
    sampleCount: number;
  }>;
  hotPath: FhvHotPathStabilityAssessment &
    Readonly<{
      windows: number;
      barsPerSecond: number;
    }>;
  projection: FhvGrowthAwareProjection;
  hotspots: FhvHotspot[];
  hotspotEvidence: "PRESENT_EXACT_HEAD_MEASURED_PROFILE" | "ABSENT_RUN_STAGE_PROFILE";
  reportDigest: string;
}>;

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function digestReportBody(body: Omit<FhvGrowthLawReportV2, "reportDigest">): string {
  return sha256Utf8(JSON.stringify(body));
}

export function readFhvProgressSeries(runDir: string): {
  series: FhvFullHistoricalProgressV1[];
  progressPath: string;
  progressBytesSha256: string;
} {
  const progressPath = join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME);
  if (!existsSync(progressPath)) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_NO_SERIES",
      `${progressPath} not found — run with FHV_IDHPS_PROGRESS=1`,
    );
  }
  const raw = readFileSync(progressPath, "utf8");
  const series = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FhvFullHistoricalProgressV1);
  return { series, progressPath, progressBytesSha256: sha256Utf8(raw) };
}

function readHotspots(path: string | null): FhvHotspot[] {
  if (!path || !existsSync(path)) {
    return [];
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    perStage?: Record<string, { totalMs: number; sampleCount: number }>;
    stages?: { stage: string; totalMs: number; sampleCount: number }[];
  };
  if (raw.perStage) {
    return rankFhvHotspots(raw.perStage);
  }
  if (raw.stages) {
    return rankFhvHotspots(
      Object.fromEntries(
        raw.stages.map((entry) => [
          entry.stage,
          { totalMs: entry.totalMs, sampleCount: entry.sampleCount },
        ]),
      ),
    );
  }
  return [];
}

export function buildFhvGrowthLawReportV2(input: {
  runDir: string;
  repoPath: string;
  expectedHeadSha?: string;
  costModelPath?: string | null;
  stageProfilePath?: string | null;
  capturedAtUtc?: string;
}): FhvGrowthLawReportV2 {
  const checkout = assertFhvCleanTrackedHeadCheckout({
    repoPath: input.repoPath,
    ...(input.expectedHeadSha ? { expectedHeadSha: input.expectedHeadSha } : {}),
  });
  const producerBinding: FhvThroughputProducerBindingV1 = assertFhvThroughputProducerBinding({
    runDir: input.runDir,
    expectedProducerHeadSha: checkout.headSha,
  });
  const samplerContract = assertCanonicalFhvThroughputSamplerContract(
    producerBinding.samplerContract,
  );
  const { series, progressBytesSha256 } = readFhvProgressSeries(input.runDir);
  if (series.length < 2) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_INSUFFICIENT_SAMPLES",
      `${series.length} progress sample(s)`,
    );
  }
  assertProgressSeriesMatchesProducerBinding({ series, binding: producerBinding });

  const growth: FhvLinearFit = fitFhvSessionGrowthLaw(series);
  const checkpointFromSeries = fitFhvCheckpointDurationVsSize(series);
  let checkpointSamples: number;
  try {
    checkpointSamples = countFhvIndependentCheckpointObservations(series);
  } catch (error) {
    if (error instanceof FhvCheckpointSampleError) {
      throw new FhvGrowthLawReportError(error.code, error.message);
    }
    throw error;
  }
  const windows = computeFhvThroughputWindows(series);
  const decay = assessFhvHotPathDecay(windows);
  const boundedHotState = assessFhvBoundedHotState(series);

  const costModel: FhvCheckpointCostModelV1 | null =
    input.costModelPath && existsSync(input.costModelPath)
      ? (JSON.parse(readFileSync(input.costModelPath, "utf8")) as FhvCheckpointCostModelV1)
      : null;

  const checkpointInterceptMs = costModel?.interceptMs ?? checkpointFromSeries.intercept;
  const checkpointMsPerGigabyte = costModel?.slopeMsPerGigabyte ?? checkpointFromSeries.slope;

  const hotSamples = windows
    .map((window) => window.checkpointExcludedBarsPerSecond)
    .filter((value): value is number => value != null && value > 0);
  const last = series[series.length - 1]!;
  const hotPathBarsPerSecond =
    hotSamples.length > 0
      ? hotSamples[hotSamples.length - 1]!
      : (last.checkpointExcludedBarsPerSecond ?? last.effectiveBarsPerSecond);

  const projection = projectFhvGrowthAwareRuntime({
    hotPathBarsPerSecond,
    ...(hotSamples.length > 0
      ? {
          hotPathBarsPerSecondLowerBound: Math.min(...hotSamples),
          hotPathBarsPerSecondUpperBound: Math.max(...hotSamples),
        }
      : {}),
    sessionGrowthBytesPerCycle: Math.max(0, growth.slope),
    initialSessionBytes: series[0]?.sqliteDatabaseBytes ?? 0,
    checkpointInterceptMs,
    checkpointMsPerGigabyte,
    checkpointEveryCycles: FHV_DEFAULT_CHECKPOINT_EVERY_CYCLES,
  });

  const hotspots = readHotspots(input.stageProfilePath ?? null);
  const body: Omit<FhvGrowthLawReportV2, "reportDigest"> = {
    schemaVersion: FHV_GROWTH_LAW_SCHEMA,
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
    runDir: input.runDir,
    runIdentity: { runDir: input.runDir },
    checkout: {
      headSha: checkout.headSha,
      trackedTreeClean: true,
    },
    producer: {
      headSha: producerBinding.producer.headSha,
      trackedTreeClean: true,
      runId: producerBinding.runId,
      bindingDigest: producerBinding.bindingDigest,
    },
    samplerContract,
    progressJsonlFilename: FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME,
    progressBytesSha256,
    progressSamples: series.length,
    checkpointSamples,
    sessionGrowthDiagnostic: {
      bytesPerCycle: Number(growth.slope.toFixed(3)),
      interceptBytes: Math.round(growth.intercept),
      rSquared: Number(growth.rSquared.toFixed(6)),
      sampleCount: growth.sampleCount,
      role: "DIAGNOSTIC_PROJECTION_ONLY",
    },
    boundedHotState,
    checkpointCost: {
      source: costModel ? "cost-model" : "progress-series",
      msPerGigabyte: Number(checkpointMsPerGigabyte.toFixed(3)),
      interceptMs: Number(checkpointInterceptMs.toFixed(3)),
      seriesRSquared: Number(checkpointFromSeries.rSquared.toFixed(6)),
      ficloneSucceeded: costModel?.ficloneSucceeded ?? last.ficloneSucceeded ?? null,
      sampleCount: checkpointFromSeries.sampleCount,
    },
    hotPath: {
      windows: windows.length,
      barsPerSecond: Number(hotPathBarsPerSecond.toFixed(3)),
      ...decay,
    },
    projection,
    hotspots,
    hotspotEvidence:
      hotspots.length > 0 ? "PRESENT_EXACT_HEAD_MEASURED_PROFILE" : "ABSENT_RUN_STAGE_PROFILE",
  };

  return { ...body, reportDigest: digestReportBody(body) };
}

export function assertFhvGrowthLawReportV2(input: {
  reportPath: string;
  runDir: string;
  expectedHeadSha?: string;
}): FhvGrowthLawReportV2 {
  if (!existsSync(input.reportPath)) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_MISSING",
      `${input.reportPath} not found`,
    );
  }
  if (input.reportPath.endsWith(FHV_GROWTH_LAW_LEGACY_V1_FILENAME)) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_SCHEMA_UNSUPPORTED",
      `legacy ${FHV_GROWTH_LAW_LEGACY_V1_FILENAME} cannot qualify a new official throughput receipt`,
    );
  }
  const raw = readFileSync(input.reportPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_MALFORMED",
      `Growth-law report is not valid JSON: ${String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_MALFORMED",
      "Growth-law report is not an object",
    );
  }
  const report = parsed as FhvGrowthLawReportV2;
  if (report.schemaVersion !== FHV_GROWTH_LAW_SCHEMA) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_SCHEMA_UNSUPPORTED",
      `schema ${String(report.schemaVersion)} != ${FHV_GROWTH_LAW_SCHEMA}`,
    );
  }
  if (typeof report.reportDigest !== "string" || report.reportDigest.length !== 64) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_DIGEST_MISSING",
      "Growth-law report has no valid reportDigest",
    );
  }
  const { reportDigest, ...body } = report;
  const recomputed = digestReportBody(body);
  if (recomputed !== reportDigest) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_DIGEST_MISMATCH",
      `recomputed ${recomputed} != recorded ${reportDigest}`,
    );
  }
  const { progressBytesSha256 } = readFhvProgressSeries(input.runDir);
  if (progressBytesSha256 !== report.progressBytesSha256) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_PROGRESS_DIGEST_MISMATCH",
      `progress JSONL mutated after report creation: ${progressBytesSha256} != ${report.progressBytesSha256}`,
    );
  }
  const producerBinding = assertFhvThroughputProducerBinding({
    runDir: input.runDir,
    expectedProducerHeadSha: report.producer.headSha,
  });
  if (producerBinding.bindingDigest !== report.producer.bindingDigest) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_PRODUCER_BINDING_MISMATCH",
      "growth-law producer bindingDigest does not match execution-time sidecar",
    );
  }
  assertCanonicalFhvThroughputSamplerContract(report.samplerContract);
  if (input.expectedHeadSha && report.checkout.headSha !== input.expectedHeadSha.toLowerCase()) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_CHECKOUT_MISMATCH",
      `report checkout ${report.checkout.headSha} != expected ${input.expectedHeadSha}`,
    );
  }
  return report;
}

export { FHV_GROWTH_LAW_REPORT_FILENAME, FhvT4CheckoutIdentityError };
