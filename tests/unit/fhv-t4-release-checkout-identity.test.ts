import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  verifyFhvReleaseCheckoutIdentity,
  writeFhvT4CheckoutIdentityProofAtomic,
} from "@/lib/trader/observability/fhv-t4-release-checkout-identity";

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function initRepo(): { repo: string; sha: string; tag: string } {
  root = mkdtempSync(join(tmpdir(), "fhv-checkout-id-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo, stdio: "pipe" });
  writeFileSync(join(repo, "README.md"), "ok\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repo, stdio: "pipe" });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const tag = "v2026.07.24.checkout-test";
  execFileSync("git", ["tag", tag, sha], { cwd: repo, stdio: "pipe" });
  return { repo, sha, tag };
}

describe("fhv-release-checkout-identity (DEE-436)", () => {
  it("passes when HEAD, tag peel, and tracked tree match", () => {
    const { repo, sha, tag } = initRepo();
    const verified = verifyFhvReleaseCheckoutIdentity({
      repoPath: repo,
      targetSha: sha,
      releaseTag: tag,
    });
    expect(verified.headSha).toBe(sha);
    expect(verified.tagPeelSha).toBe(sha);
    expect(verified.trackedTreeClean).toBe(true);
  });

  it("rejects HEAD mismatch and dirty tracked tree", () => {
    const { repo, sha, tag } = initRepo();
    writeFileSync(join(repo, "README.md"), "dirty\n");
    expect(() =>
      verifyFhvReleaseCheckoutIdentity({
        repoPath: repo,
        targetSha: sha,
        releaseTag: tag,
      }),
    ).toThrow(/TREE_DIRTY|clean/);

    execFileSync("git", ["checkout", "--", "README.md"], { cwd: repo, stdio: "pipe" });
    expect(() =>
      verifyFhvReleaseCheckoutIdentity({
        repoPath: repo,
        targetSha: "a".repeat(40),
        releaseTag: tag,
      }),
    ).toThrow(/HEAD_MISMATCH|UNRESOLVED|target/i);
  });

  it("writes immutable proof and refuses non-identical overwrite", () => {
    const { repo, sha, tag } = initRepo();
    const runRoot = join(root, "run");
    mkdirSync(join(runRoot, "control"), { recursive: true });
    const first = writeFhvT4CheckoutIdentityProofAtomic({
      runRoot,
      repoPath: repo,
      targetSha: sha,
      releaseTag: tag,
      runId: "run-a",
      organizationId: "00000000-0000-4000-8000-000000000001",
      capturedAtUtc: "2026-07-24T00:00:00.000Z",
    });
    const again = writeFhvT4CheckoutIdentityProofAtomic({
      runRoot,
      repoPath: repo,
      targetSha: sha,
      releaseTag: tag,
      runId: "run-a",
      organizationId: "00000000-0000-4000-8000-000000000001",
      capturedAtUtc: "2026-07-24T00:00:00.000Z",
    });
    expect(again.contentDigest).toBe(first.contentDigest);
    expect(() =>
      writeFhvT4CheckoutIdentityProofAtomic({
        runRoot,
        repoPath: repo,
        targetSha: sha,
        releaseTag: tag,
        runId: "run-b",
        organizationId: "00000000-0000-4000-8000-000000000001",
        capturedAtUtc: "2026-07-24T00:00:00.000Z",
      }),
    ).toThrow(/already exists with different content/i);
  });

  it("shell CLI rejects unknown flags", () => {
    const script = join(process.cwd(), "scripts/ops/fhv-release-checkout-identity.sh");
    expect(() =>
      execFileSync("bash", [script, "--repo-path", "/tmp", "--unknown-flag", "x"], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("shell CLI requires --git-bin and --python-bin", () => {
    const script = join(process.cwd(), "scripts/ops/fhv-release-checkout-identity.sh");
    const { repo, sha, tag } = initRepo();
    expect(() =>
      execFileSync(
        "bash",
        [script, "--repo-path", repo, "--target-sha", sha, "--release-tag", tag],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow();
  });
});
