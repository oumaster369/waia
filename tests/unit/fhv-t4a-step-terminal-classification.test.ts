/**
 * DEE-436 — Steps 4/7 must emit FHV_T4A_STEP_<N>_OK as operator terminal classification.
 *
 * Downstream checkout-identity CLIs emit FHV_T4_CHECKOUT_IDENTITY_OK. Propagating that
 * tool class into the operator step trace violates the Steps 1–32 terminal contract
 * (exitStatus=0 AND terminalClassification=FHV_T4A_STEP_<N>_OK).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import {
  buildFhvT4aExecContext,
  executeFhvT4aStep,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";

let cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanup = [];
});

function bindings(): FhvT4aOperatorBindings {
  const root = mkdtempSync(join(tmpdir(), "fhv-t4a-term-class-"));
  cleanup.push(root);
  const checkoutParent = join(root, "checkouts");
  const artifactRoot = join(root, "artifacts");
  const localStateDir = join(root, "state");
  mkdirSync(checkoutParent, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(localStateDir, { recursive: true });
  const envFile = join(root, "fhv.env");
  writeFileSync(envFile, "FHV_REHEARSAL_MODE=true\n");
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localReleaseRoot: root,
    localStateDir,
    localNodeBin: process.execPath,
    localGitBin: "/usr/bin/git",
    localSshBin: "/usr/bin/ssh",
    targetSha: "c5b3d8008ae1f53c983a71834b1fcae39479a1d5",
    releaseTag: "local-dev",
    originUrl: "https://github.com/oumaster369/waia.git",
    runId: "term-class",
    organizationId: "00000000-0000-4000-8000-000000000436",
    operatorId: "operator-test",
    serviceUser: "fhv",
    environmentFile: envFile,
    artifactRoot,
    checkoutParent,
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    nodeBin: process.execPath,
    corepackBin: process.execPath,
    gitBin: "/usr/bin/git",
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/docker",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
    workstationTracePath: join(localStateDir, "trace.jsonl"),
  };
}

function transportReturning(stdout: string): FhvT4aOperatorTransport {
  return {
    ssh: () => ({ exitCode: 0, stdout, stderr: "" }),
    gitShowBlob: () => "#!/usr/bin/env bash\n",
    remoteFileExists: () => true,
    remoteSha256: () => "b".repeat(64),
    readRemoteFile: () => "{}",
  } as unknown as FhvT4aOperatorTransport;
}

describe("fhv-t4a Steps 4/7 terminal classification (DEE-436)", () => {
  it("Step 4 maps FHV_T4_CHECKOUT_IDENTITY_OK to FHV_T4A_STEP_4_OK", () => {
    const ctx = buildFhvT4aExecContext(
      bindings(),
      transportReturning("classification=FHV_T4_CHECKOUT_IDENTITY_OK\n"),
    );
    const result = executeFhvT4aStep(ctx, 4);
    expect(result.exitCode).toBe(0);
    expect(result.classification).toBe("FHV_T4A_STEP_4_OK");
  });

  it("Step 7 maps FHV_T4_CHECKOUT_IDENTITY_OK to FHV_T4A_STEP_7_OK", () => {
    const ctx = buildFhvT4aExecContext(
      bindings(),
      transportReturning("classification=FHV_T4_CHECKOUT_IDENTITY_OK\n"),
    );
    const result = executeFhvT4aStep(ctx, 7);
    expect(result.exitCode).toBe(0);
    expect(result.classification).toBe("FHV_T4A_STEP_7_OK");
  });

  it("Step 4 rejects unexpected CLI classification", () => {
    const ctx = buildFhvT4aExecContext(
      bindings(),
      transportReturning("classification=SOME_OTHER_OK\n"),
    );
    try {
      executeFhvT4aStep(ctx, 4);
      expect.unreachable("expected classification mismatch");
    } catch (error) {
      expect(error).toMatchObject({
        code: "FHV_T4A_STEP_4_CLASSIFICATION_MISMATCH",
      });
    }
  });
});
