import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { HTR_WP03_BENCHMARK_FIXTURE_SHA256 } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  readReplayCheckpoint,
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  serializeCheckpoint,
  writeReplayCheckpoint,
  ReplayCheckpointError,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  assertFhvCampaignIdentityFrontierPresent,
  FhvCampaignIdentityError,
  validateFhvCampaignIdentityFrontier,
} from "@/lib/trader/observability/fhv-campaign-identity";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { assertFhvRehearsalResumeIdentity } from "@/lib/trader/observability/fhv-resume-identity-validator";
import {
  runFhvRehearsalCampaign,
  writeFhvCampaignControlResumeRequest,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-cross-process-negative";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

async function pauseCampaign(runDir: string, runId: string): Promise<void> {
  const pausePromise = runFhvRehearsalCampaign({
    runRoot: runDir,
    runId,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    testOnlyPauseAfterCycles: 45,
  });
  await pausePromise;
  writeFhvCampaignControlResumeRequest(runDir, runId, ORG_ID);
}

describe("FHV cross-process resume negative matrix (DEE-431)", () => {
  it("rejects missing identity frontier on resume", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-negative-missing-frontier-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;
      await pauseCampaign(runDir, RUN_ID);
      const checkpoint = readReplayCheckpoint(runDir)!;
      const { campaignIdentityFrontierState: _removed, ...withoutFrontier } = checkpoint;
      writeReplayCheckpoint(runDir, serializeCheckpoint(withoutFrontier));

      expect(() =>
        assertFhvRehearsalResumeIdentity({
          runRoot: runDir,
          manifest: config,
          targetSha: TARGET_SHA,
        }),
      ).toThrow(expect.objectContaining({ code: "FHV_RESUME_IDENTITY_FRONTIER_MISSING" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("rejects identity frontier counter rollback", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-negative-rollback-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;
      await pauseCampaign(runDir, RUN_ID);
      const checkpoint = readReplayCheckpoint(runDir)!;
      writeReplayCheckpoint(
        runDir,
        serializeCheckpoint({
          ...checkpoint,
          campaignIdentityFrontierState: {
            ...checkpoint.campaignIdentityFrontierState!,
            newIdSeq: 0,
            randomUuidSeq: 0,
          },
        }),
      );

      expect(() =>
        assertFhvRehearsalResumeIdentity({
          runRoot: runDir,
          manifest: config,
          targetSha: TARGET_SHA,
        }),
      ).toThrow(expect.objectContaining({ code: "FHV_RESUME_IDENTITY_FRONTIER_ROLLBACK" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("rejects wrong runId in identity frontier", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-negative-runid-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;
      await pauseCampaign(runDir, RUN_ID);
      const checkpoint = readReplayCheckpoint(runDir)!;
      writeReplayCheckpoint(
        runDir,
        serializeCheckpoint({
          ...checkpoint,
          campaignIdentityFrontierState: {
            ...checkpoint.campaignIdentityFrontierState!,
            runId: "wrong-run-id",
          },
        }),
      );

      expect(() =>
        assertFhvRehearsalResumeIdentity({
          runRoot: runDir,
          manifest: config,
          targetSha: TARGET_SHA,
        }),
      ).toThrow(expect.objectContaining({ code: "FHV_RESUME_IDENTITY_FRONTIER_MISMATCH" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("rejects checkpoint digest tampering", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-negative-digest-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;
      await pauseCampaign(runDir, RUN_ID);
      const checkpoint = readReplayCheckpoint(runDir)!;
      writeFileSync(
        join(runDir, "replay-checkpoint.json"),
        JSON.stringify({ ...checkpoint, checkpointDigest: "0".repeat(64) }, null, 2),
      );

      expect(() => readReplayCheckpoint(runDir)).toThrow(ReplayCheckpointError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("rejects malformed identity frontier schema", () => {
    expect(() =>
      validateFhvCampaignIdentityFrontier({
        frontier: {
          schemaVersion: "bogus/v0" as never,
          runId: RUN_ID,
          organizationId: ORG_ID,
          safeResumeThroughCycleIndex: 44,
          newIdSeq: 10,
          randomUuidSeq: 10,
        },
        runId: RUN_ID,
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: 44,
      }),
    ).toThrow(FhvCampaignIdentityError);
  });

  it("rejects identity frontier with mismatched checkpoint frontier index", () => {
    expect(() =>
      assertFhvCampaignIdentityFrontierPresent(
        {
          schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
          backtestRunId: RUN_ID,
          datasetContentDigest: "digest",
          datasetId: "fhv-rehearsal-wp03",
          codeSha: TARGET_SHA,
          activePhase: "validation",
          dbDurableThroughPhase: "none",
          evidenceDurableThroughCycleIndex: 44,
          safeResumeThroughCycleIndex: 44,
          evidenceRunDir: "/tmp/evidence",
          evidenceChainDigest: "chain",
          evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
          dbConnectionMode: "harness",
          replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
          fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
          campaignIdentityFrontierState: {
            schemaVersion: "fhv-campaign-identity-frontier/v1",
            runId: RUN_ID,
            organizationId: ORG_ID,
            safeResumeThroughCycleIndex: 99,
            newIdSeq: 10,
            randomUuidSeq: 10,
          },
          checkpointDigest: "",
        },
        ORG_ID,
      ),
    ).toThrow(FhvCampaignIdentityError);
  });
});
