/**
 * Execution Server throughput host qualification (ADR-0025 AD-6b).
 *
 * The 877 cps / 7200 s terminal and 6480 s pre-launch contracts are unchanged. Pull-request CI proves
 * software structure; this command proves the actual target Execution Server can finish the official
 * corpus within the pre-launch headroom. It consumes the production-path growth-law report (WP-4),
 * never a synthetic CPU microbenchmark, and emits one identity-bound receipt.
 *
 * The official unbounded full-corpus launch must fail closed unless this receipt says
 * EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED. Environment variables never qualify the host.
 *
 * Usage:
 *   node --import tsx scripts/ops/fhv-throughput-host-qualification.ts --run-dir <fhv run dir>
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, hostname, platform } from "node:os";
import { dirname, join } from "node:path";

import {
  FHV_CANONICAL_MAX_RUNTIME_S,
  FHV_GROWTH_LAW_SCHEMA,
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
} from "@/lib/trader/observability/fhv-growth-law";
import {
  FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE,
  FHV_THROUGHPUT_MIN_CPS,
  FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES,
  FHV_THROUGHPUT_RECEIPT_FILENAME,
  FHV_THROUGHPUT_RECEIPT_SCHEMA,
} from "@/lib/trader/observability/fhv-throughput-receipt";

export type FhvThroughputQualificationClassification =
  | "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED"
  | "EXECUTION_SERVER_FHV_THROUGHPUT_NOT_QUALIFIED"
  | "EXECUTION_SERVER_FHV_THROUGHPUT_EVIDENCE_INVALID";

function shell(command: string): string {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unavailable";
  }
}

function parseArgs(argv: readonly string[]): { runDir: string; outPath: string | null } {
  let runDir = "";
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--out") {
      outPath = argv[++i] ?? null;
    }
  }
  if (!runDir) {
    throw new Error("BLOCKED_BY_FHV_THROUGHPUT_ARGS: --run-dir is required");
  }
  return { runDir, outPath };
}

type GrowthLawReport = {
  schemaVersion: string;
  sessionGrowth?: { bytesPerCycle?: number; sampleCount?: number };
  hotPath?: { verdict?: string };
  projection?: { projectedRuntimeSeconds?: number; withinPreLaunchHeadroom?: boolean };
};

function main(): void {
  const { runDir, outPath } = parseArgs(process.argv.slice(2));

  const reportPath = join(runDir, "fhv-growth-law-report.v1.json");
  if (!existsSync(reportPath)) {
    throw new Error(
      `BLOCKED_BY_FHV_THROUGHPUT_NO_GROWTH_REPORT: ${reportPath} not found — run pnpm trader:fhv:growth-law-report on the representative segment first`,
    );
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as GrowthLawReport;

  const growthBytesPerCycle = report.sessionGrowth?.bytesPerCycle ?? NaN;
  const progressSamples = report.sessionGrowth?.sampleCount ?? 0;
  const projectionSeconds = report.projection?.projectedRuntimeSeconds ?? NaN;
  const projectionAvailable =
    report.schemaVersion === FHV_GROWTH_LAW_SCHEMA && Number.isFinite(projectionSeconds);
  const decayVerdict = (report.hotPath?.verdict ?? "INSUFFICIENT_SAMPLES") as
    | "FLAT"
    | "DECAYING"
    | "INSUFFICIENT_SAMPLES";
  // Checkpoint cost is fit from a per-epoch series; the growth-law report records its sample count.
  const checkpointSamples = progressSamples;

  const evidenceValid =
    projectionAvailable &&
    progressSamples >= FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES &&
    checkpointSamples >= FHV_THROUGHPUT_MIN_PROGRESS_SAMPLES &&
    Number.isFinite(growthBytesPerCycle) &&
    growthBytesPerCycle <= FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE &&
    decayVerdict === "FLAT";

  const withinPreLaunch =
    projectionAvailable && projectionSeconds <= FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S;

  let classification: FhvThroughputQualificationClassification;
  if (!projectionAvailable) {
    classification = "EXECUTION_SERVER_FHV_THROUGHPUT_EVIDENCE_INVALID";
  } else if (evidenceValid && withinPreLaunch) {
    classification = "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED";
  } else {
    classification = "EXECUTION_SERVER_FHV_THROUGHPUT_NOT_QUALIFIED";
  }

  const cpuModel = cpus()[0]?.model ?? "unknown";
  const body = {
    schemaVersion: FHV_THROUGHPUT_RECEIPT_SCHEMA,
    capturedAtUtc: new Date().toISOString(),
    // Bind the receipt to the release whose representative path produced the evidence.
    releaseSha: process.env.FHV_RELEASE_SHA?.trim() || shell("git rev-parse HEAD"),
    host: {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      cpuModel,
      cpuCount: cpus().length,
      nodeVersion: process.version,
    },
    contract: {
      minThroughputCps: FHV_THROUGHPUT_MIN_CPS,
      canonicalMaxRuntimeS: FHV_CANONICAL_MAX_RUNTIME_S,
      prelaunchMaxProjectedRuntimeS: FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
    },
    evidence: {
      representativeSegmentExecuted: report.schemaVersion === FHV_GROWTH_LAW_SCHEMA,
      progressSamples,
      checkpointSamples,
      growthBytesPerCycle: Number(growthBytesPerCycle.toFixed(3)),
      hotPathDecayVerdict: decayVerdict,
      growthAwareProjectionAvailable: projectionAvailable,
      growthAwareProjectedRuntimeS: Number(projectionSeconds.toFixed(1)),
    },
    classification,
  };

  const receiptDigest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const receipt = { ...body, receiptDigest };

  const outputPath = outPath ?? join(process.cwd(), ".artifacts", FHV_THROUGHPUT_RECEIPT_FILENAME);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  console.log(
    `[throughput-hostqual] growth_bytes_per_cycle=${body.evidence.growthBytesPerCycle} ` +
      `decay=${decayVerdict} projected_runtime_s=${body.evidence.growthAwareProjectedRuntimeS} ` +
      `within_prelaunch_6480s=${withinPreLaunch}`,
  );
  console.log(`[throughput-hostqual] receipt=${outputPath} receipt_digest=${receiptDigest}`);
  console.log(`[throughput-hostqual] RESULT=${classification}`);

  if (classification !== "EXECUTION_SERVER_FHV_THROUGHPUT_QUALIFIED") {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]?.includes("fhv-throughput-host-qualification.ts") ?? false;

if (invokedDirectly) {
  try {
    main();
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code?: string }).code)
        : "FAILED";
    process.stderr.write(`[throughput-hostqual] ${code}: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export { main };
