import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  type FhvT4aResidualRecoveryBindings,
} from "@/lib/trader/observability/fhv-t4a-residual-recovery-operator";
import {
  fhvT4aResidualRecoveryConfirmAttemptPath,
  fhvT4aResidualRecoveryPreviewReceiptPath,
  readFhvT4aResidualRecoveryConfirmAttempt,
  readFhvT4aResidualRecoveryPreviewReceipt,
  readFhvT4aResidualRecoveryReceipt,
} from "@/lib/trader/observability/fhv-t4-residual-recovery-receipt";
import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  fhvT4aPreauthLedgerDigest,
  readFhvT4aPreauthReceipt,
  writeFhvT4aLocalReleaseReceipt,
  writeFhvT4aPreauthReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import { fhvT4aSupervisorResidualStateDigest } from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";

const ROOT = process.cwd();
const IMPLEMENTATION_SHA = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  .trim()
  .toLowerCase();
const FAILED_SHA = "03d2b1311b4e01bd469f6393bdde0c8aafab7da5";
const FAILED_RUN_ID = "fhv-t4a-20260727t125110z-03d2b13";
const RECOVERY_SCRIPT = "scripts/ops/fhv-t4-supervisor-residual-recovery.sh";
const RELEASE_TAG = "v2026.07.27.residual-test";
const ORIGIN_URL = "https://github.com/oumaster369/waia.git";
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

function recoveryReadyTransport(base: FhvT4aOperatorTransport): FhvT4aOperatorTransport {
  return {
    ...base,
    localGit(args) {
      if (args[0] === "status" && args[1] === "--porcelain=v1") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return { exitCode: 0, stdout: `${IMPLEMENTATION_SHA}\n`, stderr: "" };
      }
      if (args[0] === "rev-parse" && args[1] === `${RELEASE_TAG}^{}`) {
        return { exitCode: 0, stdout: `${IMPLEMENTATION_SHA}\n`, stderr: "" };
      }
      if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
        return { exitCode: 0, stdout: `${ORIGIN_URL}\n`, stderr: "" };
      }
      return base.localGit(args);
    },
  };
}

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
    targetSha: IMPLEMENTATION_SHA,
    releaseTag: RELEASE_TAG,
    originUrl: ORIGIN_URL,
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
  const transport = recoveryReadyTransport(
    createFhvT4aHermeticTransport({
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
    }),
  );
  return { bindings, transport };
}

function recoveryBindings(work: string, overrides: Partial<FhvT4aResidualRecoveryBindings> = {}) {
  const recoveryId = overrides.recoveryId ?? `fhv-t4a-residual-recovery-${Date.now()}`;
  const localGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const localStateDir = overrides.localStateDir ?? join(work, "recovery-state", recoveryId);
  mkdirSync(localStateDir, { recursive: true });
  return {
    execHost: "exec.test",
    sshUser: "operator",
    recoveryId,
    localStateDir,
    localReleaseRoot: ROOT,
    localGitBin,
    originUrl: ORIGIN_URL,
    implementationTargetSha: IMPLEMENTATION_SHA,
    implementationReleaseTag: RELEASE_TAG,
    failedRunId: FAILED_RUN_ID,
    failedTargetSha: FAILED_SHA,
    failedReleaseTag: "v2026.07.27.03d2b13",
    organizationId: "00000000-0000-4000-8000-000000000436",
    operatorId: "operator-test",
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    systemctlBin: "/usr/bin/systemctl",
    pythonBin: "/usr/bin/python3",
    installedUnitsDir: "/etc/systemd/system",
    recoveryAuthorization: FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL,
    ...overrides,
  };
}

function seedRecoveryLocalReleaseReceipt(recovery: FhvT4aResidualRecoveryBindings): void {
  writeFhvT4aLocalReleaseReceipt(recovery.localStateDir, {
    targetSha: recovery.implementationTargetSha,
    releaseTag: recovery.implementationReleaseTag,
    originUrl: recovery.originUrl,
    bootstrapBlobDigests: {},
    bindingDigest: "recovery-local-release-binding-digest",
  });
}

describe("fhv-t4a residual recovery operator (DEE-436)", () => {
  it("proves the old failed SHA does not contain the recovery script (historical only)", () => {
    expect(() =>
      execFileSync("git", ["-C", ROOT, "show", `${FAILED_SHA}:${RECOVERY_SCRIPT}`], {
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("loads recovery code only from the audited implementation SHA", () => {
    const work = trackDir("residual-source-");
    const { transport } = createHermetic(work);
    const recoveryScriptShown: string[] = [];
    const trackingTransport: FhvT4aOperatorTransport = {
      ...transport,
      gitShowBlob(commitSha: string, path: string) {
        if (path === RECOVERY_SCRIPT) {
          recoveryScriptShown.push(commitSha);
        }
        return transport.gitShowBlob(commitSha, path);
      },
    };
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, trackingTransport);
    expect(recoveryScriptShown.every((sha) => sha === IMPLEMENTATION_SHA)).toBe(true);
    expect(recoveryScriptShown.length).toBeGreaterThan(0);
  });

  it("allows failed SHA to contain the script while still fetching executable bytes from implementation SHA", () => {
    const work = trackDir("residual-failed-has-script-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work, {
      failedTargetSha: IMPLEMENTATION_SHA,
      failedReleaseTag: RELEASE_TAG,
    });
    seedRecoveryLocalReleaseReceipt(recovery);
    expect(runFhvT4aResidualRecoveryPreview(recovery, transport)).toBe(
      "FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK",
    );
  });

  it("refuses preview without verify-local-release receipt before SSH", () => {
    const work = trackDir("residual-no-local-release-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    transport.resetRemoteWrites();
    expect(() => runFhvT4aResidualRecoveryPreview(recovery, transport)).toThrow(
      /LOCAL_RELEASE_RECEIPT_MISSING|Local release receipt missing/,
    );
    expect(transport.remoteWriteCount()).toBe(0);
  });

  it("refuses preview when HEAD/tag-peel/origin checks fail before SSH", () => {
    const work = trackDir("residual-head-mismatch-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    const blockedTransport: FhvT4aOperatorTransport = {
      ...transport,
      localGit(args) {
        if (args[0] === "rev-parse" && args[1] === "HEAD") {
          return { exitCode: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
        }
        return transport.localGit(args);
      },
    };
    blockedTransport.resetRemoteWrites();
    expect(() => runFhvT4aResidualRecoveryPreview(recovery, blockedTransport)).toThrow(
      /IMPLEMENTATION_SHA_MISMATCH|HEAD must equal/,
    );
    expect(blockedTransport.remoteWriteCount()).toBe(0);
  });

  it("refuses recovery namespace that collides with failed T4A run state", () => {
    const work = trackDir("residual-namespace-collision-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work, {
      localStateDir: join(work, "t4a", FAILED_RUN_ID),
    });
    seedRecoveryLocalReleaseReceipt(recovery);
    expect(() => runFhvT4aResidualRecoveryPreview(recovery, transport)).toThrow(
      /failed T4A run namespace/,
    );
  });

  it("writes immutable preview receipt before authorization", () => {
    const work = trackDir("residual-preview-receipt-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, transport);
    expect(existsSync(fhvT4aResidualRecoveryPreviewReceiptPath(recovery.localStateDir))).toBe(true);
    const receipt = readFhvT4aResidualRecoveryPreviewReceipt(recovery.localStateDir);
    expect(receipt.recoveryId).toBe(recovery.recoveryId);
    expect(receipt.recoveryImplementationSha).toBe(IMPLEMENTATION_SHA);
    expect(receipt.failedTargetSha).toBe(FAILED_SHA);
    expect(receipt.mutatingCommandCount).toBe(0);
  });

  it("confirm binds to preview receipt and preserves immutable pre-mutation attempt bytes", () => {
    const work = trackDir("residual-confirm-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, transport);
    const preview = readFhvT4aResidualRecoveryPreviewReceipt(recovery.localStateDir);
    expect(runFhvT4aResidualRecoveryConfirm(recovery, transport)).toBe(
      "FHV_T4A_RESIDUAL_RECOVERY_OK",
    );
    const attemptPath = fhvT4aResidualRecoveryConfirmAttemptPath(recovery.localStateDir);
    const attempt = readFhvT4aResidualRecoveryConfirmAttempt(recovery.localStateDir);
    expect(attempt.status).toBe("in_progress");
    expect(JSON.parse(readFileSync(attemptPath, "utf8")).status).toBe("in_progress");
    const finalReceipt = readFhvT4aResidualRecoveryReceipt(recovery.localStateDir);
    expect(finalReceipt.previewReceiptDigest).toBe(preview.contentDigest);
    expect(finalReceipt.confirmAttemptDigest).toBe(attempt.contentDigest);
    expect(finalReceipt.recoveryId).toBe(recovery.recoveryId);
  });

  it("confirm replay performs zero additional remote writes", () => {
    const work = trackDir("residual-replay-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, transport);
    runFhvT4aResidualRecoveryConfirm(recovery, transport);
    const writesAfterFirstConfirm = transport.remoteWriteCount();
    expect(() => runFhvT4aResidualRecoveryConfirm(recovery, transport)).toThrow(
      /Final recovery receipt|FAILURE_RECEIPT_REPLAY|CONFIRM_REPLAY|already exists/,
    );
    expect(transport.remoteWriteCount()).toBe(writesAfterFirstConfirm);
  });

  it("does not write recovery receipts into a failed-run T4A state directory", () => {
    const work = trackDir("residual-failed-run-dir-");
    const failedRunState = join(work, "failed-run-state", FAILED_RUN_ID);
    mkdirSync(failedRunState, { recursive: true });
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work, { localStateDir: join(work, "recovery-state", "ok") });
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, transport);
    expect(
      existsSync(join(failedRunState, "fhv-t4a-residual-recovery-preview-receipt.v1.json")),
    ).toBe(false);
  });

  it("confirm refuses without preview receipt", () => {
    const work = trackDir("residual-no-preview-");
    const { transport } = createHermetic(work);
    expect(() => runFhvT4aResidualRecoveryConfirm(recoveryBindings(work), transport)).toThrow(
      /Preview receipt missing|PREVIEW_RECEIPT_MISSING|Confirm attempt already exists|Final recovery receipt/,
    );
  });

  it("confirm requires exact authorization literal", () => {
    const work = trackDir("residual-auth-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, transport);
    expect(() =>
      runFhvT4aResidualRecoveryConfirm({ ...recovery, recoveryAuthorization: "WRONG" }, transport),
    ).toThrow(FhvT4aOperatorError);
    expect(existsSync(fhvT4aResidualRecoveryConfirmAttemptPath(recovery.localStateDir))).toBe(
      false,
    );
  });

  it("blocks confirm when preview receipt already consumed by attempt marker", () => {
    const work = trackDir("residual-attempt-marker-");
    const { transport } = createHermetic(work);
    const recovery = recoveryBindings(work);
    seedRecoveryLocalReleaseReceipt(recovery);
    runFhvT4aResidualRecoveryPreview(recovery, transport);
    writeFileSync(
      fhvT4aResidualRecoveryConfirmAttemptPath(recovery.localStateDir),
      `${JSON.stringify({ status: "in_progress" })}\n`,
    );
    expect(() => runFhvT4aResidualRecoveryConfirm(recovery, transport)).toThrow(
      /CONFIRM_REPLAY|already exists/,
    );
  });

  it("reads supervisor residual state during PRE_AUTH without mutating commands", () => {
    const work = trackDir("residual-preauth-");
    const { bindings, transport } = createHermetic(work);
    transport.resetRemoteWrites();
    const proof = readFhvT4aSupervisorResidualStateDuringPreauth({ bindings, transport });
    expect(proof.schemaVersion).toBe("fhv-t4-supervisor-residual-state/v1");
    expect(transport.preauthMutatingCommandCount()).toBe(0);
  });

  it("Step 10 hermetic install passes --skip-enable", () => {
    const work = trackDir("residual-step10-");
    const { bindings, transport } = createHermetic(work);
    const ctx = buildFhvT4aExecContext(bindings, transport);
    const result = executeFhvT4aStep(ctx, 10);
    expect(result.classification).toBe("FHV_T4A_STEP_10_OK");
    expect(
      transport.sshInvocations().some((entry) => entry.remoteCommand.includes("--skip-enable")),
    ).toBe(true);
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
      preauthLedgerDigest: fhvT4aPreauthLedgerDigest([]),
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
    expect(readFhvT4aPreauthReceipt(bindings.localStateDir).supervisorResidualClassification).toBe(
      "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE",
    );
  });

  it("documents packet separation and fresh recovery namespace", () => {
    const packet = readFileSync(join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md"), "utf8");
    expect(packet).not.toContain("PR #424");
    expect(packet).toMatch(/FHV_T4A_RESIDUAL_RECOVERY_ID/);
    expect(packet).toMatch(/residual-recovery-state/);
    expect(packet).toMatch(/FHV_T4A_RESIDUAL_RECOVERY_FAILED_TARGET_SHA/);
    expect(packet).toMatch(/fhv-t4a-residual-recovery-preview-receipt/);
  });
});
