import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { readReplayRunChainManifest } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { readReplayRunChainProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { createFhvObserverRuntime } from "@/lib/trader/observability/fhv-observer-runtime";
import type { FhvSystemctlInvocationResult } from "@/lib/trader/observability/fhv-linux-systemd-executor";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvEvidenceHealth } from "@/lib/trader/observability/fhv-observer-core";
import {
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalTerminalClassification,
  runFhvRehearsalCampaign,
  waitForFhvRehearsalCycles,
  type FhvRehearsalCampaignResult,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { resolveFhvCampaignState } from "@/lib/trader/observability/fhv-campaign-state";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import { signFhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  FHV_OBSERVER_AUTH_HEADER,
  sha256Hex,
} from "@/lib/trader/observability/fhv-observer-transport-auth";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-production-composition";
const ORG_ID = "00000000-0000-4000-8000-000000000431";
const COMMAND_SECRET = "fhv-production-composition-command-secret";
const TUNNEL_SECRET = "fhv-production-composition-tunnel-secret";

function buildRuntimeEnv(runDir: string): NodeJS.ProcessEnv {
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
}): ReturnType<typeof signFhvOperatorCommandV1> {
  const issuedAtUtc = new Date().toISOString();
  const expiresAtUtc = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return signFhvOperatorCommandV1(
    {
      schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
      commandId: input.commandId,
      campaignRunId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "production-composition-operator",
      action: input.action,
      reason: "production composition proof",
      issuedAtUtc,
      expiresAtUtc,
      nonce: input.nonce,
      idempotencyKey: input.idempotencyKey,
      expectedCampaignState:
        input.checkpointSeq !== undefined
          ? { phase: "validation", checkpointSeq: input.checkpointSeq }
          : { phase: "validation" },
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

describe("FHV production composition (DEE-431)", () => {
  let root: string;
  let runtime: ReturnType<typeof createFhvObserverRuntime> | null = null;
  let campaignPromise: Promise<FhvRehearsalCampaignResult> | null = null;
  const systemctlCalls: Array<{ args: readonly string[] }> = [];

  afterEach(async () => {
    systemctlCalls.length = 0;
    if (campaignPromise) {
      await campaignPromise.catch(() => undefined);
      campaignPromise = null;
    }
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("wires default production factory, spawn adapter, HTTP auth, state machine, and canonical run-chain", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-production-composition-"));
    const config = buildFhvRehearsalLaunchConfig({
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      artifactRoot: root,
    });
    const runDir = materializeFhvRehearsalManifest(config).runDir;
    const spawnSystemctl = async (
      args: readonly string[],
    ): Promise<FhvSystemctlInvocationResult> => {
      systemctlCalls.push({ args });
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
      env: buildRuntimeEnv(runDir),
      spawnSystemctl,
      tickIntervalMs: 500,
    });
    await runtime.start();
    const baseUrl = `http://127.0.0.1:${runtime.getBoundPort()}`;

    campaignPromise = runFhvRehearsalCampaign({
      runRoot: runDir,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });

    await waitForFhvRehearsalCycles(runDir, 5, { timeoutMs: 120_000, intervalMs: 25 });
    const pauseResult = await postObserverCommand(
      baseUrl,
      signedCommand({
        action: "PAUSE_AT_CHECKPOINT",
        commandId: "prod-pause-1",
        idempotencyKey: "prod-pause-1",
        nonce: "prod-pause-nonce-1",
      }),
    );
    expect(pauseResult.response.status).toBe(200);
    expect(pauseResult.body.status).toBe("executed");

    const paused = await campaignPromise;
    campaignPromise = null;
    expect(paused.classification).toBe("REHEARSAL_PAUSED");
    expect(readFhvRehearsalTerminalClassification(runDir)).toBe("REHEARSAL_PAUSED");

    const pausedSnapshot = resolveFhvCampaignState({
      runRoot: runDir,
      runId: RUN_ID,
      organizationId: ORG_ID,
    });
    expect(pausedSnapshot.state).toBe("PAUSED_RESUMABLE");
    expect(pausedSnapshot.checkpointSeq).toBeGreaterThan(0);

    const resumeResult = await postObserverCommand(
      baseUrl,
      signedCommand({
        action: "RESUME_FROM_CHECKPOINT",
        commandId: "prod-resume-1",
        idempotencyKey: "prod-resume-1",
        nonce: "prod-resume-nonce-1",
        checkpointSeq: pausedSnapshot.checkpointSeq,
      }),
    );
    expect(resumeResult.response.status).toBe(200);
    expect(resumeResult.body.status).toBe("executed");
    expect(systemctlCalls.some((call) => call.args.includes("start"))).toBe(true);

    const completed = await runFhvRehearsalCampaign({
      runRoot: runDir,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    expect(completed.classification).toBe("REHEARSAL_OK");
    expect(readFhvRehearsalCampaignProgress(runDir)?.phase).toBe("completed");

    const runChain = readReplayRunChainManifest(runDir);
    expect(runChain?.segments).toHaveLength(2);
    expect(runChain?.segments.every((segment) => segment.role === "authoritative")).toBe(true);

    const chainRead = readReplayRunChainProjections(runDir);
    expect(chainRead.authoritativeGapCount).toBe(0);
    expect(chainRead.authoritativeDuplicateCount).toBe(0);
    expect(chainRead.authoritativeCycleCount).toBeGreaterThan(0);
    expect(readFhvEvidenceHealth(runDir)).toBe("ok");

    await runtime.stop();
    runtime = null;
  }, 240_000);
});
