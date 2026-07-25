import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyFhvT4CampaignCliExit } from "@/lib/trader/observability/fhv-t4-campaign-cli-verdict";
import { writeFhvT4CampaignRuntimeProof } from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import {
  FHV_T4_TEST_BOOT_ID,
  FHV_T4_TEST_STARTED_NS,
  fhvT4HostMonotonicSample,
  installFhvT4HostMonotonicTestReader,
  writeFhvT4TestCampaignRuntimeStart,
} from "../helpers/fhv-t4-test-fixtures";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4-pause-exit";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

let root = "";
let cleanupMonotonic: (() => void) | undefined;

afterEach(() => {
  cleanupMonotonic?.();
  cleanupMonotonic = undefined;
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
  vi.restoreAllMocks();
});

describe("fhv-t4 controlled pause exit contract (DEE-436)", () => {
  it("REHEARSAL_PAUSED exits 0 without final runtime proof", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-pause-exit-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
      fhvT4HostMonotonicSample("150000000000"),
    ]);
    writeFhvT4TestCampaignRuntimeStart(root, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    writeFileSync(
      join(root, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify(
        {
          classification: "REHEARSAL_PAUSED",
          actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
        },
        null,
        2,
      )}\n`,
    );

    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_PAUSED",
      t4Deterministic: true,
      runRoot: root,
      repoRoot: root,
      wallClockStartedAtMs: Date.now() - 9_999_999_999,
      maxRuntimeMs: 1,
    });
    expect(verdict.exitCode).toBe(0);
  });

  it("REHEARSAL_OK requires final runtime proof", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-pause-exit-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
      fhvT4HostMonotonicSample("290000000000"),
    ]);
    writeFhvT4TestCampaignRuntimeStart(root, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    writeFhvT4CampaignRuntimeProof(root, {
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
    });

    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_OK",
      t4Deterministic: true,
      runRoot: root,
      repoRoot: root,
      wallClockStartedAtMs: Date.now(),
      maxRuntimeMs: 300_000,
    });
    expect(verdict.exitCode).toBe(0);
  });

  it("fails when start marker missing", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-pause-exit-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
    ]);
    writeFileSync(
      join(root, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_PAUSED", actualPauseCycle: 40 }, null, 2)}\n`,
    );
    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_PAUSED",
      t4Deterministic: true,
      runRoot: root,
      repoRoot: root,
      wallClockStartedAtMs: Date.now(),
      maxRuntimeMs: 300_000,
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.reason).toMatch(/START_MISSING/i);
  });

  it("fails when host boot ID changes during pause", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-pause-exit-"));
    writeFhvT4TestCampaignRuntimeStart(root, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      hostBootId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ]);
    writeFileSync(
      join(root, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify(
        { classification: "REHEARSAL_PAUSED", actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE },
        null,
        2,
      )}\n`,
    );
    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_PAUSED",
      t4Deterministic: true,
      runRoot: root,
      repoRoot: root,
      wallClockStartedAtMs: Date.now(),
      maxRuntimeMs: 300_000,
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.reason).toMatch(/BOOT_ID_CHANGED/i);
  });

  it("fails when pause exceeds shared monotonic budget", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-pause-exit-"));
    writeFhvT4TestCampaignRuntimeStart(root, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample("302000000000"),
    ]);
    writeFileSync(
      join(root, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify(
        { classification: "REHEARSAL_PAUSED", actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE },
        null,
        2,
      )}\n`,
    );
    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_PAUSED",
      t4Deterministic: true,
      runRoot: root,
      repoRoot: root,
      wallClockStartedAtMs: Date.now(),
      maxRuntimeMs: 300_000,
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.reason).toMatch(/BUDGET_EXCEEDED/i);
  });

  it("fails REHEARSAL_OK when final proof exceeds shared budget", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-pause-exit-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
    ]);
    writeFhvT4TestCampaignRuntimeStart(root, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    writeFhvT4CampaignRuntimeProof(root, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK" as const,
      hostBootId: FHV_T4_TEST_BOOT_ID,
      startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
      completedMonotonicNs: "302000000000",
      elapsedMonotonicNs: "301000000000",
      maxBudgetMs: 300_000,
      startedAtUtc: new Date(0).toISOString(),
      completedAtUtc: new Date().toISOString(),
    });
    const verdict = classifyFhvT4CampaignCliExit({
      classification: "REHEARSAL_OK",
      t4Deterministic: true,
      runRoot: root,
      repoRoot: root,
      wallClockStartedAtMs: Date.now(),
      maxRuntimeMs: 300_000,
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.reason).toMatch(/BUDGET_EXCEEDED/i);
  });
});
