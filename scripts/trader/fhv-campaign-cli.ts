/**
 * DEE-424 — bounded FHV rehearsal campaign process (systemd supervised).
 *
 * Runs allowlisted WP03 benchmark fixture. Rehearsal-only — no live trading.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { runReplayBenchmarkHarness } from "@/lib/trader/backtest/replay-benchmark-harness";
import { writeFhvCampaignHeartbeat } from "@/lib/trader/observability/fhv-campaign-heartbeat";
import { FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import {
  computeFhvRehearsalTerminalClassification,
  FHV_REHEARSAL_MAX_RUNTIME_MS,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const runRoot = process.env.FHV_RUN_ROOT?.trim();
const runId = process.env.FHV_RUN_ID?.trim();
const organizationId = process.env.FHV_ORGANIZATION_ID?.trim();
const rehearsalMode = process.env.FHV_REHEARSAL_MODE === "true";

function readControlPauseRequested(root: string): boolean {
  return existsSync(join(root, "control", "pause_at_checkpoint-request.v1.json"));
}

async function main(): Promise<void> {
  if (!runRoot || !runId || !organizationId) {
    process.stderr.write(
      "[fhv-campaign-cli] FHV_RUN_ROOT, FHV_RUN_ID, FHV_ORGANIZATION_ID required\n",
    );
    process.exit(1);
  }
  if (!rehearsalMode) {
    process.stderr.write("[fhv-campaign-cli] FHV_REHEARSAL_MODE=true is required\n");
    process.exit(1);
  }

  const manifest = readFhvRehearsalManifest(runRoot);
  const startedAt = Date.now();
  let heartbeatSequence = 0;

  const heartbeatTimer = setInterval(() => {
    heartbeatSequence += 1;
    writeFhvCampaignHeartbeat(runRoot, {
      schemaVersion: FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION,
      runId,
      organizationId,
      campaignProcessIdentity: `fhv-campaign-${process.pid}`,
      heartbeatSequence,
      heartbeatAtUtc: new Date().toISOString(),
      barsProcessed: 0,
      phase: readControlPauseRequested(runRoot) ? "paused" : "rehearsal",
    });
  }, 5_000);

  try {
    const harness = await runReplayBenchmarkHarness();
    const classification = computeFhvRehearsalTerminalClassification({
      terminalState: harness.terminalState,
      elapsedMs: Date.now() - startedAt,
      maxRuntimeMs: manifest.maxRuntimeMs ?? FHV_REHEARSAL_MAX_RUNTIME_MS,
    });
    process.stdout.write(
      `[fhv-campaign-cli] terminal=${classification} replayTerminal=${harness.terminalState}\n`,
    );
    process.exitCode = classification === "REHEARSAL_OK" ? 0 : 1;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[fhv-campaign-cli] failed: ${String(error)}\n`);
  process.exitCode = 1;
});
