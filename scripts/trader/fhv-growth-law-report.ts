/**
 * WP-4 — FHV growth-law and hotspot report (schema v2).
 *
 * Usage:
 *   node --import tsx scripts/trader/fhv-growth-law-report.ts \
 *     --run-dir <fhv run dir> [--repo-path <checkout>] [--cost-model <path>] [--stage-profile <path>] [--out <path>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildFhvGrowthLawReportV2,
  FhvGrowthLawReportError,
} from "@/lib/trader/observability/fhv-growth-law-report";
import { FHV_GROWTH_LAW_REPORT_FILENAME } from "@/lib/trader/observability/fhv-growth-law";
import { join } from "node:path";

function parseArgs(argv: string[]): {
  runDir: string;
  repoPath: string;
  expectedHeadSha: string | null;
  costModelPath: string | null;
  stageProfilePath: string | null;
  outPath: string | null;
} {
  let runDir = "";
  let repoPath = process.cwd();
  let expectedHeadSha: string | null = null;
  let costModelPath: string | null = null;
  let stageProfilePath: string | null = null;
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--repo-path") {
      repoPath = argv[++i] ?? process.cwd();
    } else if (arg === "--expected-head-sha") {
      expectedHeadSha = argv[++i] ?? null;
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
  return { runDir, repoPath, expectedHeadSha, costModelPath, stageProfilePath, outPath };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = buildFhvGrowthLawReportV2({
    runDir: args.runDir,
    repoPath: args.repoPath,
    ...(args.expectedHeadSha ? { expectedHeadSha: args.expectedHeadSha } : {}),
    costModelPath: args.costModelPath,
    stageProfilePath: args.stageProfilePath,
  });
  const destination = args.outPath ?? join(args.runDir, FHV_GROWTH_LAW_REPORT_FILENAME);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`[fhv-growth-law] wrote ${destination}`);
}

try {
  main();
} catch (error: unknown) {
  const code = error instanceof FhvGrowthLawReportError ? error.code : "FAILED";
  process.stderr.write(`[fhv-growth-law] ${code}: ${String(error)}\n`);
  process.exitCode = 1;
}
