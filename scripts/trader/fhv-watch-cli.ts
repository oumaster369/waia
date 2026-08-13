/**
 * `pnpm trader:fhv:watch` — human-readable status for a running FHV campaign (WP-9).
 *
 * The observer already writes a complete machine-readable operator status document, but during a
 * multi-hour official run an operator needs to answer "is it alive, how far along, and is anything
 * wrong" in one glance. This renders exactly that from the same document, so it introduces no new
 * source of truth and cannot drift from the observer.
 *
 * Read-only: it never mutates the run, and it never contacts the Execution Server on its own.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";
import { resolveFhvOperatorStatusPath } from "@/lib/trader/observability/fhv-status-writer";

const WATCH_INTERVAL_MS = 10_000;

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatPct(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "unknown" : `${value.toFixed(1)}%`;
}

function render(status: FhvOperatorStatusV1): string {
  const { campaign, host } = status;
  const lines: string[] = [];

  lines.push(`run ${campaign.runId}  phase=${campaign.phase}  state=${campaign.terminalState}`);
  if (campaign.terminalReason) {
    lines.push(`  terminal reason: ${campaign.terminalReason}`);
  }
  lines.push(
    `  progress ${campaign.barsProcessed == null ? "UNAVAILABLE" : campaign.barsProcessed.toLocaleString()}` +
      `${campaign.barsTotal ? ` / ${campaign.barsTotal.toLocaleString()}` : ""} bars` +
      `${campaign.completionPct == null ? "" : `  (${campaign.completionPct.toFixed(2)}%)`}`,
  );
  lines.push(
    `  throughput ${campaign.throughputRolling == null ? "UNAVAILABLE" : `${campaign.throughputRolling.toFixed(1)} cps rolling`}` +
      `${campaign.throughputCurrent == null ? "" : ` (${campaign.throughputCurrent.toFixed(1)} instant)`}` +
      `  elapsed ${formatDuration(campaign.elapsedMs)}` +
      `  eta ${campaign.etaUtc ?? "unknown"}`,
  );
  lines.push(
    `  heartbeat ${campaign.heartbeatState} (${formatDuration(campaign.heartbeatAgeMs)} ago)` +
      `  last checkpoint ${formatDuration(campaign.checkpointAgeMs)} ago` +
      `  restarts ${campaign.processRestartCount ?? "UNAVAILABLE"}`,
  );
  lines.push(
    `  host cpu ${formatPct(host.cpuPct)}  ram ${formatPct(host.ramUsedPct)}` +
      `  disk free ${formatBytes(host.diskFreeBytes)} of ${formatBytes(host.diskTotalBytes)}` +
      `  artifacts ${formatBytes(host.artifactDirBytes)}`,
  );
  lines.push(`  process ${host.processStatus}  service ${host.serviceStatus}`);

  if (status.recentAlerts.length > 0) {
    lines.push(`  alerts (${status.recentAlerts.length} recent):`);
    for (const alert of status.recentAlerts.slice(0, 5)) {
      lines.push(`    - [${alert.atUtc}] ${alert.id} ${alert.label}`);
    }
  } else {
    lines.push("  alerts: none");
  }

  return lines.join("\n");
}

function readStatus(path: string): FhvOperatorStatusV1 | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FhvOperatorStatusV1;
  } catch {
    // A partially written document is expected while the observer is mid-write; the next poll
    // picks up the complete version rather than crashing the operator's watch session.
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const runRootArg = args.find((value) => !value.startsWith("--"));
  const once = args.includes("--once");
  if (!runRootArg) {
    console.error("usage: pnpm trader:fhv:watch <runRoot> [--once]");
    process.exitCode = 2;
    return;
  }

  const statusPath = resolveFhvOperatorStatusPath(resolve(runRootArg));
  const emit = (): void => {
    const status = readStatus(statusPath);
    if (!status) {
      console.log(`[fhv-watch] awaiting observer status at ${statusPath}`);
      return;
    }
    console.log(`[fhv-watch] observed ${status.observedAt}`);
    console.log(render(status));
  };

  emit();
  if (once) return;

  const timer = setInterval(emit, WATCH_INTERVAL_MS);
  const stop = (): void => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main();
