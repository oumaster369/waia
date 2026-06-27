/**
 * DEE-337 / NEW-10 — Analyze stdout soak logs for two-strategy paper loop evidence.
 *
 * Usage:
 *   pnpm trader:paper:soak:analyze -- --log=paper-loop-soak.log
 *   pnpm trader:paper:soak:analyze -- --log=paper-loop-soak.log --min-hours=48
 *
 * Log evidence covers: cycle duration proxy, strategy_ids participation, critical=0.
 * Closed-trade proof per strategy requires Postgres book export (see runbook).
 */

import fs from "node:fs";

import {
  analyzePaperSoakLog,
  P5_TWO_STRATEGY_SOAK_IDS,
} from "@/lib/trader/paper/analyze-paper-soak-log";

function printUsage(): void {
  console.log(`Usage:
  pnpm trader:paper:soak:analyze -- --log=<path> [options]

Options:
  --log=<path>              Soak stdout log file (required)
  --min-hours=<n>           Minimum soak hours (default: 48)
  --bar-interval-ms=<ms>    Bar-close cadence (default: 60000)
  --help                    Show this help

Expected strategy IDs (default):
  ${P5_TWO_STRATEGY_SOAK_IDS.join(", ")}

Exit codes:
  0 — log evidence gates pass (duration, both strategies, critical=0)
  1 — analysis failed or gates not met`);
}

function parseArgs(argv: string[]): {
  logPath: string;
  minDurationHours: number;
  barIntervalMs: number;
} {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const logPath = argv
    .find((arg) => arg.startsWith("--log="))
    ?.split("=")[1]
    ?.trim();
  if (!logPath) {
    throw new Error("[trader:paper:soak:analyze] --log=<path> is required");
  }

  const minHoursRaw = argv.find((arg) => arg.startsWith("--min-hours="))?.split("=")[1] ?? "48";
  const minDurationHours = Number.parseFloat(minHoursRaw);
  if (!Number.isFinite(minDurationHours) || minDurationHours <= 0) {
    throw new Error("[trader:paper:soak:analyze] --min-hours must be a positive number");
  }

  const barIntervalRaw =
    argv.find((arg) => arg.startsWith("--bar-interval-ms="))?.split("=")[1] ?? "60000";
  const barIntervalMs = Number.parseInt(barIntervalRaw, 10);
  if (!Number.isFinite(barIntervalMs) || barIntervalMs <= 0) {
    throw new Error("[trader:paper:soak:analyze] --bar-interval-ms must be a positive integer");
  }

  return { logPath, minDurationHours, barIntervalMs };
}

function main(): void {
  const { logPath, minDurationHours, barIntervalMs } = parseArgs(process.argv.slice(2));
  const logContent = fs.readFileSync(logPath, "utf8");
  const analysis = analyzePaperSoakLog({
    logContent,
    minDurationHours,
    barIntervalMs,
  });

  console.log(
    JSON.stringify(
      {
        runbook: "docs/ops/DEE-337-P5-TWO-STRATEGY-AHR-RUNBOOK.md",
        logPath,
        ...analysis,
      },
      null,
      2,
    ),
  );

  if (!analysis.logEvidenceReadyForClosure) {
    console.error(`[trader:paper:soak:analyze] FAIL — ${analysis.blockingReasons.join("; ")}`);
    process.exit(1);
  }

  console.info("[trader:paper:soak:analyze] PASS — log evidence gates satisfied");
}

main();
