/**
 * DEE-424 / DEE-431 — bounded FHV rehearsal campaign process (systemd supervised).
 */

import { writeFhvCampaignHeartbeat } from "@/lib/trader/observability/fhv-campaign-heartbeat";
import { assertFhvCampaignRuntimeIdentity } from "@/lib/trader/observability/fhv-campaign-runtime-identity";
import { FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import {
  readFhvRehearsalCampaignProgress,
  runFhvRehearsalCampaign,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { assertFhvT4PauseArmedBeforeCampaignStart } from "@/lib/trader/observability/fhv-t4-deterministic-pause";

const runRoot = process.env.FHV_RUN_ROOT?.trim();
const runId = process.env.FHV_RUN_ID?.trim();
const organizationId = process.env.FHV_ORGANIZATION_ID?.trim();
const targetSha = process.env.FHV_TARGET_SHA?.trim();
const rehearsalMode = process.env.FHV_REHEARSAL_MODE === "true";

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

  const manifest = assertFhvCampaignRuntimeIdentity({ runRoot, targetSha, runId, organizationId });
  assertFhvT4PauseArmedBeforeCampaignStart({ runRoot, manifest });
  const startedAt = Date.now();
  let heartbeatSequence = 0;
  let lastCyclesProcessed = 0;

  const heartbeatTimer = setInterval(() => {
    const progress = readFhvRehearsalCampaignProgress(runRoot);
    lastCyclesProcessed = progress?.cyclesProcessed ?? lastCyclesProcessed;
    heartbeatSequence += 1;
    writeFhvCampaignHeartbeat(runRoot, {
      schemaVersion: FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION,
      runId,
      organizationId,
      campaignProcessIdentity: `fhv-campaign-${process.pid}`,
      heartbeatSequence,
      heartbeatAtUtc: new Date().toISOString(),
      cyclesProcessed: lastCyclesProcessed,
      phase: progress?.phase ?? "rehearsal",
    });
  }, 1_000);

  try {
    const result = await runFhvRehearsalCampaign({
      runRoot,
      runId,
      organizationId,
      targetSha: targetSha!,
    });
    lastCyclesProcessed = result.cyclesProcessed;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > manifest.maxRuntimeMs) {
      process.stderr.write("[fhv-campaign-cli] REHEARSAL_TIMEOUT\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `[fhv-campaign-cli] classification=${result.classification} cyclesProcessed=${result.cyclesProcessed} digest=${result.semanticReproDigest.slice(0, 12)}…\n`,
    );
    process.exitCode =
      result.classification === "REHEARSAL_OK"
        ? 0
        : result.classification === "REHEARSAL_PAUSED"
          ? 0
          : 1;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && "code" in error
      ? String((error as { code?: string }).code)
      : "FAILED";
  process.stderr.write(`[fhv-campaign-cli] ${code}: ${String(error)}\n`);
  process.exitCode = 1;
});
