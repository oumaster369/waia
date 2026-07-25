import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  readFhvResumeRuntimeProof,
  validateFhvResumeRuntimeProof,
} from "@/lib/trader/observability/fhv-resume-runtime-proof";
import { writeFhvCampaignControlRequest } from "@/lib/trader/observability/fhv-campaign-control-files";
import { createRecordingLinuxSystemdCampaignControlExecutor } from "@/lib/trader/observability/fhv-linux-systemd-executor";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FHV_REHEARSAL_CHECKPOINT_CYCLE,
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalTerminalClassification,
  runFhvRehearsalCampaign,
  isFhvResumeFromCheckpointRequested,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  assertFhvT4PauseArmedBeforeCampaignStart,
  FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
  writeFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import { setFhvT4HostMonotonicReaderForTests } from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";
import { validateFhvCanonicalRunChainCompletion } from "@/lib/trader/observability/fhv-canonical-run-chain";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const ORG_ID = "00000000-0000-4000-8000-000000000435";

function prepareT4Run(root: string, runId: string): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId,
    organizationId: ORG_ID,
    artifactRoot: root,
    t4DeterministicPause: true,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

function armDeterministicPause(runDir: string, runId: string): void {
  writeFhvT4PauseArmedRecord(runDir, {
    schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
    runId,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    fixtureId: "HTR_WP03_BENCHMARK",
    deterministicPauseAtCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    commandId: `cmd-${runId}`,
    idempotencyKey: `idem-${runId}`,
    operatorId: "t4-operator",
    armedAtUtc: new Date().toISOString(),
  });
  writeFhvCampaignControlRequest(runDir, {
    schemaVersion: "fhv-campaign-control-request/v1",
    action: "PAUSE_AT_CHECKPOINT",
    runId,
    organizationId: ORG_ID,
    operatorId: "t4-operator",
    reason: "deterministic T4 pre-arm",
    requestedAtUtc: new Date().toISOString(),
  });
}

describe("FHV T4 deterministic pause integration (DEE-435)", () => {
  let monotonicNs = 1_000_000_000n;

  beforeEach(() => {
    monotonicNs = 1_000_000_000n;
    setFhvT4HostMonotonicReaderForTests(() => {
      monotonicNs += 10_000_000n;
      return {
        schemaVersion: "fhv-t4-host-monotonic-sample/v1",
        clockSource: "CLOCK_BOOTTIME",
        bootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        monotonicNs: monotonicNs.toString(),
      };
    });
    process.env.FHV_REPO_ROOT = process.cwd();
  });

  afterEach(() => {
    setFhvT4HostMonotonicReaderForTests(null);
  });

  it.each(Array.from({ length: 10 }, (_, index) => index + 1))(
    "run %i pauses at cycle 40 and resumes to REHEARSAL_OK with zero rescan delta",
    async (iteration) => {
      const root = mkdtempSync(join(tmpdir(), `fhv-t4-integration-${iteration}-`));
      const runId = `fhv-t4-deterministic-${iteration}`;
      try {
        const runDir = prepareT4Run(root, runId);
        const manifest = readFhvRehearsalManifest(runDir);
        armDeterministicPause(runDir, runId);
        assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: runDir, manifest });

        const paused = await runFhvRehearsalCampaign({
          runRoot: runDir,
          runId,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
        });
        expect(paused.classification).toBe("REHEARSAL_PAUSED");
        expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_PAUSED");

        const actualPauseCycle = readFhvRehearsalActualPauseCycle(runDir);
        expect(actualPauseCycle).toBe(FHV_REHEARSAL_CHECKPOINT_CYCLE);

        const checkpoint = readReplayCheckpoint(runDir)!;
        expect(checkpoint.safeResumeThroughCycleIndex + 1).toBe(actualPauseCycle);
        expect(checkpoint.rehearsalEconomicFrontierState?.mode).toBe("QUIESCENT_NO_ECONOMIC_STATE");

        const executor = createRecordingLinuxSystemdCampaignControlExecutor({
          hostOsQualified: true,
          deploymentEnabled: true,
          runRoot: runDir,
        });
        const resumeResult = await executor.execute({
          action: "RESUME_FROM_CHECKPOINT",
          runId,
          organizationId: ORG_ID,
          operatorId: "t4-operator",
          reason: "deterministic T4 resume",
        });
        expect(resumeResult.outcome).toBe("accepted");
        expect(resumeResult.enforcementApplied).toBe(false);
        expect(isFhvResumeFromCheckpointRequested(runDir)).toBe(true);

        const completed = await runFhvRehearsalCampaign({
          runRoot: runDir,
          runId,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
        });
        expect(completed.classification).toBe("REHEARSAL_OK");

        const runtimeProof = readFhvResumeRuntimeProof(runDir);
        expect(runtimeProof).not.toBeNull();
        expect(runtimeProof!.fullHistoryRescanDelta).toBe(0);
        validateFhvResumeRuntimeProof({
          proof: runtimeProof!,
          runId,
          organizationId: ORG_ID,
          expectedProcessPid: runtimeProof!.processPid,
          resumeCycleStartIndex: actualPauseCycle!,
        });
        const canonical = validateFhvCanonicalRunChainCompletion(runDir);
        expect(canonical.ok).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
