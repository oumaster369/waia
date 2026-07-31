import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  serializeCheckpoint,
  writeReplayCheckpoint,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  appendFhvCommandLedger,
  writeFhvCommandResult,
} from "@/lib/trader/observability/fhv-command-ledger";
import {
  consumeFhvCampaignControlRequest,
  writeFhvCampaignControlRequest,
} from "@/lib/trader/observability/fhv-campaign-control-files";
import { readFhvCampaignControlRequest } from "@/lib/trader/observability/fhv-control-request-validator";
import { FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-campaign-identity";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import { buildSyntheticEconomicFrontier } from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";
import {
  assertFhvT4CampaignEntryBeforeStart,
  assertFhvT4ResumeEntryBeforeCampaignStart,
  isFhvT4ResumeCampaignStartPending,
} from "@/lib/trader/observability/fhv-t4-resume-entry";
import {
  FhvT4DeterministicPauseError,
  FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
  writeFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import {
  FHV_T4_PAUSED_PROOF_CLASSIFICATION,
  writeFhvT4PausedVerificationProofAtomic,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";
import { writeFhvRehearsalCampaignProgress } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const RUN_ID = "fhv-t4-resume-entry-test";
const RELEASE_TAG = "v2026.test.local";

function prepareT4Run(root: string): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId: RUN_ID,
    organizationId: ORG_ID,
    artifactRoot: root,
    t4DeterministicPause: true,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

function armPause(runDir: string): void {
  writeFhvT4PauseArmedRecord(runDir, {
    schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    fixtureId: "HTR_WP03_BENCHMARK",
    deterministicPauseAtCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    commandId: "cmd-pause",
    idempotencyKey: "idem-pause",
    operatorId: "t4-operator",
    armedAtUtc: new Date().toISOString(),
  });
  writeFhvCampaignControlRequest(runDir, {
    schemaVersion: "fhv-campaign-control-request/v1",
    action: "PAUSE_AT_CHECKPOINT",
    runId: RUN_ID,
    organizationId: ORG_ID,
    operatorId: "t4-operator",
    reason: "pre-arm",
    requestedAtUtc: new Date().toISOString(),
  });
}

function seedPausedTerminal(runDir: string, withProof: boolean): void {
  writeFhvRehearsalCampaignProgress(runDir, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: RUN_ID,
    cyclesProcessed: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    expectedCycles: 81,
    phase: "paused_at_checkpoint",
    updatedAtUtc: new Date().toISOString(),
  });
  writeFileSync(
    join(runDir, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify(
      {
        classification: "REHEARSAL_PAUSED",
        cyclesProcessed: FHV_REHEARSAL_CHECKPOINT_CYCLE,
        actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
      },
      null,
      2,
    )}\n`,
  );
  writeReplayCheckpoint(
    runDir,
    serializeCheckpoint({
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: RUN_ID,
      datasetContentDigest: "a".repeat(64),
      datasetId: "fhv-rehearsal-wp03",
      codeSha: TARGET_SHA,
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
      safeResumeThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
      evidenceRunDir: join(runDir, "streaming-evidence"),
      evidenceChainDigest: "b".repeat(64),
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "harness",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      fixtureSha256: "c".repeat(64),
      campaignIdentityFrontierState: {
        schemaVersion: FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION,
        runId: RUN_ID,
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
        newIdSeq: 1,
        randomUuidSeq: 1,
      },
      rehearsalEconomicFrontierState: buildSyntheticEconomicFrontier({
        runId: RUN_ID,
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
      }),
    }),
  );
  if (!withProof) {
    return;
  }
  const manifest = readFhvRehearsalManifest(runDir);
  writeFhvT4PausedVerificationProofAtomic(runDir, {
    releaseSha: TARGET_SHA,
    releaseTag: RELEASE_TAG,
    runId: RUN_ID,
    organizationId: ORG_ID,
    actualPauseCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    classification: FHV_T4_PAUSED_PROOF_CLASSIFICATION,
    pauseCommandId: "cmd-pause",
    pauseIdempotencyKey: "idem-pause",
    checkpointSafeResumeThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
    partialEvidenceTerminal: "STREAMING_EVIDENCE_SEALED_PARTIAL",
    alertPolicyDigest: manifest.alertPolicyDigest,
    checks: ["test"],
    capturedAtUtc: new Date().toISOString(),
  });
}

function writePendingResume(
  runDir: string,
  overrides: Partial<{ runId: string; orgId: string }> = {},
) {
  writeFhvCampaignControlRequest(runDir, {
    schemaVersion: "fhv-campaign-control-request/v1",
    action: "RESUME_FROM_CHECKPOINT",
    runId: overrides.runId ?? RUN_ID,
    organizationId: overrides.orgId ?? ORG_ID,
    operatorId: "t4-operator",
    reason: "resume",
    requestedAtUtc: new Date().toISOString(),
  });
}

function writeAcceptedResumeLedger(runDir: string, commandId = "cmd-resume"): void {
  appendFhvCommandLedger(runDir, {
    recordedAtUtc: new Date().toISOString(),
    source: "test",
    command: {
      schemaVersion: "fhv-operator-command/v1",
      commandId,
      campaignRunId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      action: "RESUME_FROM_CHECKPOINT",
      reason: "resume",
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      nonce: "resume-nonce",
      idempotencyKey: "idem-resume",
      expectedCampaignState: { phase: "PAUSED_RESUMABLE", checkpointSeq: 40 },
      confirmationPhraseClass: "RESUME",
      signature: "test-signature",
      signatureAlgorithm: "HMAC-SHA256",
    },
  });
  writeFhvCommandResult(runDir, {
    schemaVersion: "fhv-command-result/v1",
    commandId,
    idempotencyKey: "idem-resume",
    status: "accepted",
    message: "accepted",
    completedAtUtc: new Date().toISOString(),
  });
}

describe("fhv-t4 resume entry gate (DEE-436)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("requires pending PAUSE for initial T4 campaign start", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-initial-gate-"));
    const runDir = prepareT4Run(root);
    const manifest = readFhvRehearsalManifest(runDir);
    armPause(runDir);
    const pauseRequest = readFhvCampaignControlRequest({
      runRoot: runDir,
      action: "PAUSE_AT_CHECKPOINT",
      runId: RUN_ID,
      organizationId: ORG_ID,
    })!;
    consumeFhvCampaignControlRequest(runDir, pauseRequest);
    expect(() =>
      assertFhvT4CampaignEntryBeforeStart({ runRoot: runDir, manifest, targetSha: TARGET_SHA }),
    ).toThrow(FhvT4DeterministicPauseError);
  });

  it("detects pending resume and skips initial PAUSE gate", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-resume-pending-"));
    const runDir = prepareT4Run(root);
    const manifest = readFhvRehearsalManifest(runDir);
    armPause(runDir);
    seedPausedTerminal(runDir, true);
    writePendingResume(runDir);
    writeAcceptedResumeLedger(runDir);
    expect(isFhvT4ResumeCampaignStartPending({ runRoot: runDir, manifest })).toBe(true);
    expect(() =>
      assertFhvT4CampaignEntryBeforeStart({
        runRoot: runDir,
        manifest,
        targetSha: TARGET_SHA,
        releaseTag: RELEASE_TAG,
      }),
    ).not.toThrow();
  });

  it("rejects resume start without paused proof", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-no-paused-proof-"));
    const runDir = prepareT4Run(root);
    const manifest = readFhvRehearsalManifest(runDir);
    armPause(runDir);
    seedPausedTerminal(runDir, false);
    writePendingResume(runDir);
    writeAcceptedResumeLedger(runDir);
    try {
      assertFhvT4ResumeEntryBeforeCampaignStart({
        runRoot: runDir,
        manifest,
        targetSha: TARGET_SHA,
      });
      expect.fail("expected resume entry rejection");
    } catch (error) {
      expect((error as FhvT4DeterministicPauseError).code).toBe("FHV_T4_PAUSED_PROOF_MISSING");
    }
  });

  it("rejects resume start with mismatched run identity", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-resume-mismatch-"));
    const runDir = prepareT4Run(root);
    const manifest = readFhvRehearsalManifest(runDir);
    armPause(runDir);
    seedPausedTerminal(runDir, true);
    writePendingResume(runDir, { runId: "wrong-run" });
    writeAcceptedResumeLedger(runDir);
    expect(() =>
      assertFhvT4ResumeEntryBeforeCampaignStart({
        runRoot: runDir,
        manifest,
        targetSha: TARGET_SHA,
        releaseTag: RELEASE_TAG,
      }),
    ).toThrow(FhvT4DeterministicPauseError);
  });

  it("rejects resume start without accepted RESUME ledger result", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-resume-not-accepted-"));
    const runDir = prepareT4Run(root);
    const manifest = readFhvRehearsalManifest(runDir);
    armPause(runDir);
    seedPausedTerminal(runDir, true);
    writePendingResume(runDir);
    try {
      assertFhvT4ResumeEntryBeforeCampaignStart({
        runRoot: runDir,
        manifest,
        targetSha: TARGET_SHA,
        releaseTag: RELEASE_TAG,
      });
      expect.fail("expected resume entry rejection");
    } catch (error) {
      expect((error as FhvT4DeterministicPauseError).code).toBe("FHV_T4_RESUME_LEDGER_MISSING");
    }
  });

  it("validates checkpoint frontier at cycle 40", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-t4-resume-checkpoint-"));
    const runDir = prepareT4Run(root);
    const manifest = readFhvRehearsalManifest(runDir);
    armPause(runDir);
    seedPausedTerminal(runDir, true);
    writeReplayCheckpoint(
      runDir,
      serializeCheckpoint({
        schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
        backtestRunId: RUN_ID,
        datasetContentDigest: "a".repeat(64),
        datasetId: "fhv-rehearsal-wp03",
        codeSha: TARGET_SHA,
        activePhase: "validation",
        dbDurableThroughPhase: "none",
        evidenceDurableThroughCycleIndex: 20,
        safeResumeThroughCycleIndex: 20,
        evidenceRunDir: join(runDir, "streaming-evidence"),
        evidenceChainDigest: "b".repeat(64),
        evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
        dbConnectionMode: "harness",
        replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      }),
    );
    writePendingResume(runDir);
    writeAcceptedResumeLedger(runDir);
    try {
      assertFhvT4ResumeEntryBeforeCampaignStart({
        runRoot: runDir,
        manifest,
        targetSha: TARGET_SHA,
        releaseTag: RELEASE_TAG,
      });
      expect.fail("expected resume entry rejection");
    } catch (error) {
      expect((error as FhvT4DeterministicPauseError).code).toBe(
        "FHV_T4_RESUME_CHECKPOINT_FRONTIER_INVALID",
      );
    }
  });
});
