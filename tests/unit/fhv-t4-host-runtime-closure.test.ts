import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyFhvT4CampaignCliExit } from "@/lib/trader/observability/fhv-t4-campaign-cli-verdict";
import {
  FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION,
  writeFhvT4CampaignRuntimeProof,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import { resolveFhvRehearsalCliConfig } from "@/scripts/trader/fhv-rehearsal-cli";
import {
  assertFhvT4CompletedCampaignProcessUnchanged,
  parseFhvT4CompletedCampaignSystemdIdentity,
} from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import {
  FHV_T4_TEST_BOOT_ID,
  FHV_T4_TEST_STARTED_NS,
  fhvT4CompletedCampaignIdentity,
  fhvT4HostMonotonicSample,
  installFhvT4HostMonotonicTestReader,
  writeFhvT4TestCampaignRuntimeStart,
} from "../helpers/fhv-t4-test-fixtures";

const ROOT = process.cwd();
const TARGET_SHA = "a".repeat(40);
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const RUN_ID = "fhv-t4-host-runtime";

function runBash(script: string, args: string[] = []): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("bash", [script, ...args], { encoding: "utf8" });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

describe("fhv-t4 host runtime closure (DEE-436)", () => {
  let tempDir = "";
  let cleanupMonotonic: (() => void) | undefined;

  afterEach(() => {
    cleanupMonotonic?.();
    cleanupMonotonic = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
    vi.restoreAllMocks();
  });

  it("origin validator accepts only approved https origin", () => {
    const script = join(ROOT, "scripts/ops/fhv-validate-origin-url.sh");
    const ok = runBash(script, ["--origin-url", "https://github.com/oumaster369/waia.git"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("FHV_T4_ORIGIN_URL_OK");

    for (const bad of [
      "https://user:pass@github.com/oumaster369/waia.git",
      "git@github.com:oumaster369/waia.git",
      "https://github.com/oumaster369/waia.git?token=x",
      "https://github.com/other/waia.git",
    ]) {
      const result = runBash(script, ["--origin-url", bad]);
      expect(result.exitCode).not.toBe(0);
    }
  });

  it("rehearsal CLI rejects missing artifact-root and duplicate flags", () => {
    expect(() =>
      resolveFhvRehearsalCliConfig({} as NodeJS.ProcessEnv, [
        "--target-sha",
        TARGET_SHA,
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
      ]),
    ).toThrow(/artifact-root/i);

    expect(() =>
      resolveFhvRehearsalCliConfig({} as NodeJS.ProcessEnv, [
        "--target-sha",
        TARGET_SHA,
        "--run-id",
        RUN_ID,
        "--organization-id",
        ORG_ID,
        "--artifact-root",
        "/tmp/artifacts",
        "--artifact-root",
        "/tmp/other",
      ]),
    ).toThrow(/Duplicate flag/i);
  });

  it("T4 campaign CLI verdict ignores wall-clock jumps when runtime proof is within budget", () => {
    tempDir = mkdtempSync(join(tmpdir(), "fhv-wall-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
      fhvT4HostMonotonicSample("290000000000"),
    ]);
    writeFhvT4TestCampaignRuntimeStart(tempDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    const withoutDigest = {
      schemaVersion: FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK" as const,
      hostBootId: FHV_T4_TEST_BOOT_ID,
      startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
      completedMonotonicNs: "290000000000",
      elapsedMonotonicNs: "289000000000",
      maxBudgetMs: 300_000,
      startedAtUtc: new Date(0).toISOString(),
      completedAtUtc: new Date().toISOString(),
    };
    writeFhvT4CampaignRuntimeProof(tempDir, withoutDigest);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 9_999_999_999);
    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_OK",
      t4Deterministic: true,
      runRoot: tempDir,
      repoRoot: tempDir,
      wallClockStartedAtMs: Date.now() - 9_999_999_999,
      maxRuntimeMs: 1,
    });
    expect(verdict.exitCode).toBe(0);
  });

  it("completed campaign identity accepts inactive success and rejects reactivation", () => {
    const before = fhvT4CompletedCampaignIdentity({});
    const after = fhvT4CompletedCampaignIdentity({});
    assertFhvT4CompletedCampaignProcessUnchanged({ before, after });

    expect(() =>
      assertFhvT4CompletedCampaignProcessUnchanged({
        before,
        after: fhvT4CompletedCampaignIdentity({ invocationId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }),
      }),
    ).toThrow(/InvocationID must remain unchanged/i);

    expect(() =>
      parseFhvT4CompletedCampaignSystemdIdentity({
        ...before,
        activeState: "active",
        contentDigest: before.contentDigest,
      }),
    ).toThrow(/must be inactive/i);
  });

  it("host preflight is read-only without --output", () => {
    tempDir = mkdtempSync(join(tmpdir(), "fhv-preflight-"));
    const envFile = join(tempDir, "fhv.env");
    writeFileSync(
      envFile,
      "FHV_HOST_OS_QUALIFIED=true\nFHV_COMMAND_ENFORCEMENT_ENABLED=true\n",
      "utf8",
    );
    const script = join(ROOT, "scripts/ops/fhv-t4-host-preflight.sh");
    const result = runBash(script, [
      "--expected-hostname",
      "wrong-host",
      "--expected-machine-id-sha256",
      "deadbeef",
      "--service-user",
      "nobody",
      "--environment-file",
      envFile,
      "--artifact-root",
      join(tempDir, "artifacts"),
      "--checkout-parent",
      tempDir,
      "--node-bin",
      "/bin/true",
      "--corepack-bin",
      "/bin/true",
      "--git-bin",
      "/bin/true",
      "--python-bin",
      "/usr/bin/python3",
      "--docker-bin",
      "/bin/true",
      "--expected-legacy-container-name",
      "legacy",
      "--expected-legacy-container-image",
      "legacy:latest",
    ]);
    expect(result.exitCode).not.toBe(0);
  });

  it("release checkout identity shell verifier emits stable JSON without node", () => {
    tempDir = mkdtempSync(join(tmpdir(), "fhv-git-"));
    execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: tempDir });
    writeFileSync(join(tempDir, "README"), "x\n", "utf8");
    execFileSync("git", ["add", "README"], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/oumaster369/waia.git"], {
      cwd: tempDir,
    });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["tag", "fhv-test-tag"], { cwd: tempDir });
    const shell = join(ROOT, "scripts/ops/fhv-release-checkout-identity.sh");
    chmodSync(shell, 0o755);
    const result = runBash(shell, [
      "--repo-path",
      tempDir,
      "--target-sha",
      sha,
      "--release-tag",
      "fhv-test-tag",
      "--git-bin",
      "/usr/bin/git",
      "--python-bin",
      "/usr/bin/python3",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("FHV_T4_CHECKOUT_IDENTITY_OK");
    expect(result.stdout).toContain('"classification":"FHV_T4_CHECKOUT_IDENTITY_OK"');
  });
});
