import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";

import { FHV_T4A_SSH_STDIN_SCRIPT_PATHS } from "@/lib/trader/observability/fhv-t4a-direct-execution-contract";
import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";
import {
  readFhvT4aLocalReleaseReceipt,
  readFhvT4aPreauthReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";

import { classifyFhvT4aSupervisorResidualState } from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";
import {
  canRunLinuxPreauthLiveProof,
  APPROVED_ORIGIN_URL,
  assertSourceRepositorySnapshotUnchanged,
  captureSourceRepositorySnapshot,
  createIsolatedReleaseFixture,
  createLinuxSystemdSandbox,
  createOldReleaseWorktree,
  ensureOldReleaseRevAvailable,
  gitShowBlobBytes,
  inspectLegacyPreauthTestTag,
  invokeFakeSsh,
  LEGACY_PREAUTH_TEST_TAG,
  listLinkedWorktreePaths,
  OLD_RELEASE_SHA,
  OLD_RELEASE_TAG_LITERAL,
  readFakeSshLog,
  removeIsolatedReleaseFixture,
  removeOldReleaseWorktree,
  runCommittedScriptViaBashStdin,
  sha256Hex,
  sha256HexBytes,
  shellQuote,
  type SourceRepositorySnapshot,
  writeFakeSshExecutable,
  writeHostPreflightStubs,
} from "../helpers/fhv-t4a-preauth-runtime-sandbox";

const ROOT = process.cwd();
const OPERATOR_SH = join(ROOT, "scripts/ops/fhv-t4a-operator.sh");
const RESIDUAL_READ = "scripts/ops/fhv-t4-supervisor-residual-state-read.sh";
const RESIDUAL_RECOVERY = "scripts/ops/fhv-t4-supervisor-residual-recovery.sh";
const LOCAL_NODE = process.execPath;
const LOCAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();

const cleanupPaths: string[] = [];
const isolatedReleaseFixtures: Array<{
  releaseRoot: string;
  sourceSnapshotBefore: ReturnType<typeof createIsolatedReleaseFixture>["sourceSnapshotBefore"];
}> = [];
const oldReleaseWorktrees: Array<{
  releaseRoot: string;
  sourceSnapshotBefore: SourceRepositorySnapshot;
}> = [];
let suiteSourceSnapshotBefore: SourceRepositorySnapshot;
let legacyPreauthTestTagAtSuiteStart: ReturnType<typeof inspectLegacyPreauthTestTag>;

const PRE_AUTH_BOOTSTRAP_PATHS = [
  "scripts/ops/fhv-validate-origin-url.sh",
  "scripts/ops/fhv-t4-host-preflight.sh",
  "scripts/ops/fhv-t4-supervisor-residual-state-read.sh",
] as const;

const STREAMED_BOOTSTRAP_INVENTORY = [
  {
    path: "scripts/ops/fhv-validate-origin-url.sh",
    phase: "pre-auth",
    step: 2,
    locus: "before-checkout",
  },
  {
    path: "scripts/ops/fhv-t4-host-preflight.sh",
    phase: "pre-auth",
    locus: "before-checkout",
  },
  {
    path: "scripts/ops/fhv-t4-supervisor-residual-state-read.sh",
    phase: "pre-auth",
    locus: "before-checkout",
  },
  {
    path: "scripts/ops/fhv-service-user-checkout.sh",
    phase: "t4a",
    step: 3,
    locus: "creates-checkout",
  },
  {
    path: "scripts/ops/fhv-service-user-install-deps.sh",
    phase: "t4a",
    step: 5,
    locus: "after-checkout-creation",
  },
  {
    path: "scripts/ops/fhv-t4-supervisor-residual-recovery.sh",
    phase: "residual-recovery-preview/confirm",
    locus: "governed-recovery",
  },
] as const;

afterEach(() => {
  for (const fixture of [...oldReleaseWorktrees].reverse()) {
    removeOldReleaseWorktree(fixture.releaseRoot, fixture.sourceSnapshotBefore);
  }
  oldReleaseWorktrees.length = 0;
  for (const fixture of [...isolatedReleaseFixtures].reverse()) {
    removeIsolatedReleaseFixture(fixture.releaseRoot, fixture.sourceSnapshotBefore);
  }
  isolatedReleaseFixtures.length = 0;
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function trackDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

function createReleaseRoot(): {
  releaseRoot: string;
  sha: string;
  tag: string;
  originUrl: string;
} {
  const fixture = createIsolatedReleaseFixture();
  isolatedReleaseFixtures.push({
    releaseRoot: fixture.releaseRoot,
    sourceSnapshotBefore: fixture.sourceSnapshotBefore,
  });
  return {
    releaseRoot: fixture.releaseRoot,
    sha: fixture.sha,
    tag: fixture.tag,
    originUrl: fixture.originUrl,
  };
}

function buildOperatorEnv(
  releaseRoot: string,
  sha: string,
  tag: string,
  originUrl: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const work = trackDir("fhv-preauth-work-");
  const localStateDir = join(work, "state");
  const envFile = join(work, "fhv.env");
  const artifactRoot = join(work, "artifacts");
  const checkoutParent = join(work, "checkouts");
  mkdirSync(localStateDir, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(checkoutParent, { recursive: true });
  return {
    ...process.env,
    NODE_PATH: undefined,
    EXEC_HOST: "exec.test",
    SSH_USER: "operator",
    FHV_LOCAL_RELEASE_ROOT: releaseRoot,
    FHV_T4A_LOCAL_STATE_DIR: localStateDir,
    FHV_LOCAL_NODE_BIN: LOCAL_NODE,
    FHV_LOCAL_GIT_BIN: LOCAL_GIT,
    FHV_LOCAL_SSH_BIN:
      extra.FHV_LOCAL_SSH_BIN ?? execFileSync("which", ["ssh"], { encoding: "utf8" }).trim(),
    EXECUTION_SERVER_TARGET_SHA: sha,
    FHV_RELEASE_TAG: tag,
    FHV_ORIGIN_URL: originUrl,
    FHV_RUN_ID: "fhv-t4a-preauth-runtime-repair",
    FHV_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000436",
    FHV_OPERATOR_ID: "operator-test",
    FHV_SERVICE_USER: "nobody",
    FHV_ENVIRONMENT_FILE: envFile,
    FHV_ARTIFACT_ROOT: artifactRoot,
    FHV_CHECKOUT_PARENT: checkoutParent,
    FHV_EXPECTED_HOSTNAME: extra.FHV_EXPECTED_HOSTNAME ?? "exec.test",
    FHV_EXPECTED_MACHINE_ID_SHA256: extra.FHV_EXPECTED_MACHINE_ID_SHA256 ?? "a".repeat(64),
    FHV_NODE_BIN: extra.FHV_NODE_BIN ?? LOCAL_NODE,
    FHV_COREPACK_BIN: extra.FHV_COREPACK_BIN ?? LOCAL_NODE,
    FHV_GIT_BIN: extra.FHV_GIT_BIN ?? LOCAL_GIT,
    FHV_PYTHON_BIN: extra.FHV_PYTHON_BIN ?? "/usr/bin/python3",
    FHV_DOCKER_BIN: extra.FHV_DOCKER_BIN ?? "/usr/bin/false",
    FHV_SYSTEMCTL_BIN: extra.FHV_SYSTEMCTL_BIN ?? "/usr/bin/systemctl",
    FHV_SYSTEMD_ANALYZE_BIN: extra.FHV_SYSTEMD_ANALYZE_BIN ?? "/usr/bin/systemd-analyze",
    ...extra,
  };
}

function runOperatorShellFromForeignCwd(
  phase: string,
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const foreignCwd = trackDir("fhv-foreign-cwd-");
  expect(existsSync(join(foreignCwd, "package.json"))).toBe(false);
  expect(existsSync(join(foreignCwd, "node_modules"))).toBe(false);
  const result = spawnSync("bash", [OPERATOR_SH, phase], {
    env: { ...env, NODE_PATH: undefined },
    cwd: foreignCwd,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("fhv-t4a PRE_AUTH runtime repair (DEE-436)", () => {
  beforeAll(() => {
    ensureOldReleaseRevAvailable();
    suiteSourceSnapshotBefore = captureSourceRepositorySnapshot();
    legacyPreauthTestTagAtSuiteStart = inspectLegacyPreauthTestTag();
  });

  afterAll(() => {
    assertSourceRepositorySnapshotUnchanged(
      suiteSourceSnapshotBefore,
      captureSourceRepositorySnapshot(),
    );
    for (const path of listLinkedWorktreePaths()) {
      expect(path).not.toMatch(/fhv-old-release-/);
      expect(path).not.toMatch(/fhv-t4a-release-/);
    }
  });

  describe("source-ref hygiene", () => {
    it("records legacy preauth test tag without mutating refs", () => {
      expect(LEGACY_PREAUTH_TEST_TAG).toBe("fhv-preauth-test-7655e862");
      expect(["PRESENT", "ABSENT"]).toContain(legacyPreauthTestTagAtSuiteStart.presence);
      if (legacyPreauthTestTagAtSuiteStart.presence === "PRESENT") {
        expect(legacyPreauthTestTagAtSuiteStart.peeledTargetSha).toBe(OLD_RELEASE_SHA);
      } else {
        expect(legacyPreauthTestTagAtSuiteStart.peeledTargetSha).toBeNull();
      }
      const current = inspectLegacyPreauthTestTag();
      expect(current.presence).toBe(legacyPreauthTestTagAtSuiteStart.presence);
      if (current.presence === "PRESENT") {
        expect(current.peeledTargetSha).toBe(legacyPreauthTestTagAtSuiteStart.peeledTargetSha);
      }
    });

    it("preserves source HEAD, origin, and tag list across old-release worktree lifecycle", () => {
      const before = captureSourceRepositorySnapshot();
      const oldRelease = createOldReleaseWorktree();
      oldReleaseWorktrees.push({
        releaseRoot: oldRelease.releaseRoot,
        sourceSnapshotBefore: oldRelease.sourceSnapshotBefore,
      });
      expect(oldRelease.tag).toBe(OLD_RELEASE_TAG_LITERAL);
      assertSourceRepositorySnapshotUnchanged(before, captureSourceRepositorySnapshot());
      removeOldReleaseWorktree(oldRelease.releaseRoot, oldRelease.sourceSnapshotBefore);
      oldReleaseWorktrees.pop();
      assertSourceRepositorySnapshotUnchanged(before, captureSourceRepositorySnapshot());
      for (const path of listLinkedWorktreePaths()) {
        expect(path).not.toBe(oldRelease.releaseRoot);
      }
    });
  });

  describe("red-to-green proof against old release SHA", () => {
    it("old workstation shell fails repo-local tsx resolution from foreign cwd", () => {
      const before = captureSourceRepositorySnapshot();
      const oldRelease = createOldReleaseWorktree();
      oldReleaseWorktrees.push({
        releaseRoot: oldRelease.releaseRoot,
        sourceSnapshotBefore: oldRelease.sourceSnapshotBefore,
      });
      expect(oldRelease.tag).toBe(OLD_RELEASE_TAG_LITERAL);
      assertSourceRepositorySnapshotUnchanged(before, captureSourceRepositorySnapshot());
      const foreignCwd = trackDir("old-foreign-");
      const env = buildOperatorEnv(
        oldRelease.releaseRoot,
        oldRelease.sha,
        oldRelease.tag,
        oldRelease.originUrl,
      );
      const oldShellPath = join(oldRelease.releaseRoot, "scripts/ops/fhv-t4a-operator.sh");
      expect(existsSync(oldShellPath)).toBe(true);
      expect(existsSync(join(oldRelease.releaseRoot, "scripts/ops/fhv-t4a-operator.ts"))).toBe(
        true,
      );
      expect(
        existsSync(
          join(oldRelease.releaseRoot, "scripts/trader/trader-cli-server-only-prelude.cjs"),
        ),
      ).toBe(true);
      const result = spawnSync("bash", [oldShellPath, "verify-local-release"], {
        env: { ...env, NODE_PATH: undefined },
        cwd: foreignCwd,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      const combined = `${result.stderr}${result.stdout}`;
      expect(combined).toMatch(/ERR_MODULE_NOT_FOUND/);
      expect(combined).toMatch(/Cannot find package 'tsx'/);
      expect(combined).not.toMatch(/operator TypeScript entry missing/);
      expect(combined).not.toMatch(/trader CLI prelude missing/);
    });

    it("feature-head workstation shell passes verify-local-release from foreign cwd", () => {
      const { releaseRoot, sha, tag, originUrl } = createReleaseRoot();
      const env = buildOperatorEnv(releaseRoot, sha, tag, originUrl);
      const result = runOperatorShellFromForeignCwd("verify-local-release", env);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("classification=FHV_T4A_LOCAL_RELEASE_VERIFY_OK");
    });

    it.runIf(process.platform === "linux")(
      "old residual-state bytes fail through bash -s from foreign cwd",
      () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const args = [
          "--systemctl-bin",
          sandbox.systemctlBin,
          "--python-bin",
          sandbox.pythonBin,
          "--systemd-dir",
          sandbox.systemdDir,
          "--expected-run-id",
          "fhv-t4a-old-run",
          "--expected-target-sha",
          "a".repeat(40),
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-hostname",
          sandbox.hostname,
          "--expected-machine-id-sha256",
          sandbox.machineIdSha256,
        ];
        const result = runCommittedScriptViaBashStdin({
          scriptPath: RESIDUAL_READ,
          rev: OLD_RELEASE_SHA,
          args,
          foreignCwd: sandbox.foreignCwd,
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(
          /unbound variable|No such file or directory|_fhv-supervisor-common/,
        );
      },
    );

    it.runIf(process.platform === "linux")(
      "old recovery preview bytes fail through bash -s from foreign cwd",
      () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const args = [
          "--preview",
          "--systemctl-bin",
          sandbox.systemctlBin,
          "--python-bin",
          sandbox.pythonBin,
          "--systemd-dir",
          sandbox.systemdDir,
          "--failed-run-id",
          "fhv-t4a-old-run",
          "--failed-target-sha",
          "a".repeat(40),
          "--failed-release-tag",
          "v2026.07.29.7655e86",
          "--expected-hostname",
          sandbox.hostname,
          "--expected-machine-id-sha256",
          sandbox.machineIdSha256,
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-operator-id",
          "operator-test",
        ];
        const result = runCommittedScriptViaBashStdin({
          scriptPath: RESIDUAL_RECOVERY,
          rev: OLD_RELEASE_SHA,
          args,
          foreignCwd: sandbox.foreignCwd,
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(
          /unbound variable|No such file or directory|_fhv-supervisor-common/,
        );
      },
    );
  });

  describe("Test A — foreign-cwd workstation entrypoint", () => {
    it("runs verify-local-release from foreign cwd via real committed shell", () => {
      const { releaseRoot, sha, tag, originUrl } = createReleaseRoot();
      const env = buildOperatorEnv(releaseRoot, sha, tag, originUrl);
      const result = runOperatorShellFromForeignCwd("verify-local-release", env);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("classification=FHV_T4A_LOCAL_RELEASE_VERIFY_OK");
      expect(result.stdout).toContain("FHV_T4A_LOCAL_RELEASE_VERIFY_OK");
      expect(
        existsSync(join(env.FHV_T4A_LOCAL_STATE_DIR!, "fhv-t4a-local-release-receipt.v1.json")),
      ).toBe(true);
    });
  });

  describe.runIf(process.platform === "linux")(
    "Test B — residual read through real bash stdin",
    () => {
      it("executes committed residual-state bytes via bash -s with no sibling helper", () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const args = [
          "--systemctl-bin",
          sandbox.systemctlBin,
          "--python-bin",
          sandbox.pythonBin,
          "--systemd-dir",
          sandbox.systemdDir,
          "--expected-run-id",
          "fhv-t4a-preauth-runtime-repair",
          "--expected-target-sha",
          execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-hostname",
          sandbox.hostname,
          "--expected-machine-id-sha256",
          sandbox.machineIdSha256,
        ];
        const result = runCommittedScriptViaBashStdin({
          scriptPath: RESIDUAL_READ,
          args,
          foreignCwd: sandbox.foreignCwd,
        });
        expect(result.exitCode).toBe(0);
        const lines = result.stdout
          .trim()
          .split("\n")
          .filter((line) => line.startsWith("{"));
        expect(lines).toHaveLength(1);
        const payload = JSON.parse(lines[0]!) as {
          schemaVersion: string;
          units: Array<{ unitName: string }>;
        };
        expect(payload.schemaVersion).toBe("fhv-t4-supervisor-residual-state/v1");
        expect(payload.units.map((unit) => unit.unitName)).toEqual([
          "waia-fhv-observer.service",
          "waia-fhv-campaign.service",
        ]);
        expect(result.stderr).not.toMatch(/mutating:/);
      });

      it("rejects non-allowlisted unit names", () => {
        const source = readFileSync(join(ROOT, RESIDUAL_READ), "utf8");
        expect(source).toContain('fail "unit not allowlisted');
      });

      it("classifies hostname mismatch as blocked host identity", () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const args = [
          "--systemctl-bin",
          sandbox.systemctlBin,
          "--python-bin",
          sandbox.pythonBin,
          "--systemd-dir",
          sandbox.systemdDir,
          "--expected-run-id",
          "fhv-t4a-preauth-runtime-repair",
          "--expected-target-sha",
          "a".repeat(40),
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-hostname",
          "wrong-hostname.example",
          "--expected-machine-id-sha256",
          sandbox.machineIdSha256,
        ];
        const result = runCommittedScriptViaBashStdin({
          scriptPath: RESIDUAL_READ,
          args,
          foreignCwd: sandbox.foreignCwd,
        });
        expect(result.exitCode).toBe(0);
        const payload = JSON.parse(
          result.stdout
            .trim()
            .split("\n")
            .find((line) => line.startsWith("{"))!,
        );
        expect(classifyFhvT4aSupervisorResidualState(payload)).toBe(
          "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_HOST_IDENTITY",
        );
      });
    },
  );

  describe.runIf(process.platform === "linux")(
    "Test C — recovery preview through real bash stdin",
    () => {
      it("executes committed recovery preview bytes via bash -s with zero mutations", () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const args = [
          "--preview",
          "--systemctl-bin",
          sandbox.systemctlBin,
          "--python-bin",
          sandbox.pythonBin,
          "--systemd-dir",
          sandbox.systemdDir,
          "--failed-run-id",
          "fhv-t4a-failed-run",
          "--failed-target-sha",
          "a".repeat(40),
          "--failed-release-tag",
          "v2026.07.29.7655e86",
          "--expected-hostname",
          sandbox.hostname,
          "--expected-machine-id-sha256",
          sandbox.machineIdSha256,
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-operator-id",
          "operator-test",
        ];
        const result = runCommittedScriptViaBashStdin({
          scriptPath: RESIDUAL_RECOVERY,
          args,
          foreignCwd: sandbox.foreignCwd,
        });
        expect(result.exitCode).toBe(0);
        const payload = JSON.parse(
          result.stdout
            .trim()
            .split("\n")
            .find((line) => line.startsWith("{"))!,
        ) as { classification: string };
        expect(payload.classification).toBe("FHV_T4A_RESIDUAL_RECOVERY_PREVIEW_OK");
        expect(result.stderr).not.toMatch(/mutating:/);
      });

      it("confirm without exact authorization performs zero mutations", () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const args = [
          "--confirm",
          "--systemctl-bin",
          sandbox.systemctlBin,
          "--python-bin",
          sandbox.pythonBin,
          "--systemd-dir",
          sandbox.systemdDir,
          "--failed-run-id",
          "fhv-t4a-failed-run",
          "--failed-target-sha",
          "a".repeat(40),
          "--failed-release-tag",
          "v2026.07.29.7655e86",
          "--expected-hostname",
          sandbox.hostname,
          "--expected-machine-id-sha256",
          sandbox.machineIdSha256,
          "--expected-organization-id",
          "00000000-0000-4000-8000-000000000436",
          "--expected-operator-id",
          "operator-test",
        ];
        const result = runCommittedScriptViaBashStdin({
          scriptPath: RESIDUAL_RECOVERY,
          args,
          foreignCwd: sandbox.foreignCwd,
          env: { ...process.env, FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION: "WRONG" },
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(/requires exact env/);
        expect(result.stderr).not.toMatch(/mutating:stop/);
      });

      it("documents exact authorization literal", () => {
        expect(FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL).toBe(
          "AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY",
        );
      });
    },
  );

  describe.runIf(process.platform === "linux")("fake SSH argv and stdin roundtrip", () => {
    it("executes production bash -s quoting for origin validation", () => {
      const sandbox = createLinuxSystemdSandbox();
      cleanupPaths.push(sandbox.root);
      const work = trackDir("fhv-roundtrip-");
      const binDir = join(work, "bin");
      mkdirSync(binDir, { recursive: true });
      const logPath = join(work, "ssh.jsonl");
      const fakeSsh = writeFakeSshExecutable({
        binDir,
        foreignCwd: sandbox.foreignCwd,
        logPath,
      });
      const originUrl = "https://github.com/oumaster369/waia.git";
      const scriptBody = readFileSync(join(ROOT, "scripts/ops/fhv-validate-origin-url.sh"), "utf8");
      const remoteCommand = `bash -s -- ${shellQuote("--origin-url")} ${shellQuote(originUrl)}`;
      const result = invokeFakeSsh({
        fakeSsh,
        remoteCommand,
        stdin: scriptBody,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("classification=FHV_T4_ORIGIN_URL_OK");
      expect(result.stderr).not.toContain("unknown argument");

      const log = readFakeSshLog(logPath);
      expect(log).toHaveLength(1);
      expect(log[0]?.remoteParts).toEqual([remoteCommand]);
      expect(log[0]?.stdinSha256).toBe(sha256Hex(scriptBody));
    });

    it("preserves shellQuote semantics for space and single-quote values", () => {
      const sandbox = createLinuxSystemdSandbox();
      cleanupPaths.push(sandbox.root);
      const work = trackDir("fhv-roundtrip-quote-");
      const binDir = join(work, "bin");
      mkdirSync(binDir, { recursive: true });
      const logPath = join(work, "ssh.jsonl");
      const fakeSsh = writeFakeSshExecutable({
        binDir,
        foreignCwd: sandbox.foreignCwd,
        logPath,
      });
      const argScript = join(work, "print-args.sh");
      writeFileSync(
        argScript,
        `#!/usr/bin/env bash
set -euo pipefail
printf 'arg1=%s\\n' "\${1:-}"
printf 'arg2=%s\\n' "\${2:-}"
printf 'arg3=%s\\n' "\${3:-}"
printf 'arg4=%s\\n' "\${4:-}"
`,
        { mode: 0o755 },
      );
      const spaceValue = "value with spaces";
      const quoteValue = "O'Brien";
      const remoteCommand = `bash -s -- ${shellQuote("--payload")} ${shellQuote(spaceValue)} ${shellQuote("--owner")} ${shellQuote(quoteValue)}`;
      const result = invokeFakeSsh({
        fakeSsh,
        remoteCommand,
        stdin: readFileSync(argScript),
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("arg1=--payload");
      expect(result.stdout).toContain("arg2=value with spaces");
      expect(result.stdout).toContain("arg3=--owner");
      expect(result.stdout).toContain(`arg4=${quoteValue}`);
      expect(result.stdout).not.toMatch(/'\\''/);
      expect(result.stdout).not.toMatch(/arg2='value with spaces'/);
      expect(result.stdout).not.toMatch(/arg4='O'Brien'/);
    });

    it("propagates real sudo -n true exit status", () => {
      const sandbox = createLinuxSystemdSandbox();
      cleanupPaths.push(sandbox.root);
      const work = trackDir("fhv-roundtrip-sudo-");
      const binDir = join(work, "bin");
      mkdirSync(binDir, { recursive: true });
      const logPath = join(work, "ssh.jsonl");
      const fakeSsh = writeFakeSshExecutable({
        binDir,
        foreignCwd: sandbox.foreignCwd,
        logPath,
      });
      const probe = invokeFakeSsh({
        fakeSsh,
        remoteCommand: ["sudo", "-n", "true"],
      });
      expect(probe.exitCode).toBe(0);
    });
  });

  describe("streamed-bootstrap inventory", () => {
    it("lists every streamed bootstrap from production call sites", () => {
      for (const entry of STREAMED_BOOTSTRAP_INVENTORY) {
        const body = readFileSync(join(ROOT, entry.path), "utf8");
        expect(body.startsWith("#!/")).toBe(true);
        expect(body).not.toContain("BASH_SOURCE");
        expect(body).not.toContain("_fhv-supervisor-common.sh");
        expect(/source .*\.sh/.test(body)).toBe(false);
      }
      expect(
        FHV_T4A_SSH_STDIN_SCRIPT_PATHS.every((path) =>
          STREAMED_BOOTSTRAP_INVENTORY.some((entry) => entry.path === path),
        ),
      ).toBe(true);
      expect(STREAMED_BOOTSTRAP_INVENTORY.map((entry) => entry.path)).toEqual([
        "scripts/ops/fhv-validate-origin-url.sh",
        "scripts/ops/fhv-t4-host-preflight.sh",
        "scripts/ops/fhv-t4-supervisor-residual-state-read.sh",
        "scripts/ops/fhv-service-user-checkout.sh",
        "scripts/ops/fhv-service-user-install-deps.sh",
        "scripts/ops/fhv-t4-supervisor-residual-recovery.sh",
      ]);
      expect(
        STREAMED_BOOTSTRAP_INVENTORY.some(
          (entry) => entry.path === "scripts/ops/fhv-t4-supervisor-residual-recovery.sh",
        ),
      ).toBe(true);
    });
  });

  describe("workstation shell cwd invariant", () => {
    it("establishes repository-root cwd before --import tsx", () => {
      const source = readFileSync(OPERATOR_SH, "utf8");
      expect(source).toMatch(/cd "\$REPO_ROOT"/);
      expect(source.indexOf('cd "$REPO_ROOT"')).toBeLessThan(source.indexOf("--import tsx"));
      expect(source).toMatch(/node_modules\/tsx/);
    });
  });

  describe.runIf(canRunLinuxPreauthLiveProof())(
    "Test D — complete PRE_AUTH via real shell + live transport + fake SSH",
    () => {
      it("reaches FHV_T4A_PREAUTH_OK with committed stdin bytes and valid receipt", () => {
        const sandbox = createLinuxSystemdSandbox();
        cleanupPaths.push(sandbox.root);
        const { releaseRoot, sha, tag, originUrl } = createReleaseRoot();
        const work = trackDir("fhv-live-preauth-");
        const binDir = join(work, "bin");
        mkdirSync(binDir, { recursive: true });
        const sshLog = join(work, "ssh.jsonl");
        const envFile = join(work, "fhv.env");
        const artifactRoot = join(work, "artifacts");
        const checkoutParent = join(work, "checkouts");
        const serviceUser = execFileSync("whoami", { encoding: "utf8" }).trim();
        const stubs = writeHostPreflightStubs({
          binDir,
          sandboxRoot: work,
          serviceUser,
          canonicalHostname: sandbox.hostname,
          envFile,
          artifactRoot,
          checkoutParent,
          legacyContainerName: "ai-trader-execution-host",
          legacyContainerImage: "waia-execution-host:bp6",
        });
        const fakeSsh = writeFakeSshExecutable({
          binDir,
          foreignCwd: sandbox.foreignCwd,
          logPath: sshLog,
        });

        if (!existsSync("/run/systemd/system")) {
          throw new Error("Linux preflight sandbox requires /run/systemd/system");
        }

        const env = buildOperatorEnv(releaseRoot, sha, tag, originUrl, {
          FHV_LOCAL_SSH_BIN: fakeSsh,
          FHV_SERVICE_USER: serviceUser,
          FHV_EXPECTED_HOSTNAME: sandbox.hostname,
          FHV_EXPECTED_MACHINE_ID_SHA256: sandbox.machineIdSha256,
          FHV_ENVIRONMENT_FILE: envFile,
          FHV_ARTIFACT_ROOT: artifactRoot,
          FHV_CHECKOUT_PARENT: checkoutParent,
          FHV_NODE_BIN: stubs.nodeBin,
          FHV_COREPACK_BIN: stubs.corepackBin,
          FHV_GIT_BIN: stubs.gitBin,
          FHV_PYTHON_BIN: sandbox.pythonBin,
          FHV_DOCKER_BIN: stubs.dockerBin,
          FHV_SYSTEMCTL_BIN: sandbox.systemctlBin,
          FHV_SYSTEMD_ANALYZE_BIN: stubs.systemdAnalyzeBin,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        });

        const verify = runOperatorShellFromForeignCwd("verify-local-release", env);
        expect(verify.status).toBe(0);
        expect(verify.stdout).toContain("FHV_T4A_LOCAL_RELEASE_VERIFY_OK");

        const preauth = runOperatorShellFromForeignCwd("pre-auth", env);
        if (preauth.status !== 0) {
          throw new Error(`pre-auth failed: stdout=${preauth.stdout}\nstderr=${preauth.stderr}`);
        }
        expect(preauth.status).toBe(0);
        expect(preauth.stdout).toContain("classification=FHV_T4A_PREAUTH_OK");

        const localReceipt = readFhvT4aLocalReleaseReceipt(env.FHV_T4A_LOCAL_STATE_DIR!);
        const preauthReceipt = readFhvT4aPreauthReceipt(env.FHV_T4A_LOCAL_STATE_DIR!);
        expect(preauthReceipt.targetSha).toBe(sha);
        expect(preauthReceipt.releaseTag).toBe(tag);
        expect(preauthReceipt.originUrl).toBe(originUrl);
        expect(preauthReceipt.bindingDigest).toBe(localReceipt.bindingDigest);
        expect(preauthReceipt.rejectedCommandCount).toBe(0);
        expect(preauthReceipt.mutatingCommandCount).toBe(0);
        expect(preauthReceipt.supervisorResidualClassification).toBe(
          "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE",
        );
        expect(preauthReceipt.supervisorResidualStateDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(preauthReceipt.contentDigest).toMatch(/^[0-9a-f]{64}$/);

        const ledgerStdinEntries = preauthReceipt.preauthLedger.filter(
          (entry) => entry.stdinPresent,
        );
        const fakeSshStdinEntries = readFakeSshLog(sshLog).filter((entry) => entry.stdinPresent);
        expect(fakeSshStdinEntries.length).toBe(ledgerStdinEntries.length);
        expect(fakeSshStdinEntries.length).toBeGreaterThan(0);

        for (let index = 0; index < ledgerStdinEntries.length; index += 1) {
          const ledgerEntry = ledgerStdinEntries[index]!;
          const fakeEntry = fakeSshStdinEntries[index]!;
          expect(fakeEntry.stdinByteLength).toBeGreaterThan(0);
          expect(fakeEntry.stdinSha256).toBe(ledgerEntry.bootstrapBlobSha256);
          expect(PRE_AUTH_BOOTSTRAP_PATHS).toContain(ledgerEntry.bootstrapRepositoryPath);
          const expectedBytes = gitShowBlobBytes(sha, ledgerEntry.bootstrapRepositoryPath!);
          expect(fakeEntry.stdinSha256).toBe(sha256HexBytes(expectedBytes));
          expect(ledgerEntry.bootstrapBlobSha256).toBe(sha256HexBytes(expectedBytes));
        }

        const trace = readFileSync(
          join(env.FHV_T4A_LOCAL_STATE_DIR!, "fhv-t4a-operator-trace.jsonl"),
          "utf8",
        );
        expect(trace).toContain('"phase":"pre-auth"');
        expect(trace).toContain("FHV_T4A_PREAUTH_OK");

        const sshLogBody = readFileSync(sshLog, "utf8");
        expect(sshLogBody).toContain("bash -s");
        expect(sshLogBody).toContain("stdinSha256");

        const residualBody = readFileSync(join(ROOT, RESIDUAL_READ), "utf8");
        expect(sha256Hex(residualBody)).toBe(
          createHash("sha256")
            .update(
              execFileSync("git", ["-C", releaseRoot, "show", `HEAD:${RESIDUAL_READ}`], {
                encoding: "utf8",
              }),
              "utf8",
            )
            .digest("hex"),
        );
      }, 120_000);
    },
  );
});
