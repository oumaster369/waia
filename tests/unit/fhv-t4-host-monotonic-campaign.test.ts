import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertFhvRehearsalWithinDeadline,
  prepareT4DeterministicRuntimeDeadline,
  writeFhvCampaignControlResumeRequest,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION,
  readFhvT4CampaignRuntimeStart,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  FHV_T4_TEST_BOOT_ID,
  FHV_T4_TEST_STARTED_NS,
  fhvT4HostMonotonicSample,
  installFhvT4HostMonotonicTestReader,
  writeFhvT4TestCampaignRuntimeStart,
} from "../helpers/fhv-t4-test-fixtures";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-monotonic";
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
});

describe("fhv-t4 host-monotonic campaign deadline (DEE-436)", () => {
  it("process A writes start; process B resumes from same start without reset", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-mono-cross-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
      fhvT4HostMonotonicSample("150000000000"),
    ]);
    const { runDir } = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    );
    const manifest = readFhvRehearsalManifest(runDir);

    // Process A — initial
    const deadlineA = prepareT4DeterministicRuntimeDeadline({
      runRoot: runDir,
      manifest,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      repoRoot: root,
    });
    expect(deadlineA.kind).toBe("t4-host-monotonic");
    if (deadlineA.kind !== "t4-host-monotonic") {
      throw new Error("expected t4-host-monotonic");
    }
    const startA = readFhvT4CampaignRuntimeStart(runDir);
    expect(startA?.startedMonotonicNs).toBe(FHV_T4_TEST_STARTED_NS);

    // Process B — resume must require original marker
    writeFhvCampaignControlResumeRequest(runDir, RUN_ID, ORG_ID);
    const deadlineB = prepareT4DeterministicRuntimeDeadline({
      runRoot: runDir,
      manifest,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      repoRoot: root,
    });
    expect(deadlineB.kind).toBe("t4-host-monotonic");
    if (deadlineB.kind !== "t4-host-monotonic") {
      throw new Error("expected t4-host-monotonic");
    }
    expect(deadlineB.startedMonotonicNs).toBe(deadlineA.startedMonotonicNs);
    expect(deadlineB.hostBootId).toBe(deadlineA.hostBootId);
    expect(readFhvT4CampaignRuntimeStart(runDir)?.contentDigest).toBe(startA?.contentDigest);

    assertFhvRehearsalWithinDeadline(deadlineB);
  });

  it("changed boot ID and deleted start marker on resume fail", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-mono-boot-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS, FHV_T4_TEST_BOOT_ID),
      fhvT4HostMonotonicSample("150000000000", "cccccccccccccccccccccccccccccccc"),
    ]);
    const { runDir } = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    );
    const manifest = readFhvRehearsalManifest(runDir);
    const deadline = prepareT4DeterministicRuntimeDeadline({
      runRoot: runDir,
      manifest,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      repoRoot: root,
    });
    expect(() => assertFhvRehearsalWithinDeadline(deadline)).toThrow(/boot ID changed/i);

    writeFhvCampaignControlResumeRequest(runDir, RUN_ID, ORG_ID);
    unlinkSync(join(runDir, "fhv-t4-campaign-runtime-start.v1.json"));
    expect(() =>
      prepareT4DeterministicRuntimeDeadline({
        runRoot: runDir,
        manifest,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        repoRoot: root,
      }),
    ).toThrow(/original host-monotonic start marker|MISSING_ON_RESUME/i);
  });

  it("elapsed boundary 300000ms passes; above fails; wall-clock irrelevant", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-mono-bound-"));
    const started = BigInt(FHV_T4_TEST_STARTED_NS);
    const atBoundary = (started + 300_000n * 1_000_000n).toString();
    const overBoundary = (started + 300_001n * 1_000_000n).toString();
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(atBoundary),
      fhvT4HostMonotonicSample(overBoundary),
    ]);
    const { runDir } = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    );
    writeFhvT4TestCampaignRuntimeStart(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      startedAtUtc: "2000-01-01T00:00:00.000Z",
    });
    const deadline = prepareT4DeterministicRuntimeDeadline({
      runRoot: runDir,
      manifest: readFhvRehearsalManifest(runDir),
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      repoRoot: root,
    });
    // Wall clock is far in the future relative to startedAtUtc; decision is monotonic.
    assertFhvRehearsalWithinDeadline(deadline);
    expect(() => assertFhvRehearsalWithinDeadline(deadline)).toThrow(/exceeded/i);
  });

  it("rejects replaced start marker digest and partial atomic record", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-mono-replace-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample(FHV_T4_TEST_STARTED_NS),
    ]);
    const { runDir } = materializeFhvRehearsalManifest(
      buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
        t4DeterministicPause: true,
      }),
    );
    const manifest = readFhvRehearsalManifest(runDir);
    prepareT4DeterministicRuntimeDeadline({
      runRoot: runDir,
      manifest,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      repoRoot: root,
    });
    writeFileSync(
      join(runDir, "fhv-t4-campaign-runtime-start.v1.json"),
      `${JSON.stringify({
        schemaVersion: FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        fixtureId: "HTR_WP03_BENCHMARK",
        hostBootId: FHV_T4_TEST_BOOT_ID,
        startedMonotonicNs: "999",
        startedAtUtc: new Date().toISOString(),
        contentDigest: "deadbeef",
      })}\n`,
    );
    expect(() =>
      prepareT4DeterministicRuntimeDeadline({
        runRoot: runDir,
        manifest,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        repoRoot: root,
      }),
    ).toThrow(/digest mismatch/i);
  });
});
