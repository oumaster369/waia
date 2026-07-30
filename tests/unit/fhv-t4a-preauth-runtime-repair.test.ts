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

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FHV_T4A_SSH_STDIN_SCRIPT_PATHS } from "@/lib/trader/observability/fhv-t4a-direct-execution-contract";
import { FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION_LITERAL } from "@/lib/trader/observability/fhv-t4a-operator-contract";
import {
  readFhvT4aLocalReleaseReceipt,
  readFhvT4aPreauthReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";

import { classifyFhvT4aSupervisorResidualState } from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";
import {
  canRunLinuxPreauthLiveProof,
  createLinuxSystemdSandbox,
  ensureOldReleaseRevAvailable,
  gitShowBlob,
  OLD_RELEASE_SHA,
  runCommittedScriptViaBashStdin,
  sha256Hex,
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
const releaseWorktrees: string[] = [];

afterEach(() => {
  for (const path of [...releaseWorktrees].reverse()) {
    try {
      execFileSync("git", ["-C", ROOT, "worktree", "remove", "--force", path], { stdio: "pipe" });
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
  }
  releaseWorktrees.length = 0;
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
  const releaseRoot = trackDir("fhv-t4a-release-");
  execFileSync("git", ["-C", ROOT, "worktree", "add", "--detach", releaseRoot, "HEAD"], {
    stdio: "pipe",
  });
  releaseWorktrees.push(releaseRoot);
  const sha = execFileSync("git", ["-C", releaseRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const tag = `fhv-preauth-test-${sha.slice(0, 8)}`;
  execFileSync("git", ["-C", releaseRoot, "tag", "-f", tag, sha], { stdio: "pipe" });
  const originUrl = execFileSync("git", ["-C", releaseRoot, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  return { releaseRoot, sha, tag, originUrl };
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
  });

  describe("red-to-green proof against old release SHA", () => {
    it("old workstation shell fails repo-local tsx resolution from foreign cwd", () => {
      const oldShell = gitShowBlob(OLD_RELEASE_SHA, "scripts/ops/fhv-t4a-operator.sh");
      const oldShellPath = join(trackDir("old-shell-"), "fhv-t4a-operator.sh");
      writeFileSync(oldShellPath, oldShell, { mode: 0o755 });
      const foreignCwd = trackDir("old-foreign-");
      const { releaseRoot, sha, tag, originUrl } = createReleaseRoot();
      const env = buildOperatorEnv(releaseRoot, sha, tag, originUrl);
      const result = spawnSync("bash", [oldShellPath, "verify-local-release"], {
        env: { ...env, NODE_PATH: undefined },
        cwd: foreignCwd,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toMatch(
        /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find package 'tsx'|Cannot find module|repo-local tsx missing|trader-cli-server-only-prelude/,
      );
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

  describe("streamed-bootstrap inventory", () => {
    it("lists every pre-checkout stdin bootstrap and self-contained status", () => {
      const inventory = [
        {
          path: "scripts/ops/fhv-validate-origin-url.sh",
          phase: "pre-auth",
          usesBashSource: false,
          sourcesSibling: false,
          stdinSelfContained: true,
        },
        {
          path: "scripts/ops/fhv-t4-host-preflight.sh",
          phase: "pre-auth",
          usesBashSource: false,
          sourcesSibling: false,
          stdinSelfContained: true,
        },
        {
          path: RESIDUAL_READ,
          phase: "pre-auth",
          usesBashSource: false,
          sourcesSibling: false,
          stdinSelfContained: true,
        },
        {
          path: RESIDUAL_RECOVERY,
          phase: "residual-recovery-preview/confirm",
          usesBashSource: false,
          sourcesSibling: false,
          stdinSelfContained: true,
        },
        ...FHV_T4A_SSH_STDIN_SCRIPT_PATHS.filter(
          (path) =>
            path !== "scripts/ops/fhv-validate-origin-url.sh" &&
            path !== "scripts/ops/fhv-t4-host-preflight.sh" &&
            path !== RESIDUAL_READ,
        ).map((path) => ({
          path,
          phase: "post-checkout",
          usesBashSource: /BASH_SOURCE/.test(readFileSync(join(ROOT, path), "utf8")),
          sourcesSibling: /source .*\.sh/.test(readFileSync(join(ROOT, path), "utf8")),
          stdinSelfContained: !/source .*\.sh/.test(readFileSync(join(ROOT, path), "utf8")),
        })),
      ];
      for (const entry of inventory) {
        const body = readFileSync(join(ROOT, entry.path), "utf8");
        if (entry.path === RESIDUAL_READ || entry.path === RESIDUAL_RECOVERY) {
          expect(body).not.toContain("BASH_SOURCE");
          expect(body).not.toContain("_fhv-supervisor-common.sh");
        }
      }
      expect(
        inventory.every((entry) => entry.stdinSelfContained || entry.phase === "post-checkout"),
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
        const sshLog = join(work, "ssh.log");
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

        const trace = readFileSync(
          join(env.FHV_T4A_LOCAL_STATE_DIR!, "fhv-t4a-operator-trace.jsonl"),
          "utf8",
        );
        expect(trace).toContain('"phase":"pre-auth"');
        expect(trace).toContain("FHV_T4A_PREAUTH_OK");

        const sshLogBody = readFileSync(sshLog, "utf8");
        expect(sshLogBody).toContain("bash -s");
        expect(sshLogBody).not.toMatch(/^\s*ssh\s+/m);

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
