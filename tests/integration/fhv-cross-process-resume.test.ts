import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { restoreCanvasFromCheckpoint } from "@/lib/trader/backtest/canvas-checkpoint-integration";
import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  computeSemanticParityDigest,
  readReplayRunChainProjections,
  readSegmentProjections,
} from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  readFhvResumeRuntimeProof,
  validateFhvResumeRuntimeProof,
} from "@/lib/trader/observability/fhv-resume-runtime-proof";
import { canvasStateContentDigest } from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import type { FhvSystemctlInvocationResult } from "@/lib/trader/observability/fhv-linux-systemd-executor";
import { createFhvObserverRuntime } from "@/lib/trader/observability/fhv-observer-runtime";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvEvidenceHealth } from "@/lib/trader/observability/fhv-observer-core";
import { resolveFhvCampaignState } from "@/lib/trader/observability/fhv-campaign-state";
import type { FhvCampaignStateSnapshot } from "@/lib/trader/observability/fhv-campaign-state";
import {
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalProgressSamples,
  readFhvRehearsalTerminalClassification,
  runFhvRehearsalCampaign,
  resolveFhvRehearsalEvidenceDir,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { segmentRole } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { readFhvCampaignHeartbeat } from "@/lib/trader/observability/fhv-campaign-heartbeat";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import { signFhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  FHV_OBSERVER_AUTH_HEADER,
  sha256Hex,
} from "@/lib/trader/observability/fhv-observer-transport-auth";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-cross-process-resume";
const ORG_ID = "00000000-0000-4000-8000-000000000431";
const COMMAND_SECRET = "fhv-cross-process-command-secret";
const TUNNEL_SECRET = "fhv-cross-process-tunnel-secret";
const PAUSE_AFTER_CYCLES = 30;

type CampaignCliResult = Readonly<{
  pid: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

function campaignCliEnv(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FHV_RUN_ROOT: input.runRoot,
    FHV_RUN_ID: input.runId,
    FHV_ORGANIZATION_ID: input.organizationId,
    FHV_TARGET_SHA: input.targetSha,
    FHV_REHEARSAL_MODE: "true",
  };
}

function buildObserverEnv(runDir: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    FHV_RUN_ROOT: runDir,
    FHV_RUN_ID: RUN_ID,
    FHV_ORGANIZATION_ID: ORG_ID,
    FHV_TARGET_SHA: TARGET_SHA,
    FHV_OPERATOR_COMMAND_SECRET: COMMAND_SECRET,
    FHV_OBSERVER_TUNNEL_SECRET: TUNNEL_SECRET,
    FHV_OBSERVER_BIND_HOST: "127.0.0.1",
    FHV_OBSERVER_PORT: "0",
    FHV_HOST_OS_QUALIFIED: "true",
    FHV_COMMAND_ENFORCEMENT_ENABLED: "true",
    FHV_OBSERVER_TICK_INTERVAL_MS: "500",
  };
}

function observerAuthHeader(input: {
  method: string;
  path: string;
  body?: string;
}): Record<string, string> {
  const body = input.body ?? "";
  const payload = {
    method: input.method,
    path: input.path,
    organizationId: ORG_ID,
    campaignRunId: RUN_ID,
    timestampMs: Date.now(),
    nonce: createFhvObserverAuthNonce(),
    bodySha256: sha256Hex(body),
  };
  return {
    [FHV_OBSERVER_AUTH_HEADER]: buildFhvObserverAuthToken(payload, TUNNEL_SECRET),
  };
}

function signedCommand(input: {
  action: "PAUSE_AT_CHECKPOINT" | "RESUME_FROM_CHECKPOINT";
  commandId: string;
  idempotencyKey: string;
  nonce: string;
  checkpointSeq?: number;
  expectedPhase?: string;
}) {
  const issuedAtUtc = new Date().toISOString();
  const expiresAtUtc = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return signFhvOperatorCommandV1(
    {
      schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
      commandId: input.commandId,
      campaignRunId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "cross-process-operator",
      action: input.action,
      reason: "cross-process production-path proof",
      issuedAtUtc,
      expiresAtUtc,
      nonce: input.nonce,
      idempotencyKey: input.idempotencyKey,
      expectedCampaignState:
        input.checkpointSeq !== undefined
          ? { phase: input.expectedPhase ?? "running", checkpointSeq: input.checkpointSeq }
          : { phase: input.expectedPhase ?? "running" },
      confirmationPhraseClass: input.action === "PAUSE_AT_CHECKPOINT" ? "PAUSE" : "RESUME",
    },
    COMMAND_SECRET,
  );
}

async function postObserverCommand(
  baseUrl: string,
  command: ReturnType<typeof signFhvOperatorCommandV1>,
) {
  const path = `/v1/commands?organization_id=${encodeURIComponent(ORG_ID)}&campaign_run_id=${encodeURIComponent(RUN_ID)}`;
  const bodyText = JSON.stringify({ command });
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...observerAuthHeader({ method: "POST", path, body: bodyText }),
      "Content-Type": "application/json",
    },
    body: bodyText,
  });
  return { response, body: (await response.json()) as { status: string; message?: string } };
}

async function waitForCliCampaignCycles(input: {
  runDir: string;
  runId: string;
  organizationId: string;
  minCycles: number;
  childPromise: Promise<CampaignCliResult>;
  timeoutMs?: number;
}): Promise<{ cyclesProcessed: number; snapshot: FhvCampaignStateSnapshot }> {
  const timeoutMs = input.timeoutMs ?? 300_000;
  const started = Date.now();
  const readCyclesProcessed = (): number => {
    const progressCycles = readFhvRehearsalCampaignProgress(input.runDir)?.cyclesProcessed ?? 0;
    const heartbeatCycles = readFhvCampaignHeartbeat(input.runDir)?.cyclesProcessed ?? 0;
    const pauseCycle = readFhvRehearsalActualPauseCycle(input.runDir) ?? 0;
    return Math.max(progressCycles, heartbeatCycles, pauseCycle);
  };
  const readRunningSnapshot = (): FhvCampaignStateSnapshot =>
    resolveFhvCampaignState({
      runRoot: input.runDir,
      runId: input.runId,
      organizationId: input.organizationId,
    });
  const isPauseReady = (snapshot: FhvCampaignStateSnapshot, cyclesProcessed: number): boolean =>
    cyclesProcessed >= input.minCycles &&
    snapshot.state === "RUNNING" &&
    snapshot.phase === "running" &&
    readFhvRehearsalCampaignProgress(input.runDir)?.phase === "running";

  while (Date.now() - started < timeoutMs) {
    const cyclesProcessed = readCyclesProcessed();
    const snapshot = readRunningSnapshot();
    const terminal = readFhvRehearsalTerminalClassification(input.runDir);
    if (isPauseReady(snapshot, cyclesProcessed) || terminal === "REHEARSAL_PAUSED") {
      return { cyclesProcessed, snapshot };
    }
    const settled = await Promise.race([
      input.childPromise.then((result) => ({ kind: "exit" as const, result })),
      new Promise<{ kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 250),
      ),
    ]);
    if (settled.kind === "exit") {
      const exitCycles = readCyclesProcessed();
      const exitSnapshot = readRunningSnapshot();
      const exitTerminal = readFhvRehearsalTerminalClassification(input.runDir);
      if (isPauseReady(exitSnapshot, exitCycles) || exitTerminal === "REHEARSAL_PAUSED") {
        return { cyclesProcessed: exitCycles, snapshot: exitSnapshot };
      }
      throw new Error(
        `Campaign CLI exited before pause-ready state (exit=${settled.result.exitCode}, pid=${settled.result.pid}, cycles=${exitCycles}, state=${exitSnapshot.state}, phase=${exitSnapshot.phase}, terminal=${exitTerminal ?? "none"}). stderr=${settled.result.stderr.slice(0, 1000)} stdout=${settled.result.stdout.slice(0, 500)}`,
      );
    }
  }
  const timedOutSnapshot = readRunningSnapshot();
  throw new Error(
    `Timed out waiting for pause-ready CLI campaign state (cycles=${readCyclesProcessed()}, state=${timedOutSnapshot.state}, phase=${timedOutSnapshot.phase}, progressPhase=${readFhvRehearsalCampaignProgress(input.runDir)?.phase ?? "none"}).`,
  );
}

function formatObserverCommandFailure(input: {
  action: string;
  commandId: string;
  body: { status: string; message?: string };
  snapshot: FhvCampaignStateSnapshot;
  runDir: string;
  processPhase?: string;
  processExitCode?: number;
  processStderr?: string;
}): string {
  return JSON.stringify({
    action: input.action,
    commandId: input.commandId,
    commandStatus: input.body.status,
    rejectionReason: input.body.message ?? "unknown",
    campaignState: input.snapshot.state,
    campaignPhase: input.snapshot.phase,
    checkpointSeq: input.snapshot.checkpointSeq ?? null,
    progressPhase: readFhvRehearsalCampaignProgress(input.runDir)?.phase ?? null,
    progressCycles: readFhvRehearsalCampaignProgress(input.runDir)?.cyclesProcessed ?? null,
    terminalClassification: readFhvRehearsalTerminalClassification(input.runDir),
    processPhase: input.processPhase ?? null,
    processExitCode: input.processExitCode ?? null,
    processStderr: input.processStderr?.slice(0, 1000) ?? null,
  });
}

async function runCampaignCliProcess(env: NodeJS.ProcessEnv): Promise<CampaignCliResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["run", "trader:fhv:campaign"], {
      cwd: process.cwd(),
      env,
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

function collectProjectionEntityIds(
  projections: ReturnType<typeof readSegmentProjections>,
): string[] {
  const ids: string[] = [];
  for (const projection of projections) {
    for (const execution of projection.strategyExecutions) {
      if (execution.signalId) {
        ids.push(execution.signalId);
      }
    }
    const msvId = projection.msv?.msvId;
    if (typeof msvId === "string" && msvId.length > 0) {
      ids.push(msvId);
    }
  }
  return ids;
}

describe("FHV cross-process checkpoint resume (DEE-431)", () => {
  let runtime: ReturnType<typeof createFhvObserverRuntime> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }
  });

  it("proves signed observer pause/resume across two genuine fhv-campaign-cli processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-cross-process-"));
    const systemctlCalls: Array<{ args: readonly string[] }> = [];
    let resumeStartRequested = false;
    try {
      const referenceConfig = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: join(root, "reference"),
      });
      const campaignConfig = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: join(root, "campaign"),
      });
      const referenceDir = materializeFhvRehearsalManifest(referenceConfig).runDir;
      const runDir = materializeFhvRehearsalManifest(campaignConfig).runDir;
      const cliEnv = campaignCliEnv({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });

      const uninterrupted = await runFhvRehearsalCampaign({
        runRoot: referenceDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      const uninterruptedDigest = computeSemanticParityDigest(
        readSegmentProjections(resolveFhvRehearsalEvidenceDir(referenceDir)),
      );

      const spawnSystemctl = async (
        args: readonly string[],
      ): Promise<FhvSystemctlInvocationResult> => {
        systemctlCalls.push({ args });
        if (args[1] === "start") {
          resumeStartRequested = true;
        }
        if (args[1] === "show") {
          return {
            exitCode: 0,
            stdout: "ActiveState=inactive\nResult=success\n",
            stderr: "",
            timedOut: false,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      };

      runtime = createFhvObserverRuntime({
        env: buildObserverEnv(runDir),
        spawnSystemctl,
        tickIntervalMs: 500,
      });
      await runtime.start();
      const baseUrl = `http://127.0.0.1:${runtime.getBoundPort()}`;

      const processAPromise = runCampaignCliProcess(cliEnv);
      await waitForCliCampaignCycles({
        runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        minCycles: PAUSE_AFTER_CYCLES,
        childPromise: processAPromise,
      });
      const pauseSnapshot = resolveFhvCampaignState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
      });
      expect(pauseSnapshot.state).toBe("RUNNING");
      expect(pauseSnapshot.phase).toBe("running");
      const pauseResult = await postObserverCommand(
        baseUrl,
        signedCommand({
          action: "PAUSE_AT_CHECKPOINT",
          commandId: "cross-process-pause",
          idempotencyKey: "cross-process-pause",
          nonce: "cross-process-pause-nonce",
          expectedPhase: pauseSnapshot.phase,
        }),
      );
      expect(pauseResult.response.status).toBe(200);
      expect(
        pauseResult.body.status,
        formatObserverCommandFailure({
          action: "PAUSE_AT_CHECKPOINT",
          commandId: "cross-process-pause",
          body: pauseResult.body,
          snapshot: pauseSnapshot,
          runDir,
          processPhase: "pause-after-running",
        }),
      ).toBe("executed");

      const processA = await processAPromise;
      expect(processA.exitCode).toBe(0);
      expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_PAUSED");

      const actualPauseCycle = readFhvRehearsalActualPauseCycle(runDir);
      expect(actualPauseCycle).toBeGreaterThanOrEqual(PAUSE_AFTER_CYCLES);
      const checkpoint = readReplayCheckpoint(runDir);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.campaignIdentityFrontierState).toBeDefined();
      expect(checkpoint!.campaignIdentityFrontierState!.newIdSeq).toBeGreaterThan(0);
      expect(checkpoint!.campaignIdentityFrontierState!.randomUuidSeq).toBeGreaterThan(0);
      expect(checkpoint!.safeResumeThroughCycleIndex).toBe(actualPauseCycle! - 1);
      expect(checkpoint!.rehearsalEconomicFrontierState).toBeDefined();
      expect(checkpoint!.rehearsalEconomicFrontierState!.totalOrderCount).toBe(0);
      expect(checkpoint!.rehearsalEconomicFrontierState!.openOrderCount).toBe(0);
      expect(checkpoint!.rehearsalEconomicFrontierState!.fillCount).toBe(0);
      expect(checkpoint!.rehearsalEconomicFrontierState!.mode).toBe("QUIESCENT_NO_ECONOMIC_STATE");

      const restored = restoreCanvasFromCheckpoint(runDir, checkpoint!);
      expect(restored).not.toBeUndefined();
      expect(canvasStateContentDigest(restored!)).toBeTruthy();

      const pausedProgress = readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed ?? 0;
      expect(pausedProgress).toBe(actualPauseCycle);

      const pausedSnapshot = resolveFhvCampaignState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
      });
      expect(pausedSnapshot.state).toBe("PAUSED_RESUMABLE");

      const resumeResult = await postObserverCommand(
        baseUrl,
        signedCommand({
          action: "RESUME_FROM_CHECKPOINT",
          commandId: "cross-process-resume",
          idempotencyKey: "cross-process-resume",
          nonce: "cross-process-resume-nonce",
          checkpointSeq: pausedSnapshot.checkpointSeq,
          expectedPhase: pausedSnapshot.phase,
        }),
      );
      expect(resumeResult.response.status).toBe(200);
      expect(
        resumeResult.body.status,
        formatObserverCommandFailure({
          action: "RESUME_FROM_CHECKPOINT",
          commandId: "cross-process-resume",
          body: resumeResult.body,
          snapshot: pausedSnapshot,
          runDir,
          processPhase: "resume-after-pause",
        }),
      ).toBe("executed");
      expect(resumeStartRequested).toBe(true);
      expect(systemctlCalls.some((call) => call.args.includes("start"))).toBe(true);

      const processB = await runCampaignCliProcess(cliEnv);

      expect(processA.pid).toBeGreaterThan(0);
      expect(processB.pid).toBeGreaterThan(0);
      expect(processA.pid).not.toBe(processB.pid);
      expect(processB.exitCode).toBe(0);

      const runtimeProof = readFhvResumeRuntimeProof(runDir);
      expect(runtimeProof).not.toBeNull();
      expect(runtimeProof!.processPid).toBeGreaterThan(0);
      expect(runtimeProof!.processPid).not.toBe(processA.pid);
      validateFhvResumeRuntimeProof({
        proof: runtimeProof!,
        runId: RUN_ID,
        organizationId: ORG_ID,
        expectedProcessPid: runtimeProof!.processPid,
        resumeCycleStartIndex: actualPauseCycle!,
      });
      expect(runtimeProof!.fullHistoryRescanDelta).toBe(0);
      expect(getFullHistoryRescanCount()).toBe(0);
      expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_OK");

      const continuationDir = join(runDir, "streaming-evidence-resume");
      const continuationProjections = readSegmentProjections(continuationDir);
      expect(continuationProjections[0]!.cycleIndex).toBe(actualPauseCycle);
      expect(
        continuationProjections.every((projection) => projection.cycleIndex >= actualPauseCycle!),
      ).toBe(true);

      const partialIds = collectProjectionEntityIds(
        readSegmentProjections(resolveFhvRehearsalEvidenceDir(runDir)),
      );
      const continuationIds = collectProjectionEntityIds(continuationProjections);
      const combinedIds = [...partialIds, ...continuationIds];
      expect(new Set(combinedIds).size).toBe(combinedIds.length);

      const chainRead = readReplayRunChainProjections(runDir);
      expect(chainRead.authoritativeGapCount).toBe(0);
      expect(chainRead.authoritativeDuplicateCount).toBe(0);
      expect(chainRead.authoritativeCycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
      expect(chainRead.semanticParityDigest).toBe(uninterruptedDigest);

      const terminal = resolveFhvCampaignState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
      });
      expect(terminal.state).toBe("COMPLETED_OK");
      expect(readFhvEvidenceHealth(runDir)).toBe("ok");
      expect(chainRead.manifest.segments).toHaveLength(2);
      expect(
        chainRead.manifest.segments.every((segment) => segmentRole(segment) === "authoritative"),
      ).toBe(true);

      const samples = readFhvRehearsalProgressSamples(runDir);
      expect(samples.every((value, index) => index === 0 || value > samples[index - 1]!)).toBe(
        true,
      );
      expect(samples.some((value) => value > pausedProgress)).toBe(true);

      const completedTerminal = JSON.parse(
        readFileSync(join(runDir, "fhv-rehearsal-terminal.v1.json"), "utf8"),
      ) as { semanticReproDigest?: string };
      expect(completedTerminal.semanticReproDigest).toBe(uninterrupted.semanticReproDigest);
    } finally {
      if (runtime) {
        await runtime.stop();
        runtime = null;
      }
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Best-effort temp cleanup; observer/CLI handles may lag on macOS.
      }
    }
  }, 360_000);
});
