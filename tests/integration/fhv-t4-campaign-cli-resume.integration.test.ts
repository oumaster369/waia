import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  appendFhvCommandLedger,
  writeFhvCommandResult,
} from "@/lib/trader/observability/fhv-command-ledger";
import { writeFhvCampaignControlRequest } from "@/lib/trader/observability/fhv-campaign-control-files";
import { resolveFhvControlRequestDisposition } from "@/lib/trader/observability/fhv-control-request-validator";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FHV_REHEARSAL_CHECKPOINT_CYCLE,
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalTerminalClassification,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  readFhvResumeRuntimeProof,
  validateFhvResumeRuntimeProof,
} from "@/lib/trader/observability/fhv-resume-runtime-proof";
import {
  FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
  writeFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import {
  FHV_T4_PAUSED_PROOF_CLASSIFICATION,
  writeFhvT4PausedVerificationProofAtomic,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";
import { setFhvT4HostMonotonicReaderForTests } from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";
import { validateFhvCanonicalRunChainCompletion } from "@/lib/trader/observability/fhv-canonical-run-chain";
import { createRecordingLinuxSystemdCampaignControlExecutor } from "@/lib/trader/observability/fhv-linux-systemd-executor";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const RELEASE_TAG = "v2026.test.t4-cli-resume";

type CampaignCliResult = Readonly<{
  pid: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

function buildCampaignCliSpawn(env: NodeJS.ProcessEnv) {
  return {
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      "--require",
      "./scripts/trader/trader-cli-server-only-prelude.cjs",
      "--conditions=react-server",
      "scripts/trader/fhv-campaign-cli.ts",
    ],
    env: { ...env, WAIA_TRADER_CLI: "1" },
  };
}

async function runCampaignCliProcess(env: NodeJS.ProcessEnv): Promise<CampaignCliResult> {
  const spawnSpec = buildCampaignCliSpawn(env);
  return await new Promise((resolve, reject) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: process.cwd(),
      env: spawnSpec.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        pid: child.pid ?? -1,
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function campaignCliEnv(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    FHV_RUN_ROOT: input.runRoot,
    FHV_RUN_ID: input.runId,
    FHV_ORGANIZATION_ID: input.organizationId,
    FHV_TARGET_SHA: input.targetSha,
    FHV_REHEARSAL_MODE: "true",
    FHV_REPO_ROOT: process.cwd(),
    FHV_RELEASE_TAG: RELEASE_TAG,
    FHV_T4_HOST_MONOTONIC_JSON: JSON.stringify({
      schemaVersion: "fhv-t4-host-monotonic-sample/v1",
      clockSource: "CLOCK_BOOTTIME",
      bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      monotonicNs: "2000000000",
    }),
    FHV_T4_SERVICE_USER_IDS_JSON: JSON.stringify({
      uid: typeof process.getuid === "function" ? process.getuid() : 1001,
      gid: typeof process.getgid === "function" ? process.getgid() : 1001,
    }),
  };
}

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

function writePausedVerificationProof(runDir: string, runId: string): void {
  const manifest = readFhvRehearsalManifest(runDir);
  const checkpoint = readReplayCheckpoint(runDir);
  writeFhvT4PausedVerificationProofAtomic(runDir, {
    releaseSha: TARGET_SHA,
    releaseTag: RELEASE_TAG,
    runId,
    organizationId: ORG_ID,
    actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    classification: FHV_T4_PAUSED_PROOF_CLASSIFICATION,
    pauseCommandId: `cmd-${runId}`,
    pauseIdempotencyKey: `idem-${runId}`,
    checkpointSafeResumeThroughCycleIndex: checkpoint?.safeResumeThroughCycleIndex ?? 39,
    partialEvidenceTerminal: "STREAMING_EVIDENCE_SEALED_PARTIAL",
    alertPolicyDigest: manifest.alertPolicyDigest,
    checks: ["integration"],
    capturedAtUtc: new Date().toISOString(),
  });
}

function recordAcceptedResumeCommand(
  runDir: string,
  runId: string,
  commandId = "cmd-resume",
): void {
  appendFhvCommandLedger(runDir, {
    recordedAtUtc: new Date().toISOString(),
    source: "test",
    command: {
      schemaVersion: "fhv-operator-command/v1",
      commandId,
      campaignRunId: runId,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      action: "RESUME_FROM_CHECKPOINT",
      reason: "T4 CLI resume integration",
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      nonce: "resume-nonce",
      idempotencyKey: "idem-resume",
      expectedCampaignState: { phase: "PAUSED_RESUMABLE", checkpointSeq: 40 },
      confirmationPhraseClass: "RESUME",
      signature: "test-signature",
      signatureAlgorithm: "HMAC-SHA256",
    },
  });
  writeFhvCommandResult(runDir, {
    schemaVersion: "fhv-command-result/v1",
    commandId,
    idempotencyKey: "idem-resume",
    status: "accepted",
    message: "RESUME accepted; root systemd enforcement required",
    completedAtUtc: new Date().toISOString(),
  });
}

describe("FHV T4 campaign CLI cross-process resume (DEE-436)", () => {
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
  });

  afterEach(() => {
    setFhvT4HostMonotonicReaderForTests(null);
  });

  it("runs production fhv-campaign-cli twice: pause at 40 then resume to REHEARSAL_OK", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-resume-"));
    const runId = "fhv-t4-cli-resume-happy";
    try {
      const runDir = prepareT4Run(root, runId);
      armDeterministicPause(runDir, runId);
      const cliEnv = campaignCliEnv({
        runRoot: runDir,
        runId,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });

      const processA = await runCampaignCliProcess(cliEnv);
      expect(processA.exitCode, processA.stderr).toBe(0);
      expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_PAUSED");
      expect(readFhvRehearsalActualPauseCycle(runDir)).toBe(FHV_REHEARSAL_CHECKPOINT_CYCLE);
      expect(
        resolveFhvControlRequestDisposition({
          runRoot: runDir,
          action: "PAUSE_AT_CHECKPOINT",
          runId,
          organizationId: ORG_ID,
        }),
      ).toBe("consumed");

      writePausedVerificationProof(runDir, runId);
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
        reason: "T4 CLI resume integration",
      });
      expect(resumeResult.outcome).toBe("accepted");
      recordAcceptedResumeCommand(runDir, runId);

      const processB = await runCampaignCliProcess(cliEnv);
      expect(processB.exitCode, processB.stderr).toBe(0);
      expect(processA.pid).not.toBe(processB.pid);
      expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_OK");

      const runtimeProof = readFhvResumeRuntimeProof(runDir);
      expect(runtimeProof).not.toBeNull();
      expect(runtimeProof!.processPid).not.toBe(processA.pid);
      expect(runtimeProof!.fullHistoryRescanDelta).toBe(0);
      validateFhvResumeRuntimeProof({
        proof: runtimeProof!,
        runId,
        organizationId: ORG_ID,
        expectedProcessPid: runtimeProof!.processPid,
        resumeCycleStartIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE,
      });
      expect(getFullHistoryRescanCount()).toBe(0);

      const progress = readFhvRehearsalCampaignProgress(runDir);
      expect(progress?.cyclesProcessed).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
      const canonical = validateFhvCanonicalRunChainCompletion(runDir);
      expect(canonical.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 360_000);

  it("rejects second fhv-campaign-cli when RESUME is not pending", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-no-resume-"));
    const runId = "fhv-t4-cli-no-resume";
    try {
      const runDir = prepareT4Run(root, runId);
      armDeterministicPause(runDir, runId);
      const cliEnv = campaignCliEnv({
        runRoot: runDir,
        runId,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect((await runCampaignCliProcess(cliEnv)).exitCode).toBe(0);
      writePausedVerificationProof(runDir, runId);
      const blocked = await runCampaignCliProcess(cliEnv);
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toMatch(/FHV_T4_PAUSE_REQUEST_MISSING|FHV_T4_RESUME_REQUEST_MISSING/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 360_000);

  it("rejects second fhv-campaign-cli without paused verification proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-no-proof-"));
    const runId = "fhv-t4-cli-no-proof";
    try {
      const runDir = prepareT4Run(root, runId);
      armDeterministicPause(runDir, runId);
      const cliEnv = campaignCliEnv({
        runRoot: runDir,
        runId,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect((await runCampaignCliProcess(cliEnv)).exitCode).toBe(0);
      const executor = createRecordingLinuxSystemdCampaignControlExecutor({
        hostOsQualified: true,
        deploymentEnabled: true,
        runRoot: runDir,
      });
      await executor.execute({
        action: "RESUME_FROM_CHECKPOINT",
        runId,
        organizationId: ORG_ID,
        operatorId: "t4-operator",
        reason: "missing paused proof",
      });
      recordAcceptedResumeCommand(runDir, runId, "cmd-resume-no-proof");
      const blocked = await runCampaignCliProcess(cliEnv);
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toMatch(/FHV_T4_PAUSED_PROOF_MISSING/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 360_000);

  it("rejects initial fhv-campaign-cli without pending PAUSE", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-t4-cli-no-pause-"));
    const runId = "fhv-t4-cli-no-pause";
    try {
      const runDir = prepareT4Run(root, runId);
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
      const blocked = await runCampaignCliProcess(
        campaignCliEnv({
          runRoot: runDir,
          runId,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
        }),
      );
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toMatch(/FHV_T4_PAUSE_REQUEST_MISSING/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
