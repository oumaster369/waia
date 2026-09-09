import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = process.cwd();
const PREFLIGHT = join(REPOSITORY_ROOT, "scripts/ops/execution-server-preflight.sh");
const BUILD = join(REPOSITORY_ROOT, "scripts/ops/execution-server-build.sh");
const DEPLOY = join(REPOSITORY_ROOT, "scripts/ops/execution-server-deploy.sh");
const PREPARE_PROPOSAL = join(
  REPOSITORY_ROOT,
  "scripts/ops/execution-server-prepare-historical-proposal.sh",
);

const temporaryRepositories: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createRepository(): Readonly<{ root: string; approvedSha: string }> {
  const root = mkdtempSync(join(tmpdir(), "waia-execution-preflight-"));
  temporaryRepositories.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "WAIA Test");
  git(root, "config", "user.email", "waia-test@example.invalid");
  writeFileSync(join(root, "tracked.txt"), "approved\n", "utf8");
  git(root, "add", "tracked.txt");
  git(root, "commit", "-m", "approved");
  const approvedSha = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/remotes/origin/main", approvedSha);
  return { root, approvedSha };
}

function preflight(root: string, targetSha: string, extra: readonly string[] = []) {
  return spawnSync("bash", [PREFLIGHT, "--target-sha", targetSha, "--repo-path", root, ...extra], {
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of temporaryRepositories.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("execution-server exact SHA attestation", () => {
  it.each([
    { requested: undefined, reported: "idle", success: true },
    { requested: "idle", reported: "historical-v2-ratified-one-shot", success: false },
    { requested: "historical-v2-ratified-one-shot", reported: "idle", success: false },
    { requested: "historical-v2-ratified-one-shot", reported: "historical-v2-ratified-one-shot", success: true },
  ])("deployment enforces requested mode $requested against reported $reported", ({ requested, reported, success }) => {
    // Execute the real shell helper in a temporary git repository. Docker/curl
    // are local test doubles; no actual container or production endpoint exists.
    const { root } = createRepository();
    mkdirSync(join(root, "scripts/ops"), { recursive: true });
    copyFileSync(PREFLIGHT, join(root, "scripts/ops/execution-server-preflight.sh"));
    chmodSync(join(root, "scripts/ops/execution-server-preflight.sh"), 0o755);
    git(root, "add", "scripts/ops/execution-server-preflight.sh");
    git(root, "commit", "-m", "preflight");
    const target = git(root, "rev-parse", "HEAD");
    git(root, "update-ref", "refs/remotes/origin/main", target);
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), "waia-idle-deploy-")));
    temporaryRepositories.push(fixture);
    const binaryRoot = join(fixture, "bin");
    mkdirSync(binaryRoot);
    mkdirSync(join(fixture, "dataset"));
    mkdirSync(join(fixture, "checkpoints"), { mode: 0o700 });
    const envFile = join(fixture, "operator.env");
    writeFileSync(envFile, "WAIA_EXECUTION_HOST_MODE=historical-v2-ratified-one-shot\n", { mode: 0o600 });
    const log = join(fixture, "docker.jsonl");
    const imageId = `sha256:${"b".repeat(64)}`;
    const revision = join(fixture, "revision.json");
    const initialRevision = { gitSha: target, imageId, imageTag: "test:exact" };
    writeFileSync(revision, JSON.stringify(initialRevision));
    const docker = join(binaryRoot, "docker");
    writeFileSync(docker, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] === 'image') console.log(a.includes('{{.Id}}') ? ${JSON.stringify(imageId)} : ${JSON.stringify(target)});
else if (a[0] === 'inspect') console.log(a.includes('{{.Image}}') ? ${JSON.stringify(imageId)} : '0');
else if (a[0] === 'run') console.log('test-container');
else if (a[0] !== 'ps') process.exit(19);
`, { mode: 0o755 });
    const health = {
      status: reported === "idle" ? "installed" : "ok", executionReady: reported !== "idle",
      service: "ai-trader-execution-host", releaseSha: target, imageReleaseSha: target,
      consumer: { mode: reported, state: reported === "idle" ? "idle" : "running", runId: reported === "idle" ? null : "test-run", exitCode: null },
    };
    writeFileSync(join(binaryRoot, "curl"), `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(health))});\n`, { mode: 0o755 });
    const result = spawnSync("bash", [DEPLOY, "--target-sha", target, "--repo-path", root,
      "--image-tag", "test:exact", "--operator", "test-only", "--secrets-env-file", envFile,
      "--dataset-root", join(fixture, "dataset"), "--checkpoint-root", join(fixture, "checkpoints"),
      ...(requested ? ["--runtime-mode", requested] : []), "--confirm"], {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env, PATH: `${binaryRoot}:${process.env.PATH}`,
        WAIA_EXECUTION_HOST_MODE: "historical-v2-ratified-one-shot",
        EXECUTION_SERVER_DEPLOYED_REVISION_PATH: revision, EXECUTION_SERVER_READY_TIMEOUT_SECONDS: "1" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status === 0, result.stderr).toBe(success);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
    const runtimeCommands = calls.filter(a => a.includes("--preflight-runtime") || a.includes("-d"));
    expect(runtimeCommands).toHaveLength(2);
    for (const command of runtimeCommands) {
      const modeIndex = command.indexOf(`WAIA_EXECUTION_HOST_MODE=${requested ?? "idle"}`);
      expect(modeIndex).toBeGreaterThan(command.indexOf("--env-file"));
    }
    const stored = JSON.parse(readFileSync(revision, "utf8"));
    if (success) expect(stored.runtimeMode).toBe(requested ?? "idle");
    else expect(stored).toEqual(initialRevision);
  });

  it("accepts a clean checkout at a commit reachable from origin/main", () => {
    const { root, approvedSha } = createRepository();
    const result = preflight(root, approvedSha);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("clean checkout matches approved target SHA");
  });

  it("refuses tracked residue even when HEAD equals the target", () => {
    const { root, approvedSha } = createRepository();
    writeFileSync(join(root, "tracked.txt"), "dirty\n", "utf8");
    const result = preflight(root, approvedSha);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("result: DIRTY");
    expect(result.stderr).toContain("tracked.txt");
  });

  it("refuses untracked residue even when HEAD equals the target", () => {
    const { root, approvedSha } = createRepository();
    writeFileSync(join(root, "untracked.txt"), "dirty\n", "utf8");
    const result = preflight(root, approvedSha);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("result: DIRTY");
    expect(result.stderr).toContain("untracked.txt");
  });

  it("requires origin/main reachability unless an explicit approved ref is supplied", () => {
    const { root } = createRepository();
    writeFileSync(join(root, "tracked.txt"), "candidate\n", "utf8");
    git(root, "add", "tracked.txt");
    git(root, "commit", "-m", "candidate");
    const candidateSha = git(root, "rev-parse", "HEAD");

    const defaultResult = preflight(root, candidateSha);
    expect(defaultResult.status).toBe(1);
    expect(defaultResult.stderr).toContain("target SHA is not reachable");

    git(root, "update-ref", "refs/approved/release", candidateSha);
    const explicitResult = preflight(root, candidateSha, [
      "--approved-ref", "refs/approved/release",
    ]);
    expect(explicitResult.status).toBe(0);
  });

  it("records and verifies an immutable Docker image id in build and deploy", () => {
    const build = readFileSync(BUILD, "utf8");
    const deploy = readFileSync(DEPLOY, "utf8");

    expect(build).toContain('git -C "$REPO_ROOT" archive "$TARGET_SHA"');
    expect(build).toContain("docker image inspect --format '{{.Id}}'");
    expect(build).toContain("imageId:process.argv[3]");
    expect(deploy).toContain("image id does not match the recorded build artifact");
    expect(deploy).toContain("running container image id does not match verified image id");
    expect(deploy).toContain("const patch = { gitSha, imageTag, imageId, deployedAt, operator }");
    expect(deploy).toContain('--mount "type=bind,src=${DATASET_ROOT},dst=${DATASET_ROOT},readonly"');
    expect(deploy).toContain('--mount "type=bind,src=${CHECKPOINT_ROOT},dst=/var/lib/waia/scientific-checkpoints"');
    expect(deploy).toContain('-e "WAIA_FHV_CHECKPOINT_ROOT=/var/lib/waia/scientific-checkpoints"');
    expect(deploy.indexOf('createScientificCheckpointStoreV1')).toBeLessThan(deploy.indexOf('docker rm -f'));
  });

  it("supplies the required checkpoint path in both runtime preflight invocations", () => {
    for (const script of [DEPLOY, PREPARE_PROPOSAL]) {
      const content = readFileSync(script, "utf8");
      const beforeRuntime = content.slice(0, content.indexOf("entrypoint.mjs --preflight-runtime"));
      const command = beforeRuntime.slice(beforeRuntime.lastIndexOf("docker run"));
      expect(command).toContain('-e "WAIA_FHV_CHECKPOINT_ROOT=/var/lib/waia/scientific-checkpoints"');
    }
  });

  it("prepares the technical proposal from the exact image and a read-only dataset", () => {
    const prepare = readFileSync(PREPARE_PROPOSAL, "utf8");
    expect(prepare).toContain("run_preflight");
    expect(prepare).toContain("image id does not match the recorded build artifact");
    expect(prepare).toContain("entrypoint.mjs --preflight-runtime");
    expect(prepare).toContain(
      '--mount "type=bind,src=${DATASET_ROOT},dst=${DATASET_ROOT},readonly"',
    );
    expect(prepare).toContain("historical-simulation-v2-prepare-proposal.ts");
    expect(prepare).toContain('--mount "type=bind,src=${CHECKPOINT_ROOT},dst=/var/lib/waia/scientific-checkpoints"');
    expect(prepare).toContain('checkpoint-root must be outside the read-only source dataset');
    expect(prepare).toContain("Human ratification is still required");
  });
});
