/**
 * DEE-424 / DEE-431 / DEE-436 — bounded FHV rehearsal campaign process (systemd supervised).
 */

import { writeFhvCampaignHeartbeat } from "@/lib/trader/observability/fhv-campaign-heartbeat";
import { assertFhvCampaignRuntimeIdentity } from "@/lib/trader/observability/fhv-campaign-runtime-identity";
import { FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import {
  readFhvRehearsalCampaignProgress,
  runFhvRehearsalCampaign,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { readFhvT4CampaignRuntimeProof } from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  assertFhvT4PauseArmedBeforeCampaignStart,
  isFhvT4DeterministicPauseManifest,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import { FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS } from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";

const runRoot = process.env.FHV_RUN_ROOT?.trim();
const runId = process.env.FHV_RUN_ID?.trim();
const organizationId = process.env.FHV_ORGANIZATION_ID?.trim();
const targetSha = process.env.FHV_TARGET_SHA?.trim();
const rehearsalMode = process.env.FHV_REHEARSAL_MODE === "true";

export function classifyFhvCampaignCliExit(input: {
  classification: string;
  t4Deterministic: boolean;
  runRoot: string;
  wallClockStartedAtMs: number;
  maxRuntimeMs: number;
}): { exitCode: number; reason?: string } {
  if (input.classification === "REHEARSAL_OK" || input.classification === "REHEARSAL_PAUSED") {
    if (input.t4Deterministic) {
      const runtime = readFhvT4CampaignRuntimeProof(input.runRoot);
      if (!runtime) {
        return { exitCode: 1, reason: "FHV_T4_CAMPAIGN_RUNTIME_MISSING" };
      }
      const elapsedMs = Number(BigInt(runtime.elapsedMonotonicNs) / 1_000_000n);
      if (elapsedMs > FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS) {
        return { exitCode: 1, reason: "FHV_T4_CAMPAIGN_RUNTIME_BUDGET_EXCEEDED" };
      }
      return { exitCode: 0 };
    }
    const wallElapsedMs = Date.now() - input.wallClockStartedAtMs;
    if (wallElapsedMs > input.maxRuntimeMs) {
      return { exitCode: 1, reason: "REHEARSAL_TIMEOUT" };
    }
    return { exitCode: 0 };
  }
  return { exitCode: 1 };
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

  const manifest = assertFhvCampaignRuntimeIdentity({ runRoot, targetSha, runId, organizationId });
  assertFhvT4PauseArmedBeforeCampaignStart({ runRoot, manifest });
  const t4Deterministic = isFhvT4DeterministicPauseManifest(manifest);
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
    const verdict = classifyFhvCampaignCliExit({
      classification: result.classification,
      t4Deterministic,
      runRoot,
      wallClockStartedAtMs: startedAt,
      maxRuntimeMs: manifest.maxRuntimeMs,
    });
    if (verdict.exitCode !== 0) {
      process.stderr.write(`[fhv-campaign-cli] ${verdict.reason ?? "REHEARSAL_FAILED"}\n`);
      process.exitCode = verdict.exitCode;
      return;
    }
    process.stdout.write(
      `[fhv-campaign-cli] classification=${result.classification} cyclesProcessed=${result.cyclesProcessed} digest=${result.semanticReproDigest.slice(0, 12)}…\n`,
    );
    process.exitCode = 0;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

const invokedDirectly = process.argv[1]?.includes("fhv-campaign-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code?: string }).code)
        : "FAILED";
    process.stderr.write(`[fhv-campaign-cli] ${code}: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
