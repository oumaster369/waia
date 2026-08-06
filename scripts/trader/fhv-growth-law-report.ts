/**
 * WP-4 — FHV growth-law and hotspot report.
 *
 * Reads the WP-1 progress time series (and optionally the WP-3A checkpoint cost model and a
 * stage profile), fits the session-growth and checkpoint-cost laws, separates hot-path decay
 * from probe-segment bias, and emits the growth-aware full-corpus projection that gates WP-6B
 * and WP-8.
 *
 * Usage:
 *   node --import tsx scripts/trader/fhv-growth-law-report.ts \
 *     --run-dir <fhv run dir> [--cost-model <path>] [--stage-profile <path>] [--out <path>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { FHV_DEFAULT_CHECKPOINT_EVERY_CYCLES } from "@/lib/trader/observability/fhv-execution-wal";
import {
  assessFhvHotPathDecay,
  computeFhvThroughputWindows,
  fitFhvCheckpointDurationVsSize,
  fitFhvSessionGrowthLaw,
  FHV_GROWTH_LAW_REPORT_FILENAME,
  FHV_GROWTH_LAW_SCHEMA,
  projectFhvGrowthAwareRuntime,
  rankFhvHotspots,
  type FhvHotspot,
} from "@/lib/trader/observability/fhv-growth-law";
import {
  FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME,
  type FhvFullHistoricalProgressV1,
} from "@/lib/trader/observability/fhv-full-historical-progress";
import type { FhvCheckpointCostModelV1 } from "@/lib/trader/observability/fhv-checkpoint-cost-model";

function parseArgs(argv: string[]): {
  runDir: string;
  costModelPath: string | null;
  stageProfilePath: string | null;
  outPath: string | null;
} {
  let runDir = "";
  let costModelPath: string | null = null;
  let stageProfilePath: string | null = null;
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--cost-model") {
      costModelPath = argv[++i] ?? null;
    } else if (arg === "--stage-profile") {
      stageProfilePath = argv[++i] ?? null;
    } else if (arg === "--out") {
      outPath = argv[++i] ?? null;
    }
  }
  if (!runDir) {
    throw new Error("BLOCKED_BY_FHV_GROWTH_LAW_ARGS: --run-dir is required");
  }
  return { runDir, costModelPath, stageProfilePath, outPath };
}

function readSeries(runDir: string): FhvFullHistoricalProgressV1[] {
  const path = join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME);
  if (!existsSync(path)) {
    throw new Error(
      `BLOCKED_BY_FHV_GROWTH_LAW_NO_SERIES: ${path} not found — run with FHV_IDHPS_PROGRESS=1`,
    );
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FhvFullHistoricalProgressV1);
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

function main(): void {
  const { runDir, costModelPath, stageProfilePath, outPath } = parseArgs(process.argv.slice(2));
  const series = readSeries(runDir);
  if (series.length < 2) {
    throw new Error(
      `BLOCKED_BY_FHV_GROWTH_LAW_INSUFFICIENT_SAMPLES: ${series.length} progress sample(s)`,
    );
  }

  const growth = fitFhvSessionGrowthLaw(series);
  const checkpointFromSeries = fitFhvCheckpointDurationVsSize(series);
  const windows = computeFhvThroughputWindows(series);
  const decay = assessFhvHotPathDecay(windows);

  const costModel: FhvCheckpointCostModelV1 | null =
    costModelPath && existsSync(costModelPath)
      ? (JSON.parse(readFileSync(costModelPath, "utf8")) as FhvCheckpointCostModelV1)
      : null;

  // The dedicated cost model measures depths the bounded segment never reaches, so prefer it.
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
    sessionGrowthBytesPerCycle: growth.slope,
    initialSessionBytes: series[0]?.sqliteDatabaseBytes ?? 0,
    checkpointInterceptMs,
    checkpointMsPerGigabyte,
    checkpointEveryCycles: FHV_DEFAULT_CHECKPOINT_EVERY_CYCLES,
  });

  const hotspots = readHotspots(stageProfilePath);

  const report = {
    schemaVersion: FHV_GROWTH_LAW_SCHEMA,
    capturedAtUtc: new Date().toISOString(),
    runDir,
    progressSamples: series.length,
    sessionGrowth: {
      bytesPerCycle: Number(growth.slope.toFixed(3)),
      interceptBytes: Math.round(growth.intercept),
      rSquared: Number(growth.rSquared.toFixed(6)),
      sampleCount: growth.sampleCount,
    },
    checkpointCost: {
      source: costModel ? "cost-model" : "progress-series",
      msPerGigabyte: Number(checkpointMsPerGigabyte.toFixed(3)),
      interceptMs: Number(checkpointInterceptMs.toFixed(3)),
      seriesRSquared: Number(checkpointFromSeries.rSquared.toFixed(6)),
      ficloneSucceeded: costModel?.ficloneSucceeded ?? last.ficloneSucceeded ?? null,
    },
    hotPath: {
      windows: windows.length,
      barsPerSecond: Number(hotPathBarsPerSecond.toFixed(3)),
      ...decay,
    },
    projection,
    hotspots,
    /*
     * WP-6B may only optimize ranked hotspots. Without a stage profile there is no evidence to
     * rank, so the report says so instead of implying an empty hotspot list means "nothing to do".
     */
    hotspotEvidence: hotspots.length > 0 ? "RANKED" : "ABSENT_RUN_STAGE_PROFILE",
  };

  const destination = outPath ?? join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`[fhv-growth-law] wrote ${destination}`);
}

main();
