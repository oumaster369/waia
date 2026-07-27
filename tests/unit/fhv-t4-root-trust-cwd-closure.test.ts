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

import { afterEach, describe, expect, it } from "vitest";

import { FHV_T4A_OPERATOR_STEPS } from "@/lib/trader/observability/fhv-t4a-operator-contract";

const ROOT = process.cwd();
const GIT_BIN = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const NODE_BIN = process.execPath;
const TARGET_SHA = "a".repeat(40);
const ASSUME_DIFFERENT_OWNER = { GIT_TEST_ASSUME_DIFFERENT_OWNER: "1" };

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

function isolatedGitEnv(home: string): Record<string, string> {
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
}

function initApprovedRepo(): { repo: string; home: string } {
  const home = trackDir("fhv-root-trust-home-");
  const repo = join(trackDir("fhv-root-trust-root-"), "repo");
  mkdirSync(repo);
  const env = { ...process.env, ...isolatedGitEnv(home) };
  execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: repo, env, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
    env,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo, env, stdio: "pipe" });
  writeFileSync(join(repo, "README.md"), "ok\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo, env, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repo, env, stdio: "pipe" });
  return { repo, home };
}

function runBash(
  scriptRel: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    mockBin?: string;
  } = {},
): { exitCode: number | null; stdout: string; stderr: string } {
  const script = join(ROOT, scriptRel);
  const env = {
    ...process.env,
    ...(options.env ?? {}),
    PATH: options.mockBin ? `${options.mockBin}:${process.env.PATH ?? ""}` : process.env.PATH,
  };
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    cwd: options.cwd ?? ROOT,
    env,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeFakeRenderNode(mockBin: string): void {
  writeFileSync(
    join(mockBin, "node"),
    `#!/usr/bin/env bash
if [[ "$*" == *render-units-cli.ts* ]]; then
  printf '%s\\n' '{"campaignUnit":"[Unit]\\nDescription=test\\n","observerUnit":"[Unit]\\nDescription=test\\n"}'
  exit 0
fi
exec ${JSON.stringify(NODE_BIN)} "$@"
`,
  );
  chmodSync(join(mockBin, "node"), 0o755);
  writeFileSync(join(mockBin, "systemd-analyze"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(mockBin, "systemd-analyze"), 0o755);
}

describe("fhv-t4 root trust and cwd closure (DEE-436 PR #428)", () => {
  it("Step 8 render-units succeeds under GIT_TEST_ASSUME_DIFFERENT_OWNER with bound git-bin", () => {
    const { repo, home } = initApprovedRepo();
    const mockBin = trackDir("fhv-mock-bin-");
    writeFakeRenderNode(mockBin);
    const args = [
      "--target-sha",
      TARGET_SHA,
      "--repo-path",
      repo,
      "--git-bin",
      GIT_BIN,
      "--working-directory",
      repo,
      "--service-user",
      "waia-fhv",
      "--environment-file",
      "/etc/waia/fhv.env",
      "--fhv-run-root",
      "/var/lib/waia/fhv-runs/test",
      "--fhv-run-id",
      "test-run",
      "--fhv-organization-id",
      "00000000-0000-4000-8000-000000000436",
      "--node-bin",
      join(mockBin, "node"),
      "--output-dir",
      join(trackDir("fhv-render-out-"), "units"),
    ];
    const result = runBash("scripts/ops/fhv-supervisor/render-units.sh", args, {
      cwd: trackDir("fhv-external-cwd-"),
      env: { ...ASSUME_DIFFERENT_OWNER, ...isolatedGitEnv(home) },
      mockBin,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toMatch(/dubious ownership|not a git worktree/i);
    expect(result.stderr).toContain("Render complete");
  });

  it("Steps 9 and 10 install-units preview reaches planned output under different ownership", () => {
    const { repo, home } = initApprovedRepo();
    const mockBin = trackDir("fhv-mock-bin-");
    writeFakeRenderNode(mockBin);
    writeFileSync(
      join(mockBin, "systemctl"),
      `#!/usr/bin/env bash
case "$1" in
  is-enabled) echo disabled; exit 1 ;;
  *) exit 0 ;;
esac
`,
    );
    chmodSync(join(mockBin, "systemctl"), 0o755);
    const args = [
      "--target-sha",
      TARGET_SHA,
      "--repo-path",
      repo,
      "--git-bin",
      GIT_BIN,
      "--working-directory",
      repo,
      "--service-user",
      "waia-fhv",
      "--environment-file",
      "/etc/waia/fhv.env",
      "--fhv-run-root",
      "/var/lib/waia/fhv-runs/test",
      "--fhv-run-id",
      "test-run",
      "--fhv-organization-id",
      "00000000-0000-4000-8000-000000000436",
      "--node-bin",
      join(mockBin, "node"),
      "--systemctl-bin",
      join(mockBin, "systemctl"),
      "--systemd-analyze",
      join(mockBin, "systemd-analyze"),
    ];
    const result = runBash("scripts/ops/fhv-supervisor/install-units.sh", args, {
      cwd: trackDir("fhv-install-preview-cwd-"),
      env: { ...ASSUME_DIFFERENT_OWNER, ...isolatedGitEnv(home) },
      mockBin,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/planned: install/);
    expect(result.stderr).not.toMatch(/dubious ownership/i);
  });

  it("scopes trust to exact repository path; sibling remains untrusted", () => {
    const first = initApprovedRepo();
    const second = initApprovedRepo();
    const env = { ...ASSUME_DIFFERENT_OWNER, ...isolatedGitEnv(first.home) };
    expect(() =>
      execFileSync(
        "git",
        ["-c", `safe.directory=${first.repo}`, "-C", second.repo, "rev-parse", "--show-toplevel"],
        { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ).toThrow(/dubious ownership|detected dubious ownership/i);
  });

  it("does not mutate persistent Git config during supervisor render", () => {
    const { repo, home } = initApprovedRepo();
    const mockBin = trackDir("fhv-mock-bin-");
    writeFakeRenderNode(mockBin);
    const globalConfig = join(home, ".gitconfig");
    const repoConfigBefore = readFileSync(join(repo, ".git", "config"), "utf8");
    const args = [
      "--target-sha",
      TARGET_SHA,
      "--repo-path",
      repo,
      "--git-bin",
      GIT_BIN,
      "--working-directory",
      repo,
      "--service-user",
      "waia-fhv",
      "--environment-file",
      "/etc/waia/fhv.env",
      "--fhv-run-root",
      "/var/lib/waia/fhv-runs/test",
      "--fhv-run-id",
      "test-run",
      "--fhv-organization-id",
      "00000000-0000-4000-8000-000000000436",
      "--node-bin",
      join(mockBin, "node"),
    ];
    const result = runBash("scripts/ops/fhv-supervisor/render-units.sh", args, {
      env: { ...ASSUME_DIFFERENT_OWNER, ...isolatedGitEnv(home) },
      mockBin,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(globalConfig)).toBe(false);
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(repoConfigBefore);
  });

  it("Step 11 record-deploy git trust passes under different ownership before tsx on bare repo", () => {
    const { repo, home } = initApprovedRepo();
    const digests = JSON.stringify({
      "waia-fhv-campaign.service": "a".repeat(64),
      "waia-fhv-observer.service": "b".repeat(64),
    });
    const result = runBash(
      "scripts/ops/fhv-systemd-record-deploy.sh",
      [
        "--target-sha",
        TARGET_SHA,
        "--release-tag",
        "v2026.07.26.test",
        "--run-id",
        "run-test",
        "--organization-id",
        "00000000-0000-4000-8000-000000000001",
        "--operator",
        "operator-test",
        "--service-user",
        "waia-fhv",
        "--rendered-unit-digests",
        digests,
        "--repo-path",
        repo,
        "--git-bin",
        GIT_BIN,
        "--node-bin",
        NODE_BIN,
        "--docker-bin",
        "/usr/bin/false",
      ],
      {
        cwd: trackDir("fhv-record-deploy-cwd-"),
        env: { ...ASSUME_DIFFERENT_OWNER, ...isolatedGitEnv(home) },
      },
    );
    expect(result.stderr).not.toMatch(/dubious ownership|not a git worktree/i);
    expect(result.stderr + result.stdout).toMatch(
      /ERR_MODULE_NOT_FOUND|Cannot find package 'tsx'|node_modules/i,
    );
  });

  it("Step 11 record-deploy preview resolves repo-local tsx from external cwd on full checkout", () => {
    const digests = JSON.stringify({
      "waia-fhv-campaign.service": "a".repeat(64),
      "waia-fhv-observer.service": "b".repeat(64),
    });
    const result = runBash(
      "scripts/ops/fhv-systemd-record-deploy.sh",
      [
        "--target-sha",
        TARGET_SHA,
        "--release-tag",
        "v2026.07.26.test",
        "--run-id",
        "run-test",
        "--organization-id",
        "00000000-0000-4000-8000-000000000001",
        "--operator",
        "operator-test",
        "--service-user",
        "waia-fhv",
        "--rendered-unit-digests",
        digests,
        "--repo-path",
        ROOT,
        "--git-bin",
        GIT_BIN,
        "--node-bin",
        NODE_BIN,
        "--docker-bin",
        "/usr/bin/false",
      ],
      { cwd: trackDir("fhv-record-deploy-full-cwd-") },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("fhv-systemd-deployed-revision.v1.json");
    expect(result.stderr).toMatch(/NO-OP \(missing --confirm\)/);
    expect(result.stderr + result.stdout).not.toMatch(
      /ERR_MODULE_NOT_FOUND|Cannot find package 'tsx'/i,
    );
  });

  it("Step 21 resume root script reaches application validation from external cwd", () => {
    const runRoot = join(trackDir("fhv-resume-run-"), "run");
    mkdirSync(join(runRoot, "control"), { recursive: true });
    const mockBin = trackDir("fhv-resume-mock-bin-");
    writeFileSync(join(mockBin, "systemctl"), "#!/usr/bin/env bash\necho inactive\nexit 3\n");
    chmodSync(join(mockBin, "systemctl"), 0o755);
    writeFileSync(
      join(mockBin, "id"),
      `#!/usr/bin/env bash
if [[ "$1" == "-u" ]]; then
  echo 0
  exit 0
fi
exec /usr/bin/id "$@"
`,
    );
    chmodSync(join(mockBin, "id"), 0o755);
    const result = runBash(
      "scripts/ops/fhv-t4-resume-campaign-root.sh",
      [
        "--run-root",
        runRoot,
        "--run-id",
        "run-test",
        "--organization-id",
        "00000000-0000-4000-8000-000000000001",
        "--target-sha",
        TARGET_SHA,
        "--repo-root",
        ROOT,
        "--systemctl-bin",
        join(mockBin, "systemctl"),
        "--node-bin",
        NODE_BIN,
      ],
      { cwd: trackDir("fhv-resume-external-cwd-"), mockBin },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(
      /Paused verification proof required|FHV_T4_RESUME/,
    );
    expect(result.stderr + result.stdout).not.toMatch(
      /ERR_MODULE_NOT_FOUND|Cannot find package 'tsx'/i,
    );
  });

  it("rejects unsafe repo paths fail-closed for render-units with --repo-path", () => {
    const mockBin = trackDir("fhv-mock-bin-");
    writeFakeRenderNode(mockBin);
    const result = runBash(
      "scripts/ops/fhv-supervisor/render-units.sh",
      [
        "--target-sha",
        TARGET_SHA,
        "--repo-path",
        "relative/path",
        "--git-bin",
        GIT_BIN,
        "--working-directory",
        ROOT,
        "--service-user",
        "waia-fhv",
        "--environment-file",
        "/etc/waia/fhv.env",
        "--fhv-run-root",
        "/var/lib/waia/fhv-runs/test",
        "--fhv-run-id",
        "test-run",
        "--fhv-organization-id",
        "00000000-0000-4000-8000-000000000436",
        "--node-bin",
        join(mockBin, "node"),
      ],
      { mockBin },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/repo-path|absolute|\.\./i);
  });

  it("requires --git-bin when --repo-path is supplied to render-units", () => {
    const { repo } = initApprovedRepo();
    const result = runBash("scripts/ops/fhv-supervisor/render-units.sh", [
      "--target-sha",
      TARGET_SHA,
      "--repo-path",
      repo,
      "--working-directory",
      repo,
      "--service-user",
      "waia-fhv",
      "--environment-file",
      "/etc/waia/fhv.env",
      "--fhv-run-root",
      "/var/lib/waia/fhv-runs/test",
      "--fhv-run-id",
      "test-run",
      "--fhv-organization-id",
      "00000000-0000-4000-8000-000000000436",
      "--node-bin",
      NODE_BIN,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/git-bin is required/i);
  });

  it("root-run tsx wrappers cd to repo root before module import", () => {
    const recordDeploy = readFileSync(
      join(ROOT, "scripts/ops/fhv-systemd-record-deploy.sh"),
      "utf8",
    );
    const resumeRoot = readFileSync(
      join(ROOT, "scripts/ops/fhv-t4-resume-campaign-root.sh"),
      "utf8",
    );
    const renderUnits = readFileSync(
      join(ROOT, "scripts/ops/fhv-supervisor/render-units.sh"),
      "utf8",
    );
    expect(recordDeploy).toContain("fhv_ops_cd_repo_root");
    expect(resumeRoot).toContain("fhv_ops_cd_repo_root");
    expect(renderUnits).toMatch(/cd "\$REPO_ROOT"/);
  });

  it("preserves REMOTE_ROOT contract for Steps 8, 9, 10, and 11", () => {
    for (const step of [8, 9, 10, 11]) {
      const contract = FHV_T4A_OPERATOR_STEPS.find((entry) => entry.step === step);
      expect(contract?.locus).toBe("REMOTE_ROOT");
    }
    const step21 = FHV_T4A_OPERATOR_STEPS.find((entry) => entry.step === 21);
    expect(step21?.commandOwner).toEqual({
      kind: "package",
      command: "trader:fhv:t4:resume",
    });
  });
});
