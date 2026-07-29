import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFhvT4aExecContext,
  executeFhvT4aStep,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";

const ROOT = process.cwd();
const TARGET_SHA = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const RUN_ID = "fhv-t4a-step21-resume";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const GIT_BIN = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const PYTHON_BIN = process.env.FHV_PYTHON_BIN?.trim() || "/usr/bin/python3";

let cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths = [];
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
    releaseTag: "v2026.07.28.test436",
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
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
  };
}

function createHermeticFixture() {
  const work = trackDir("fhv-step21-work-");
  const bindings = hermeticBindings(work);
  mkdirSync(bindings.checkoutParent, { recursive: true });
  mkdirSync(bindings.artifactRoot, { recursive: true });
  writeFileSync(bindings.environmentFile, "FHV_HOST_OS_QUALIFIED=true\n");
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

function runDirFor(bindings: FhvT4aOperatorBindings): string {
  return join(bindings.artifactRoot, "RI-P7/fhv-ops-rehearsal", bindings.runId);
}

function writeResumeEnforcementProof(bindings: FhvT4aOperatorBindings): void {
  const proofPath = join(runDirFor(bindings), "control/fhv-t4-resume-enforcement-proof.v1.json");
  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(
    proofPath,
    `${JSON.stringify(
      {
        schemaVersion: "fhv-t4-resume-enforcement-proof/v1",
        runId: bindings.runId,
        organizationId: bindings.organizationId,
        targetSha: bindings.targetSha,
        resumeCommandId: "hermetic-resume-cmd",
        resumeIdempotencyKey: "hermetic-resume-key",
        bootId: "boot-test",
        campaignUnitName: "waia-fhv-campaign.service",
        previousInvocationId: "prev-inv",
        newInvocationId: "next-inv",
        execMainPid: 100,
        execMainStartTimestampMonotonic: "1",
        nRestarts: 0,
        enforcedAtUtc: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function mockSuccessfulRootEnforcement(
  bindings: FhvT4aOperatorBindings,
  rootCalls: string[],
): (
  params: Parameters<FhvT4aOperatorTransport["ssh"]>[0],
) => ReturnType<FhvT4aOperatorTransport["ssh"]> | null {
  return (params) => {
    if (/fhv-t4-resume-campaign-root\.sh/.test(params.remoteCommand)) {
      rootCalls.push(params.remoteCommand);
      writeResumeEnforcementProof(bindings);
      return {
        exitCode: 0,
        stdout: "classification=FHV_T4_RESUME_ENFORCEMENT_OK\n",
        stderr: "",
      };
    }
    return null;
  };
}

function wrapTransport(
  inner: FhvT4aOperatorTransport,
  hooks: {
    onSsh?: (
      params: Parameters<FhvT4aOperatorTransport["ssh"]>[0],
    ) => ReturnType<FhvT4aOperatorTransport["ssh"]> | null;
    onReadRemoteFile?: (
      op: Parameters<FhvT4aOperatorTransport["readRemoteFile"]>[0],
    ) => ReturnType<FhvT4aOperatorTransport["readRemoteFile"]> | null;
  },
): FhvT4aOperatorTransport {
  return {
    ...inner,
    ssh: (params) => {
      const override = hooks.onSsh?.(params);
      if (override) {
        return override;
      }
      return inner.ssh(params);
    },
    readRemoteFile: (op) => {
      const override = hooks.onReadRemoteFile?.(op);
      if (override !== null && override !== undefined) {
        return override;
      }
      return inner.readRemoteFile(op);
    },
  };
}

describe("fhv-t4a Step 21 RESUME accepted + root enforcement (DEE-436)", () => {
  it("proceeds to root enforcement when service-user resume returns status=accepted", () => {
    const { bindings, transport } = createHermeticFixture();
    const rootCalls: string[] = [];
    const wrapped = wrapTransport(transport, {
      onSsh: mockSuccessfulRootEnforcement(bindings, rootCalls),
    });
    const ctx = buildFhvT4aExecContext(bindings, wrapped);
    const result = executeFhvT4aStep(ctx, 21);
    expect(result.classification).toBe("FHV_T4A_STEP_21_OK");
    expect(rootCalls).toHaveLength(1);
    expect(rootCalls[0]).toContain(`--run-id '${RUN_ID}'`);
    expect(rootCalls[0]).toContain(`--organization-id '${ORG_ID}'`);
    expect(rootCalls[0]).toContain(`--target-sha '${TARGET_SHA}'`);
    expect(rootCalls[0]).toContain("--repo-root");
    expect(rootCalls[0]).toContain("--systemctl-bin");
    expect(rootCalls[0]).toContain("--node-bin");
  });

  it("never invokes root enforcement when service-user resume fails", () => {
    const { bindings, transport } = createHermeticFixture();
    const rootCalls: string[] = [];
    const wrapped = wrapTransport(transport, {
      onSsh: (params) => {
        if (/fhv-t4-resume-campaign-root\.sh/.test(params.remoteCommand)) {
          rootCalls.push(params.remoteCommand);
        }
        if (/trader:fhv:t4:resume/.test(params.remoteCommand)) {
          return { exitCode: 1, stdout: "status=rejected\n", stderr: "RESUME rejected" };
        }
        return null;
      },
    });
    const ctx = buildFhvT4aExecContext(bindings, wrapped);
    expect(() => executeFhvT4aStep(ctx, 21)).toThrow(FhvT4aOperatorError);
    expect(rootCalls).toHaveLength(0);
  });

  it("fails when resume stdout lacks status=accepted even with exit code 0", () => {
    const { bindings, transport } = createHermeticFixture();
    const rootCalls: string[] = [];
    const wrapped = wrapTransport(transport, {
      onSsh: (params) => {
        if (/fhv-t4-resume-campaign-root\.sh/.test(params.remoteCommand)) {
          rootCalls.push(params.remoteCommand);
        }
        if (/trader:fhv:t4:resume/.test(params.remoteCommand)) {
          return { exitCode: 0, stdout: "status=executed\n", stderr: "" };
        }
        return null;
      },
    });
    const ctx = buildFhvT4aExecContext(bindings, wrapped);
    try {
      executeFhvT4aStep(ctx, 21);
      expect.fail("expected step 21 to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4aOperatorError);
      expect((error as FhvT4aOperatorError).code).toBe("FHV_T4A_STEP_21_RESUME_NOT_ACCEPTED");
    }
    expect(rootCalls).toHaveLength(0);
  });

  it("fails when resume enforcement proof identity mismatches", () => {
    const { bindings, transport } = createHermeticFixture();
    const rootCalls: string[] = [];
    const wrapped = wrapTransport(transport, {
      onSsh: mockSuccessfulRootEnforcement(bindings, rootCalls),
      onReadRemoteFile: (op) => {
        if (op.remotePath.includes("fhv-t4-resume-enforcement-proof.v1.json")) {
          return JSON.stringify({
            runId: "wrong-run-id",
            organizationId: ORG_ID,
            targetSha: TARGET_SHA,
          });
        }
        return null;
      },
    });
    const ctx = buildFhvT4aExecContext(bindings, wrapped);
    try {
      executeFhvT4aStep(ctx, 21);
      expect.fail("expected step 21 to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvT4aOperatorError);
      expect((error as FhvT4aOperatorError).code).toBe(
        "FHV_T4A_STEP_21_ENFORCEMENT_PROOF_IDENTITY",
      );
    }
  });
});
