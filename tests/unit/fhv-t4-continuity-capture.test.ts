import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import {
  captureFhvT4ContinuitySnapshot,
  verifyFhvT4ContinuitySnapshots,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import {
  resolveFhvRehearsalAlertPolicyDigest,
  resolveFhvRehearsalRunDirectory,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  ensureFhvT4CampaignRuntimeStarted,
  finalizeFhvT4CampaignRuntimeProof,
  readFhvT4CampaignRuntimeProof,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  resolveFhvT4ContinuityCliConfig,
  runFhvT4ContinuityCli,
} from "@/scripts/trader/fhv-t4-continuity-cli";
import {
  FHV_T4_TEST_BOOT_ID,
  FHV_T4_TEST_STARTED_NS,
  fhvT4HostMonotonicSample,
  fhvT4ObserverIdentity,
  installFhvT4HostMonotonicTestReader,
  writeFhvT4TestCampaignRuntimeProof,
} from "../helpers/fhv-t4-test-fixtures";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-continuity";
const ORG_ID = "00000000-0000-4000-8000-000000000437";

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

describe("fhv-t4 campaign runtime start/finalize (DEE-436)", () => {
  it("writes start marker once and finalizes shared-budget proof", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-runtime-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([
      fhvT4HostMonotonicSample("290000000000"),
    ]);
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    mkdirSync(runDir, { recursive: true });

    const start = ensureFhvT4CampaignRuntimeStarted(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK",
      hostBootId: FHV_T4_TEST_BOOT_ID,
      startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
      repoRoot: root,
    });
    expect(start.startedMonotonicNs).toBe(FHV_T4_TEST_STARTED_NS);

    const again = ensureFhvT4CampaignRuntimeStarted(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK",
      hostBootId: FHV_T4_TEST_BOOT_ID,
      startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
      repoRoot: root,
    });
    expect(again.startedMonotonicNs).toBe(FHV_T4_TEST_STARTED_NS);

    const proof = finalizeFhvT4CampaignRuntimeProof(runDir, { repoRoot: root });
    expect(proof.startedMonotonicNs).toBe(FHV_T4_TEST_STARTED_NS);
    expect(proof.completedMonotonicNs).toBe("290000000000");
    expect(proof.targetSha).toBe(TARGET_SHA);
    expect(readFhvT4CampaignRuntimeProof(runDir)?.fixtureId).toBe("HTR_WP03_BENCHMARK");
  });

  it("finalize rejects completed monotonic before started monotonic", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-runtime-"));
    cleanupMonotonic = installFhvT4HostMonotonicTestReader([fhvT4HostMonotonicSample("500000000")]);
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    mkdirSync(runDir, { recursive: true });
    ensureFhvT4CampaignRuntimeStarted(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      fixtureId: "HTR_WP03_BENCHMARK",
      hostBootId: FHV_T4_TEST_BOOT_ID,
      startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
      repoRoot: root,
    });
    expect(() => finalizeFhvT4CampaignRuntimeProof(runDir, { repoRoot: root })).toThrow(
      /completedMonotonicNs must be >= startedMonotonicNs/,
    );
  });
});

describe("fhv-t4 continuity capture (DEE-436)", () => {
  it("verify rejects changed digest between before and after", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-cont-"));
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    const repoRoot = root;
    mkdirSync(join(runDir, "control"), { recursive: true });

    const manifest = {
      schemaVersion: "fhv-rehearsal-launch/v1",
      fixtureId: "HTR_WP03_BENCHMARK",
      targetSha: TARGET_SHA,
      runId: RUN_ID,
      organizationId: ORG_ID,
      artifactRoot: root,
      alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
      maxRuntimeMs: 300_000,
      t4DeterministicPause: true,
      deterministicPauseAtCycle: 40,
    };
    writeFileSync(
      join(runDir, "fhv-rehearsal-manifest.v1.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "replay-checkpoint.json"),
      `${JSON.stringify(
        {
          rehearsalEconomicFrontierState: {
            mode: "QUIESCENT_NO_ECONOMIC_STATE",
            runId: RUN_ID,
            organizationId: ORG_ID,
            safeResumeThroughCycleIndex: 39,
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(runDir, "fhv-resume-runtime-proof.v1.json"),
      `${JSON.stringify({ fullHistoryRescanDelta: 0 }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "run-chain.json"),
      `${JSON.stringify({ schemaVersion: "htr-wp05-run-chain/v1", segments: [] }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "control/command-ledger.jsonl"),
      `${JSON.stringify({ command: { action: "PAUSE_AT_CHECKPOINT" } })}\n`,
    );
    writeFhvT4TestCampaignRuntimeProof(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    writeFhvSystemdDeployedRevisionAtomic(repoRoot, {
      releaseSha: TARGET_SHA,
      releaseTag: "v2026.07.24.test437",
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
        [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "fhv",
      legacyContainerRunning: true,
    });

    const beforeIdentity = fhvT4ObserverIdentity({
      invocationId: "11111111111111111111111111111111",
      mainPid: 100,
    });
    const afterIdentity = fhvT4ObserverIdentity({
      invocationId: "22222222222222222222222222222222",
      mainPid: 200,
    });

    const before = captureFhvT4ContinuitySnapshot({
      runRoot: runDir,
      repoRoot,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      capturePhase: "before_disconnect",
      observerSystemdIdentity: beforeIdentity,
      operatorEvent: "SSH_DISCONNECT",
    });
    const after = captureFhvT4ContinuitySnapshot({
      runRoot: runDir,
      repoRoot,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      capturePhase: "after_reconnect",
      observerSystemdIdentity: afterIdentity,
      operatorEvent: "SSH_RECONNECT",
    });
    expect(verifyFhvT4ContinuitySnapshots({ before, after }).classification).toBe(
      "FHV_T4_CONTINUITY_VERIFICATION_PASS",
    );

    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK", tampered: true }, null, 2)}\n`,
    );
    const afterTampered = captureFhvT4ContinuitySnapshot({
      runRoot: runDir,
      repoRoot,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      capturePhase: "after_reconnect",
      observerSystemdIdentity: afterIdentity,
      operatorEvent: "SSH_RECONNECT",
    });
    expect(() => verifyFhvT4ContinuitySnapshots({ before, after: afterTampered })).toThrow(
      /Continuity digest changed/,
    );
  });

  it("CLI verify emits FHV_T4_CONTINUITY_VERIFICATION_PASS", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-cont-cli-"));
    const runDir = resolveFhvRehearsalRunDirectory(root, RUN_ID);
    const repoRoot = root;
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFileSync(
      join(runDir, "fhv-rehearsal-manifest.v1.json"),
      `${JSON.stringify(
        {
          schemaVersion: "fhv-rehearsal-launch/v1",
          fixtureId: "HTR_WP03_BENCHMARK",
          targetSha: TARGET_SHA,
          runId: RUN_ID,
          organizationId: ORG_ID,
          artifactRoot: root,
          alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
          maxRuntimeMs: 300_000,
          t4DeterministicPause: true,
          deterministicPauseAtCycle: 40,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "replay-checkpoint.json"),
      `${JSON.stringify(
        {
          rehearsalEconomicFrontierState: {
            mode: "QUIESCENT_NO_ECONOMIC_STATE",
            runId: RUN_ID,
            organizationId: ORG_ID,
            safeResumeThroughCycleIndex: 39,
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(runDir, "fhv-resume-runtime-proof.v1.json"),
      `${JSON.stringify({ fullHistoryRescanDelta: 0 }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "run-chain.json"),
      `${JSON.stringify({ schemaVersion: "htr-wp05-run-chain/v1", segments: [] }, null, 2)}\n`,
    );
    writeFileSync(
      join(runDir, "control/command-ledger.jsonl"),
      `${JSON.stringify({ command: { action: "PAUSE_AT_CHECKPOINT" } })}\n`,
    );
    writeFhvT4TestCampaignRuntimeProof(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    writeFhvSystemdDeployedRevisionAtomic(repoRoot, {
      releaseSha: TARGET_SHA,
      releaseTag: "v2026.07.24.test437",
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: {
        [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
        [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
      },
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "fhv",
      legacyContainerRunning: true,
    });

    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    writeFileSync(
      beforePath,
      `${JSON.stringify(
        captureFhvT4ContinuitySnapshot({
          runRoot: runDir,
          repoRoot,
          runId: RUN_ID,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
          capturePhase: "before_disconnect",
          observerSystemdIdentity: fhvT4ObserverIdentity({
            invocationId: "11111111111111111111111111111111",
            mainPid: 100,
          }),
          operatorEvent: "SSH_DISCONNECT",
        }),
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      afterPath,
      `${JSON.stringify(
        captureFhvT4ContinuitySnapshot({
          runRoot: runDir,
          repoRoot,
          runId: RUN_ID,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
          capturePhase: "after_reconnect",
          observerSystemdIdentity: fhvT4ObserverIdentity({
            invocationId: "22222222222222222222222222222222",
            mainPid: 200,
          }),
          operatorEvent: "SSH_RECONNECT",
        }),
        null,
        2,
      )}\n`,
    );

    const config = resolveFhvT4ContinuityCliConfig(process.env, [
      "verify",
      "--before",
      beforePath,
      "--after",
      afterPath,
      "--run-root",
      runDir,
      "--run-id",
      RUN_ID,
      "--organization-id",
      ORG_ID,
      "--target-sha",
      TARGET_SHA,
    ]);
    const result = await runFhvT4ContinuityCli(config);
    expect(result.exitCode).toBe(0);
    expect(result.lines.some((line) => line.includes("FHV_T4_CONTINUITY_VERIFICATION_PASS"))).toBe(
      true,
    );
  });
});
