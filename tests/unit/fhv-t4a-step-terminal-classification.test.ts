/**
 * DEE-436 — Steps 4/7 operator terminal classification must match real CLI classes.
 *
 * Step 4 shell (`fhv-release-checkout-identity.sh`) emits FHV_T4_CHECKOUT_IDENTITY_OK.
 * Step 7 package (`trader:fhv:t4:record-checkout-identity` → fhv-t4-closure-cli) emits
 * FHV_T4_CHECKOUT_IDENTITY_PROOF_OK and writes control/fhv-t4-checkout-identity.v1.json.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import {
  buildFhvT4aExecContext,
  executeFhvT4aStep,
} from "@/lib/trader/observability/fhv-t4a-operator-executor";
import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import { verifyFhvT4CheckoutIdentityProofArtifact } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import {
  resolveFhvT4ClosureCliConfig,
  runFhvT4ClosureCli,
} from "@/scripts/trader/fhv-t4-closure-cli";

const ROOT = process.cwd();
const GIT_BIN = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

let cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.reverse()) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanup = [];
});

function track(path: string): string {
  cleanup.push(path);
  return path;
}

function bindings(overrides: Partial<FhvT4aOperatorBindings> = {}): FhvT4aOperatorBindings {
  const root = track(mkdtempSync(join(tmpdir(), "fhv-t4a-term-class-")));
  const checkoutParent = join(root, "checkouts");
  const artifactRoot = join(root, "artifacts");
  const localStateDir = join(root, "state");
  mkdirSync(checkoutParent, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(localStateDir, { recursive: true });
  const envFile = join(root, "fhv.env");
  writeFileSync(envFile, "FHV_REHEARSAL_MODE=true\n");
  const sha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localReleaseRoot: root,
    localStateDir,
    localNodeBin: process.execPath,
    localGitBin: GIT_BIN,
    localSshBin: "/usr/bin/ssh",
    targetSha: sha,
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
    gitBin: GIT_BIN,
    pythonBin: "/usr/bin/python3",
    dockerBin: "/usr/bin/docker",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
    workstationTracePath: join(localStateDir, "trace.jsonl"),
    ...overrides,
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

async function realClosureRecordCheckoutStdout(input: {
  repoPath: string;
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  releaseTag: string;
}): Promise<string> {
  const config = resolveFhvT4ClosureCliConfig(process.env, [
    "record-checkout-identity",
    "--run-root",
    input.runRoot,
    "--run-id",
    input.runId,
    "--organization-id",
    input.organizationId,
    "--target-sha",
    input.targetSha,
    "--release-tag",
    input.releaseTag,
    "--repo-root",
    input.repoPath,
  ]);
  const result = await runFhvT4ClosureCli(config);
  expect(result.exitCode).toBe(0);
  const stdout = `${result.lines.join("\n")}\n`;
  expect(stdout).toContain("classification=FHV_T4_CHECKOUT_IDENTITY_PROOF_OK");
  return stdout;
}

function prepareTaggedReleaseCheckout(tag: string): { releaseRoot: string; sha: string } {
  // clone --shared keeps refs local to the clone (no workstation tag pollution).
  const parent = track(mkdtempSync(join(tmpdir(), "fhv-t4a-release-")));
  const releaseRoot = join(parent, "repo");
  execFileSync("git", ["clone", "--shared", "--no-checkout", ROOT, releaseRoot], {
    stdio: "pipe",
  });
  const sha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", releaseRoot, "checkout", "--detach", sha], { stdio: "pipe" });
  execFileSync("git", ["-C", releaseRoot, "tag", tag, sha], { stdio: "pipe" });
  return { releaseRoot, sha };
}

describe("fhv-t4a Steps 4/7 terminal classification (DEE-436)", () => {
  it("RED/GREEN: Step 7 accepts real closure CLI FHV_T4_CHECKOUT_IDENTITY_PROOF_OK", async () => {
    const tag = `fhv-t4a-term-class-${Date.now().toString(36)}`;
    const { releaseRoot, sha } = prepareTaggedReleaseCheckout(tag);
    const b = bindings({
      localReleaseRoot: releaseRoot,
      targetSha: sha,
      releaseTag: tag,
      runId: "term-class-real-cli",
    });
    const runRoot = join(b.artifactRoot, "RI-P7/fhv-ops-rehearsal", b.runId);
    mkdirSync(join(runRoot, "control"), { recursive: true });
    const realStdout = await realClosureRecordCheckoutStdout({
      repoPath: releaseRoot,
      runRoot,
      runId: b.runId,
      organizationId: b.organizationId,
      targetSha: sha,
      releaseTag: tag,
    });
    // Consume proof path so Step 7 via mock transport is classification-only; proof already written by real CLI.
    const ctx = buildFhvT4aExecContext(b, transportReturning(realStdout));
    const result = executeFhvT4aStep(ctx, 7);
    expect(result.exitCode).toBe(0);
    expect(result.classification).toBe("FHV_T4A_STEP_7_OK");
  });

  it("Step 4 maps FHV_T4_CHECKOUT_IDENTITY_OK to FHV_T4A_STEP_4_OK", () => {
    const ctx = buildFhvT4aExecContext(
      bindings(),
      transportReturning("classification=FHV_T4_CHECKOUT_IDENTITY_OK\n"),
    );
    const result = executeFhvT4aStep(ctx, 4);
    expect(result.exitCode).toBe(0);
    expect(result.classification).toBe("FHV_T4A_STEP_4_OK");
  });

  it("Step 7 rejects shell-class FHV_T4_CHECKOUT_IDENTITY_OK", () => {
    const ctx = buildFhvT4aExecContext(
      bindings(),
      transportReturning("classification=FHV_T4_CHECKOUT_IDENTITY_OK\n"),
    );
    try {
      executeFhvT4aStep(ctx, 7);
      expect.unreachable("expected classification mismatch");
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_T4A_STEP_7_CLASSIFICATION_MISMATCH" });
    }
  });

  it("Step 7 rejects unexpected CLI classification", () => {
    const ctx = buildFhvT4aExecContext(
      bindings(),
      transportReturning("classification=SOME_OTHER_OK\n"),
    );
    try {
      executeFhvT4aStep(ctx, 7);
      expect.unreachable("expected classification mismatch");
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_T4A_STEP_7_CLASSIFICATION_MISMATCH" });
    }
  });

  it("Step 4 rejects absent classification", () => {
    const ctx = buildFhvT4aExecContext(bindings(), transportReturning("ok\n"));
    try {
      executeFhvT4aStep(ctx, 4);
      expect.unreachable("expected missing classification");
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_T4A_STEP_4_CLASSIFICATION_MISMATCH" });
      expect(String((error as Error).message)).toMatch(/missing/i);
    }
  });

  it("Step 7 rejects absent classification", () => {
    const ctx = buildFhvT4aExecContext(bindings(), transportReturning("ok\n"));
    try {
      executeFhvT4aStep(ctx, 7);
      expect.unreachable("expected missing classification");
    } catch (error) {
      expect(error).toMatchObject({ code: "FHV_T4A_STEP_7_CLASSIFICATION_MISMATCH" });
      expect(String((error as Error).message)).toMatch(/missing/i);
    }
  });

  it("hermetic Step 7 runs real closure CLI and writes immutable checkout-identity proof", () => {
    const tag = `fhv-t4a-hermetic-step7-${Date.now().toString(36)}`;
    const { releaseRoot, sha } = prepareTaggedReleaseCheckout(tag);
    const work = track(mkdtempSync(join(tmpdir(), "fhv-t4a-hermetic-step7-")));
    const checkoutParent = join(work, "checkouts");
    const artifactRoot = join(work, "artifacts");
    const localStateDir = join(work, "state");
    const envFile = join(work, "fhv.env");
    mkdirSync(checkoutParent, { recursive: true });
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(localStateDir, { recursive: true });
    writeFileSync(envFile, "FHV_REHEARSAL_MODE=true\n");
    const b = bindings({
      localReleaseRoot: releaseRoot,
      localStateDir,
      artifactRoot,
      checkoutParent,
      environmentFile: envFile,
      targetSha: sha,
      releaseTag: tag,
      runId: "hermetic-step7",
      workstationTracePath: join(localStateDir, "trace.jsonl"),
    });
    const transport = createFhvT4aHermeticTransport({
      localReleaseRoot: releaseRoot,
      targetSha: sha,
      releaseTag: tag,
      originUrl: b.originUrl,
      serviceUser: b.serviceUser,
      serviceUserHome: join(work, "home"),
      checkoutParent,
      artifactRoot,
      environmentFile: envFile,
      runId: b.runId,
      organizationId: b.organizationId,
      nodeBin: b.nodeBin,
      corepackBin: b.corepackBin,
      gitBin: b.gitBin,
      pythonBin: b.pythonBin,
      dockerBin: b.dockerBin,
      systemctlBin: b.systemctlBin,
      systemdAnalyzeBin: b.systemdAnalyzeBin,
      operatorId: b.operatorId,
    });
    const ctx = buildFhvT4aExecContext(b, transport);
    // Ensure hermetic checkout exists before Step 7 (production order: Step 3 then 7).
    const checkout = transport.ssh({
      remoteCommand: "bash -s --",
      stdin: execFileSync(
        "git",
        ["-C", releaseRoot, "show", `${sha}:scripts/ops/fhv-service-user-checkout.sh`],
        {
          encoding: "utf8",
        },
      ),
      asRoot: true,
    });
    expect(checkout.exitCode).toBe(0);

    const result = executeFhvT4aStep(ctx, 7);
    expect(result.exitCode).toBe(0);
    expect(result.classification).toBe("FHV_T4A_STEP_7_OK");
    expect(result.stdout).toContain("FHV_T4_CHECKOUT_IDENTITY_PROOF_OK");
    expect(result.stdout).not.toContain("classification=FHV_T4_CHECKOUT_IDENTITY_OK");

    const proofPath = join(ctx.runDir, "control/fhv-t4-checkout-identity.v1.json");
    expect(existsSync(proofPath)).toBe(true);
    const proof = verifyFhvT4CheckoutIdentityProofArtifact({
      runRoot: ctx.runDir,
      targetSha: sha,
      releaseTag: tag,
      runId: b.runId,
      organizationId: b.organizationId,
    });
    expect(proof.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.runId).toBe(b.runId);
    expect(proof.organizationId).toBe(b.organizationId);
    expect(proof.releaseSha).toBe(sha);
    expect(proof.releaseTag).toBe(tag);
    expect(proof.headSha).toBe(sha);
    expect(proof.tagPeelSha).toBe(sha);
    const raw = JSON.parse(readFileSync(proofPath, "utf8")) as { contentDigest: string };
    expect(raw.contentDigest).toBe(proof.contentDigest);
  });
});
