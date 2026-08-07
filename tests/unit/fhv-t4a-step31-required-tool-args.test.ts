/**
 * DEE-436 — Step 31 required tool argv regression (hermetic service-user boundary).
 *
 * Proves trader:fhv:t4:verify-continuity receives explicit --systemctl-bin / --python-bin
 * through executeFhvT4aStep → serviceUserExec → real continuity CLI resolve/requireIdentity,
 * without inheriting workstation FHV_SYSTEMCTL_BIN / FHV_PYTHON_BIN.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import { resolveFhvRehearsalAlertPolicyDigest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { captureFhvT4ContinuitySnapshot } from "@/lib/trader/observability/fhv-t4-continuity-capture";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import {
  buildFhvT4aExecContext,
  executeFhvT4aStep,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import {
  resolveFhvT4ContinuityCliConfig,
  runFhvT4ContinuityCli,
} from "@/scripts/trader/fhv-t4-continuity-cli";
import {
  fhvT4CompletedCampaignIdentity,
  fhvT4ObserverIdentity,
  writeFhvT4TestCampaignRuntimeProof,
} from "../helpers/fhv-t4-test-fixtures";

const ROOT = process.cwd();
const TARGET_SHA = "df8181b2bd7349a4bfe341e892160cfb2a93623d";
const RUN_ID = "fhv-t4a-step31-tool-args";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const GIT_BIN = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const SYSTEMCTL_BIN = "/usr/bin/systemctl";
const PYTHON_BIN = "/usr/bin/python3";

let cleanupPaths: string[] = [];
let savedSystemctl: string | undefined;
let savedPython: string | undefined;

beforeEach(() => {
  savedSystemctl = process.env.FHV_SYSTEMCTL_BIN;
  savedPython = process.env.FHV_PYTHON_BIN;
  delete process.env.FHV_SYSTEMCTL_BIN;
  delete process.env.FHV_PYTHON_BIN;
});

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths = [];
  if (savedSystemctl === undefined) {
    delete process.env.FHV_SYSTEMCTL_BIN;
  } else {
    process.env.FHV_SYSTEMCTL_BIN = savedSystemctl;
  }
  if (savedPython === undefined) {
    delete process.env.FHV_PYTHON_BIN;
  } else {
    process.env.FHV_PYTHON_BIN = savedPython;
  }
});

function trackDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

function hermeticBindings(work: string): FhvT4aOperatorBindings {
  const localStateDir = join(work, "state");
  mkdirSync(localStateDir, { recursive: true });
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localReleaseRoot: join(work, "release"),
    localStateDir,
    localNodeBin: process.execPath,
    localGitBin: GIT_BIN,
    localSshBin: execFileSync("which", ["ssh"], { encoding: "utf8" }).trim(),
    targetSha: TARGET_SHA,
    releaseTag: "v2026.07.31.df8181b",
    originUrl: "https://github.com/oumaster369/waia.git",
    runId: RUN_ID,
    organizationId: ORG_ID,
    operatorId: "operator-test",
    serviceUser: "waia-fhv",
    environmentFile: join(work, "fhv.env"),
    artifactRoot: join(work, "artifacts"),
    checkoutParent: join(work, "checkouts"),
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    workstationTracePath: join(localStateDir, "trace.jsonl"),
    nodeBin: process.execPath,
    corepackBin: process.execPath,
    gitBin: GIT_BIN,
    pythonBin: PYTHON_BIN,
    dockerBin: "/usr/bin/false",
    systemctlBin: SYSTEMCTL_BIN,
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
  };
}

function createHermeticFixture() {
  const work = trackDir("fhv-step31-work-");
  const bindings = hermeticBindings(work);
  mkdirSync(bindings.checkoutParent, { recursive: true });
  mkdirSync(bindings.artifactRoot, { recursive: true });
  writeFileSync(
    bindings.environmentFile,
    [
      "FHV_HOST_OS_QUALIFIED=true",
      "FHV_COMMAND_ENFORCEMENT_ENABLED=true",
      "FHV_OPERATOR_COMMAND_SECRET=test-secret",
      "FHV_OBSERVER_TUNNEL_SECRET=test-tunnel",
      "",
    ].join("\n"),
  );
  const transport = createFhvT4aHermeticTransport({
    localReleaseRoot: ROOT,
    targetSha: bindings.targetSha,
    releaseTag: bindings.releaseTag,
    originUrl: bindings.originUrl,
    serviceUser: bindings.serviceUser,
    serviceUserHome: join(work, "home"),
    checkoutParent: bindings.checkoutParent,
    artifactRoot: bindings.artifactRoot,
    environmentFile: bindings.environmentFile,
    runId: bindings.runId,
    organizationId: bindings.organizationId,
    nodeBin: bindings.nodeBin,
    corepackBin: bindings.corepackBin,
    gitBin: bindings.gitBin,
    pythonBin: bindings.pythonBin,
    dockerBin: bindings.dockerBin,
    systemctlBin: bindings.systemctlBin,
    systemdAnalyzeBin: bindings.systemdAnalyzeBin,
    operatorId: bindings.operatorId,
  });
  return { bindings, transport, work };
}

function writeContinuityPair(ctx: ReturnType<typeof buildFhvT4aExecContext>): void {
  const runDir = ctx.runDir;
  const repoRoot = ctx.repoRoot;
  mkdirSync(join(runDir, "control"), { recursive: true });
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(
    join(runDir, "fhv-rehearsal-manifest.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: "fhv-rehearsal-launch/v1",
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: ctx.bindings.artifactRoot,
        alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
        maxRuntimeMs: 300_000,
        t4DeterministicPause: true,
        deterministicPauseAtCycle: 40,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(runDir, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
  );
  writeFileSync(
    join(runDir, "replay-checkpoint.json"),
    `${JSON.stringify(
      {
        rehearsalEconomicFrontierState: {
          mode: "QUIESCENT_NO_ECONOMIC_STATE",
          runId: RUN_ID,
          organizationId: ORG_ID,
          safeResumeThroughCycleIndex: 39,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(runDir, "fhv-resume-runtime-proof.v1.json"),
    `${JSON.stringify({ fullHistoryRescanDelta: 0 }, null, 2)}\n`,
  );
  writeFileSync(
    join(runDir, "run-chain.json"),
    `${JSON.stringify({ schemaVersion: "htr-wp05-run-chain/v1", segments: [] }, null, 2)}\n`,
  );
  writeFileSync(
    join(runDir, "control/command-ledger.jsonl"),
    `${JSON.stringify({ command: { action: "PAUSE_AT_CHECKPOINT" } })}\n`,
  );
  writeFhvT4TestCampaignRuntimeProof(runDir, {
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
  });
  writeFhvSystemdDeployedRevisionAtomic(repoRoot, {
    releaseSha: TARGET_SHA,
    releaseTag: ctx.bindings.releaseTag,
    runId: RUN_ID,
    organizationId: ORG_ID,
    renderedUnitDigests: {
      [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
      [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
    },
    installedAtUtc: new Date().toISOString(),
    operatorId: ctx.bindings.operatorId,
    serviceUser: ctx.bindings.serviceUser,
    legacyContainerRunning: true,
  });

  const campaign = fhvT4CompletedCampaignIdentity({});
  writeFileSync(
    ctx.continuityBefore,
    `${JSON.stringify(
      captureFhvT4ContinuitySnapshot({
        runRoot: runDir,
        repoRoot,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        capturePhase: "before_disconnect",
        observerSystemdIdentity: fhvT4ObserverIdentity({
          invocationId: "11111111111111111111111111111111",
          mainPid: 100,
        }),
        campaignSystemdIdentity: campaign,
        operatorNarrativeEvent: "SSH_DISCONNECT",
      }),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    ctx.continuityAfter,
    `${JSON.stringify(
      captureFhvT4ContinuitySnapshot({
        runRoot: runDir,
        repoRoot,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        capturePhase: "after_reconnect",
        observerSystemdIdentity: fhvT4ObserverIdentity({
          invocationId: "22222222222222222222222222222222",
          mainPid: 200,
        }),
        campaignSystemdIdentity: campaign,
        operatorNarrativeEvent: "SSH_RECONNECT",
      }),
      null,
      2,
    )}\n`,
  );
}

describe("fhv-t4a Step 31 required tool argv (DEE-436)", () => {
  it("fail-closed: real continuity CLI requireIdentity rejects missing tool bins under scrubbed env", async () => {
    expect(process.env.FHV_SYSTEMCTL_BIN).toBeUndefined();
    expect(process.env.FHV_PYTHON_BIN).toBeUndefined();
    const config = resolveFhvT4ContinuityCliConfig({ ...process.env }, [
      "verify",
      "--run-root",
      "/tmp/unused",
      "--run-id",
      RUN_ID,
      "--organization-id",
      ORG_ID,
      "--target-sha",
      TARGET_SHA,
      "--before",
      "/tmp/before.json",
      "--after",
      "/tmp/after.json",
    ]);
    const result = await runFhvT4ContinuityCli(config);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("FHV_T4_CONTINUITY_CONFIG_INCOMPLETE");
    expect(result.lines.join("\n")).toContain("--systemctl-bin, --python-bin required");
  });

  it("executeFhvT4aStep(31) passes exact bindings through hermetic service-user boundary to real CLI", () => {
    expect(process.env.FHV_SYSTEMCTL_BIN).toBeUndefined();
    expect(process.env.FHV_PYTHON_BIN).toBeUndefined();

    const { bindings, transport } = createHermeticFixture();
    const ctx = buildFhvT4aExecContext(bindings, transport);
    writeContinuityPair(ctx);

    const result = executeFhvT4aStep(ctx, 31);

    expect(result.exitCode).toBe(0);
    expect(result.classification).toBe("FHV_T4A_STEP_31_OK");
    expect(result.continuityVerificationProofPath).toBeTruthy();
    expect(result.continuityVerificationProofDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      existsSync(join(ctx.runDir, "control/fhv-t4-continuity-verification-proof.v1.json")),
    ).toBe(true);

    const verifyCmd = transport
      .sshInvocations()
      .map((invocation) => invocation.remoteCommand)
      .find((cmd) => cmd.includes("trader:fhv:t4:verify-continuity"));
    expect(verifyCmd).toBeTruthy();
    // serviceUserExec shell-quotes each argv token independently.
    expect(verifyCmd).toContain(`'--systemctl-bin' '${SYSTEMCTL_BIN}'`);
    expect(verifyCmd).toContain(`'--python-bin' '${PYTHON_BIN}'`);
    expect(verifyCmd).not.toMatch(/FHV_SYSTEMCTL_BIN=/);
    expect(verifyCmd).not.toMatch(/FHV_PYTHON_BIN=/);
  });

  it("defective identity-only verify argv reproduces FHV_T4_CONTINUITY_CONFIG_INCOMPLETE", async () => {
    expect(process.env.FHV_SYSTEMCTL_BIN).toBeUndefined();
    expect(process.env.FHV_PYTHON_BIN).toBeUndefined();

    const { bindings, transport } = createHermeticFixture();
    const ctx = buildFhvT4aExecContext(bindings, transport);
    writeContinuityPair(ctx);

    // Exact pre-fix Step 31 argv surface (identity + before/after only).
    const config = resolveFhvT4ContinuityCliConfig({ ...process.env }, [
      "verify",
      "--run-root",
      ctx.runDir,
      "--run-id",
      bindings.runId,
      "--organization-id",
      bindings.organizationId,
      "--target-sha",
      bindings.targetSha,
      "--before",
      ctx.continuityBefore,
      "--after",
      ctx.continuityAfter,
    ]);
    const cliResult = await runFhvT4ContinuityCli(config);
    expect(cliResult.exitCode).toBe(1);
    expect(cliResult.lines.join("\n")).toContain("FHV_T4_CONTINUITY_CONFIG_INCOMPLETE");
    expect(cliResult.lines.join("\n")).toContain("--systemctl-bin, --python-bin required");
  });
});
