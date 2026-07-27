import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FHV_T4A_OPERATOR_STEPS } from "@/lib/trader/observability/fhv-t4a-operator-contract";

const SCRIPT = join(process.cwd(), "scripts/ops/fhv-release-checkout-identity.sh");
const GIT_BIN = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const PYTHON_BIN = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
const APPROVED_ORIGIN = "https://github.com/oumaster369/waia.git";
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

function initApprovedRepo(): { repo: string; sha: string; tag: string; home: string } {
  const home = trackDir("fhv-id-home-");
  const repo = join(trackDir("fhv-id-root-"), "repo");
  mkdirSync(repo);
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
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
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
    env,
  }).trim();
  const tag = "v2026.07.26.checkout-trust-test";
  execFileSync("git", ["tag", tag, sha], { cwd: repo, env, stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", APPROVED_ORIGIN], {
    cwd: repo,
    env,
    stdio: "pipe",
  });
  return { repo, sha, tag, home };
}

function runIdentityScript(
  args: string[],
  env: Record<string, string | undefined> = {},
): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function baseArgs(repo: string, sha: string, tag: string): string[] {
  return [
    "--repo-path",
    repo,
    "--target-sha",
    sha,
    "--release-tag",
    tag,
    "--git-bin",
    GIT_BIN,
    "--python-bin",
    PYTHON_BIN,
  ];
}

describe("fhv-release-checkout-identity shell — root git trust (DEE-436 corrective)", () => {
  it("proves raw Git fails under GIT_TEST_ASSUME_DIFFERENT_OWNER without command-scoped safe.directory", () => {
    const { repo, home } = initApprovedRepo();
    const env = {
      ...process.env,
      ...ASSUME_DIFFERENT_OWNER,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
    };
    expect(() =>
      execFileSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).toThrow(/dubious ownership|detected dubious ownership/i);
  });

  it("succeeds for a correct repository under GIT_TEST_ASSUME_DIFFERENT_OWNER=1", () => {
    const { repo, sha, tag, home } = initApprovedRepo();
    const result = runIdentityScript(baseArgs(repo, sha, tag), {
      ...ASSUME_DIFFERENT_OWNER,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("FHV_T4_CHECKOUT_IDENTITY_OK");
    expect(result.stderr).not.toMatch(/not a git worktree/i);
  });

  it("limits command-scoped trust to the exact repository path", () => {
    const first = initApprovedRepo();
    const second = initApprovedRepo();
    const env = {
      ...process.env,
      ...ASSUME_DIFFERENT_OWNER,
      HOME: first.home,
      GIT_CONFIG_GLOBAL: join(first.home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
    };
    expect(() =>
      execFileSync(
        "git",
        [
          "-c",
          `safe.directory=${first.repo}`,
          "-C",
          second.repo,
          "rev-parse",
          "--is-inside-work-tree",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
      ),
    ).toThrow(/dubious ownership|detected dubious ownership/i);
  });

  it("does not create or mutate persistent Git config files", () => {
    const { repo, sha, tag, home } = initApprovedRepo();
    const globalConfig = join(home, ".gitconfig");
    const repoConfigBefore = readFileSync(join(repo, ".git", "config"), "utf8");
    expect(existsSync(globalConfig)).toBe(false);

    const result = runIdentityScript(baseArgs(repo, sha, tag), {
      ...ASSUME_DIFFERENT_OWNER,
      HOME: home,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_SYSTEM: "/dev/null",
    });
    expect(result.exitCode).toBe(0);

    expect(existsSync(globalConfig)).toBe(false);
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(repoConfigBefore);
  });

  it("rejects wrong SHA, tag, origin, dirty tracked tree, and staged changes", () => {
    const { repo, sha, tag, home } = initApprovedRepo();
    const env = {
      ...ASSUME_DIFFERENT_OWNER,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
    };

    expect(runIdentityScript(baseArgs(repo, "b".repeat(40), tag), env).exitCode).not.toBe(0);
    expect(runIdentityScript(baseArgs(repo, sha, "v-wrong-tag"), env).exitCode).not.toBe(0);

    execFileSync("git", ["remote", "set-url", "origin", "https://example.com/other.git"], {
      cwd: repo,
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
      stdio: "pipe",
    });
    expect(runIdentityScript(baseArgs(repo, sha, tag), env).exitCode).not.toBe(0);

    execFileSync("git", ["remote", "set-url", "origin", APPROVED_ORIGIN], {
      cwd: repo,
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
      stdio: "pipe",
    });

    writeFileSync(join(repo, "README.md"), "dirty\n");
    expect(runIdentityScript(baseArgs(repo, sha, tag), env).exitCode).not.toBe(0);

    execFileSync("git", ["checkout", "--", "README.md"], {
      cwd: repo,
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
      stdio: "pipe",
    });
    writeFileSync(join(repo, "staged.txt"), "x\n");
    execFileSync("git", ["add", "staged.txt"], {
      cwd: repo,
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") },
      stdio: "pipe",
    });
    expect(runIdentityScript(baseArgs(repo, sha, tag), env).exitCode).not.toBe(0);
  });

  it("rejects invalid or unsafe repo paths fail-closed", () => {
    const { sha, tag, home } = initApprovedRepo();
    const env = {
      ...ASSUME_DIFFERENT_OWNER,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
    };
    const cases = ["relative/path", "/opt/waia/../waia/sha", '/opt/waia/repo"inject'];
    for (const badPath of cases) {
      const result = runIdentityScript(baseArgs(badPath, sha, tag), env);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/repo-path|absolute|\.\.|double quotes|control characters/i);
    }
  });

  it("preserves real Git diagnostics instead of generic not-a-worktree on trust failure", () => {
    const { repo, sha, tag, home } = initApprovedRepo();
    const releasedStyle = spawnSync(
      "bash",
      [
        "-c",
        `if ! "${GIT_BIN}" -C "${repo}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then printf 'error: not a git worktree: %s\\n' "${repo}" >&2; exit 2; fi`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...ASSUME_DIFFERENT_OWNER,
          HOME: home,
          GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
          GIT_CONFIG_SYSTEM: "/dev/null",
        },
      },
    );
    expect(releasedStyle.stderr).toMatch(/not a git worktree/i);
    expect(releasedStyle.stderr).not.toMatch(/dubious ownership/i);

    const repaired = runIdentityScript(baseArgs(repo, sha, tag), {
      ...ASSUME_DIFFERENT_OWNER,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
    });
    expect(repaired.exitCode).toBe(0);
  });

  it("keeps Step 4 contractually REMOTE_ROOT", () => {
    const step4 = FHV_T4A_OPERATOR_STEPS.find((step) => step.step === 4);
    expect(step4?.locus).toBe("REMOTE_ROOT");
    expect(step4?.commandOwner).toEqual({
      kind: "script",
      path: "scripts/ops/fhv-release-checkout-identity.sh",
    });
  });
});
