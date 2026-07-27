import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";
import {
  executeFhvT4aStep,
  buildFhvT4aExecContext,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import {
  readFhvT4aSupervisorResidualStateDuringPreauth,
  runFhvT4aResidualRecoveryConfirm,
  runFhvT4aResidualRecoveryPreview,
} from "@/lib/trader/observability/fhv-t4a-residual-recovery-operator";
import {
  readFhvT4aResidualRecoveryReceipt,
  writeFhvT4aResidualRecoveryReceipt,
} from "@/lib/trader/observability/fhv-t4-residual-recovery-receipt";
import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import {
  readFhvT4aPreauthReceipt,
  writeFhvT4aPreauthReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import { fhvT4aSupervisorResidualStateDigest } from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";

const ROOT = process.cwd();
const TARGET_SHA = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const tempDirs: string[] = [];

function trackDir(prefix: string): string {
  const dir = join(
    ROOT,
    ".tmp-test",
    `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    execFileSync("rm", ["-rf", dir], { stdio: "pipe" });
  }
});

function hermeticBindings(work: string): FhvT4aOperatorBindings {
  const localStateDir = join(work, "state");
  mkdirSync(localStateDir, { recursive: true });
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localReleaseRoot: ROOT,
    localStateDir,
    localNodeBin: process.execPath,
    localGitBin: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    localSshBin: execFileSync("which", ["ssh"], { encoding: "utf8" }).trim(),
    targetSha: TARGET_SHA,
    releaseTag: "v2026.07.27.residual-test",
    originUrl: "https://github.com/oumaster369/waia.git",
    runId: "fhv-t4a-residual-recovery-test",
    organizationId: "00000000-0000-4000-8000-000000000436",
    operatorId: "operator-test",
    serviceUser: "waia-fhv",
    environmentFile: join(work, "fhv.env"),
    artifactRoot: join(work, "artifacts"),
    checkoutParent: join(work, "checkouts"),
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    workstationTracePath: join(localStateDir, "trace.jsonl"),
    nodeBin: process.execPath,
    corepackBin: "/usr/bin/corepack",
    gitBin: execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/false",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
  };
}

function createHermetic(work: string) {
  const bindings = hermeticBindings(work);
  mkdirSync(bindings.checkoutParent, { recursive: true });
  mkdirSync(bindings.artifactRoot, { recursive: true });
  writeFileSync(bindings.environmentFile, "FHV_TEST=1\n");
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
  return { bindings, transport };
}

function recoveryBindings(work: string) {
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localStateDir: join(work, "state"),
    failedRunId: "fhv-t4a-20260727t125110z-03d2b13",
    failedTargetSha: TARGET_SHA,
    failedReleaseTag: "v2026.07.27.03d2b13",
    organizationId: "00000000-0000-4000-8000-000000000436",
    operatorId: "operator-test",
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    systemctlBin: "/usr/bin/systemctl",
    pythonBin: "/usr/bin/python3",
    installedUnitsDir: "/etc/systemd/system",
    recoveryAuthorization: FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL,
  };
}

describe("fhv-t4a residual recovery operator (DEE-436)", () => {
  it("reads supervisor residual state during PRE_AUTH without mutating commands", () => {
    const work = trackDir("residual-preauth-");
    const { bindings, transport } = createHermetic(work);
    transport.resetRemoteWrites();
    const proof = readFhvT4aSupervisorResidualStateDuringPreauth({ bindings, transport });
    expect(proof.schemaVersion).toBe("fhv-t4-supervisor-residual-state/v1");
    expect(proof.units).toHaveLength(2);
    expect(transport.preauthMutatingCommandCount()).toBe(0);
  });

  it("recovery preview performs zero remote writes", () => {
    const work = trackDir("residual-preview-");
    const { transport } = createHermetic(work);
    transport.resetRemoteWrites();
    const classification = runFhvT4aResidualRecoveryPreview(recoveryBindings(work), transport);
    expect(classification).toBe("FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK");
    expect(transport.remoteWriteCount()).toBe(0);
  });

  it("recovery confirm requires exact authorization literal", () => {
    const work = trackDir("residual-auth-");
    const { transport } = createHermetic(work);
    expect(() =>
      runFhvT4aResidualRecoveryConfirm(
        { ...recoveryBindings(work), recoveryAuthorization: "WRONG" },
        transport,
      ),
    ).toThrow(FhvT4aOperatorError);
  });

  it("recovery confirm writes immutable receipt and refuses replay", () => {
    const work = trackDir("residual-confirm-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    expect(runFhvT4aResidualRecoveryConfirm(recovery, transport)).toBe(
      "FHV_T4A_RESIDUAL_RECOVERY_OK",
    );
    const receipt = readFhvT4aResidualRecoveryReceipt(recovery.localStateDir);
    expect(receipt.classification).toBe("FHV_T4A_RESIDUAL_RECOVERY_OK");
    expect(receipt.beforeState.units).toHaveLength(2);
    expect(receipt.afterState.units.every((unit) => unit.enabledState === "disabled")).toBe(true);
    expect(() =>
      writeFhvT4aResidualRecoveryReceipt(recovery.localStateDir, {
        failedRunId: recovery.failedRunId,
        failedTargetSha: recovery.failedTargetSha,
        failedReleaseTag: recovery.failedReleaseTag,
        organizationId: recovery.organizationId,
        operatorId: recovery.operatorId,
        execHost: recovery.execHost,
        sshUser: recovery.sshUser,
        hostBootId: receipt.hostBootId,
        beforeState: receipt.beforeState,
        afterState: receipt.afterState,
        recoveryPayloadDigest: receipt.recoveryPayloadDigest,
      }),
    ).toThrow(/REPLAY/);
  });

  it("Step 10 hermetic install passes --skip-enable", () => {
    const work = trackDir("residual-step10-");
    const { bindings, transport } = createHermetic(work);
    const ctx = buildFhvT4aExecContext(bindings, transport);
    transport.resetRemoteWrites();
    const result = executeFhvT4aStep(ctx, 10);
    expect(result.classification).toBe("FHV_T4A_STEP_10_OK");
    const installCmd = transport
      .sshInvocations()
      .map((entry) => entry.remoteCommand)
      .find((cmd) => cmd.includes("install-units.sh"));
    expect(installCmd).toContain("--skip-enable");
  });

  it("Steps 14 and 18 hermetic paths enable and start governed units", () => {
    const work = trackDir("residual-step14-18-");
    const { bindings, transport } = createHermetic(work);
    const ctx = buildFhvT4aExecContext(bindings, transport);
    for (const step of [14, 18] as const) {
      transport.resetRemoteWrites();
      const result = executeFhvT4aStep(ctx, step);
      expect(result.classification).toBe(`FHV_T4A_STEP_${step}_OK`);
      const cmd = transport
        .sshInvocations()
        .map((entry) => entry.remoteCommand)
        .find((entry) => entry.includes("systemctl") && entry.includes("enable"));
      expect(cmd).toMatch(/enable waia-fhv-(observer|campaign)\.service/);
      expect(cmd).toMatch(/start waia-fhv-(observer|campaign)\.service/);
    }
  });

  it("PRE_AUTH receipt binds supervisor residual proof immutably", () => {
    const work = trackDir("residual-receipt-");
    const { bindings, transport } = createHermetic(work);
    const proof = readFhvT4aSupervisorResidualStateDuringPreauth({ bindings, transport });
    writeFhvT4aPreauthReceipt(bindings.localStateDir, {
      targetSha: bindings.targetSha,
      releaseTag: bindings.releaseTag,
      originUrl: bindings.originUrl,
      execHost: bindings.execHost,
      sshUser: bindings.sshUser,
      expectedHostname: bindings.expectedHostname,
      expectedMachineIdSha256: bindings.expectedMachineIdSha256,
      serviceUser: bindings.serviceUser,
      serviceUid: 1001,
      serviceGid: 1001,
      runId: bindings.runId,
      organizationId: bindings.organizationId,
      nodeBin: bindings.nodeBin,
      corepackBin: bindings.corepackBin,
      gitBin: bindings.gitBin,
      pythonBin: bindings.pythonBin,
      dockerBin: bindings.dockerBin,
      systemctlBin: bindings.systemctlBin,
      systemdAnalyzeBin: bindings.systemdAnalyzeBin,
      bootstrapBlobDigests: {},
      bindingDigest: "b".repeat(64),
      preauthLedger: [],
      preauthLedgerDigest: "c".repeat(64),
      rejectedCommandCount: 0,
      mutatingCommandCount: 0,
      preflightHostFacts: {
        hostname: "exec.test",
        machineIdSha256: "a".repeat(64),
        serviceUser: bindings.serviceUser,
        serviceUid: 1001,
        serviceGid: 1001,
        servicePrimaryGroup: bindings.serviceUser,
        environmentFile: bindings.environmentFile,
        artifactRoot: bindings.artifactRoot,
        checkoutParent: bindings.checkoutParent,
        nodeBin: bindings.nodeBin,
        corepackBin: bindings.corepackBin,
        gitBin: bindings.gitBin,
        pythonBin: bindings.pythonBin,
        dockerBin: bindings.dockerBin,
        systemctlBin: bindings.systemctlBin,
        systemdAnalyzeBin: bindings.systemdAnalyzeBin,
        legacyContainerName: "ai-trader-execution-host",
        legacyContainerImage: "waia-execution-host:bp6",
        legacyContainerState: "running",
        hostBootId: "boot-id",
        minimumFreeKiB: 1,
        observedFreeKiB: 2,
        hostMonotonicSample: {},
      },
      supervisorResidualState: proof,
      supervisorResidualStateDigest: fhvT4aSupervisorResidualStateDigest(proof),
      supervisorResidualClassification: "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE",
    });
    const receipt = readFhvT4aPreauthReceipt(bindings.localStateDir);
    expect(receipt.supervisorResidualClassification).toBe("FHV_T4A_SUPERVISOR_RESIDUAL_SAFE");
  });

  it("residual read scripts never emit environment-file contents", () => {
    const readScript = readFileSync(
      join(ROOT, "scripts/ops/fhv-t4-supervisor-residual-state-read.sh"),
      "utf8",
    );
    const recoveryScript = readFileSync(
      join(ROOT, "scripts/ops/fhv-t4-supervisor-residual-recovery.sh"),
      "utf8",
    );
    expect(readScript).toMatch(/Never reads environment-file contents/);
    expect(readScript).not.toMatch(/cat\s+.*fhv\.env/);
    expect(recoveryScript).not.toMatch(/cat\s+.*fhv\.env/);
  });
});
