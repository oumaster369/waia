import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(prepare).toContain("Human ratification is still required");
  });
});
