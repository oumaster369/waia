/**
 * H-ARCH-3 measurement-only profile runner.
 *
 * Usage:
 *   WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server \
 *     scripts/trader/fhv-official-scale-profile-cli.ts [--from-label A-P0-1] [--only-label A-P0-1]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildFhvOfficialScaleHarnessContext,
  executeFhvOfficialScaleProfileRun,
  loadProfileRunMetrics,
  resetProfileRunRoot,
  resolveProfileRoot,
  writeHotspotRegisterAndSummary,
  FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE,
  type ProfileRunMetricsV1,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-harness";
import type { FhvOfficialScaleProfileRunLabel } from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-constants";

function parseArgs(argv: string[]): {
  fromLabel: FhvOfficialScaleProfileRunLabel | null;
  onlyLabel: FhvOfficialScaleProfileRunLabel | null;
  reset: boolean;
} {
  let fromLabel: FhvOfficialScaleProfileRunLabel | null = null;
  let onlyLabel: FhvOfficialScaleProfileRunLabel | null = null;
  let reset = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--from-label") {
      fromLabel = argv[++i] as FhvOfficialScaleProfileRunLabel;
    } else if (arg === "--only-label") {
      onlyLabel = argv[++i] as FhvOfficialScaleProfileRunLabel;
    } else if (arg === "--reset") {
      reset = true;
    }
  }
  return { fromLabel, onlyLabel, reset };
}

function resolveProfilingHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const { fromLabel, onlyLabel, reset } = parseArgs(process.argv.slice(2));
  const profileRoot = resolveProfileRoot();
  mkdirSync(join(profileRoot, "logs"), { recursive: true });
  const harness = buildFhvOfficialScaleHarnessContext();
  const profilingHead = resolveProfilingHead();

  let schedule = [...FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE];
  if (onlyLabel) {
    schedule = schedule.filter((entry) => entry.runLabel === onlyLabel);
  } else if (fromLabel) {
    const idx = schedule.findIndex((entry) => entry.runLabel === fromLabel);
    if (idx < 0) {
      throw new Error(`Unknown --from-label ${fromLabel}`);
    }
    schedule = schedule.slice(idx);
  }

  const completed: ProfileRunMetricsV1[] = [];
  for (const entry of FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE) {
    const metricsPath = join(
      profileRoot,
      "runs",
      entry.runLabel,
      "fhv-official-scale-profile-run-metrics.v1.json",
    );
    if (existsSync(metricsPath) && !schedule.some((s) => s.runLabel === entry.runLabel)) {
      completed.push(loadProfileRunMetrics(profileRoot, entry.runLabel));
    }
  }

  for (const entry of schedule) {
    console.log(
      `[fhv-profile] START ${entry.runLabel} mode=${entry.mode} cycles=${entry.targetCycleCount}`,
    );
    if (reset) {
      resetProfileRunRoot(profileRoot, entry.runLabel);
    }
    const metrics = await executeFhvOfficialScaleProfileRun({
      entry,
      harness,
      profileRoot,
    });
    completed.push(metrics);
    console.log(
      `[fhv-profile] DONE ${entry.runLabel} bars/s=${metrics.barsPerSecond.toFixed(3)} cycles/s=${metrics.cyclesPerSecond.toFixed(3)} wallMs=${metrics.wallTimeMs}`,
    );
    writeFileSync(
      join(profileRoot, "logs", "progress.v1.json"),
      `${JSON.stringify(
        {
          lastCompleted: entry.runLabel,
          completedCount: completed.length,
          profilingHead,
          at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }

  // Reload full set in schedule order for report.
  const allMetrics = FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE.map((entry) =>
    loadProfileRunMetrics(profileRoot, entry.runLabel),
  );

  const terminal = "PR452_OFFICIAL_SCALE_PROFILE_COMPLETE_AWAITING_HUMAN_ARCHITECTURE_DECISION";
  writeHotspotRegisterAndSummary({
    profileRoot,
    profilingHead,
    allMetrics,
    terminalClassification: terminal,
  });
  console.log(`[fhv-profile] ${terminal}`);
  console.log(`[fhv-profile] wrote ${join(profileRoot, "hotspot-register.v1.json")}`);
  console.log(`[fhv-profile] wrote ${join(profileRoot, "profile-summary.v1.json")}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fhv-profile] FAILED: ${message}`);
  process.exitCode = 1;
});
