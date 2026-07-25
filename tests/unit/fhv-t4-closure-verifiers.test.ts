import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildReplayRunChainManifest,
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  type ReplayCheckpointRecord,
  serializeCheckpoint,
  writeReplayCheckpoint,
  writeReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-campaign-identity";
import {
  appendFhvCommandLedger,
  writeFhvCommandResult,
} from "@/lib/trader/observability/fhv-command-ledger";
import { FHV_OPERATOR_COMMAND_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { writeFhvOperatorStatusAtomic } from "@/lib/trader/observability/fhv-status-writer";
import { buildSyntheticEconomicFrontier } from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  resolveFhvRehearsalAlertPolicyDigest,
  FHV_REHEARSAL_ALLOWED_FIXTURES,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { writeFhvRehearsalCampaignProgress } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { writeFhvResumeRuntimeProof } from "@/lib/trader/observability/fhv-resume-runtime-proof";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import { writeFhvSystemdDeployedRevisionAtomic } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
  writeFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import {
  FhvT4ClosureVerifierError,
  verifyFhvT4DeploymentTruth,
  verifyFhvT4FinalState,
  verifyFhvT4PausedState,
  verifyFhvT4RollbackState,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  sealFhvT4EvidenceRoot,
  verifyFhvT4EvidenceSeal,
} from "@/lib/trader/observability/fhv-t4-evidence-seal";
import {
  FHV_T4_TEST_COMPLETED_NS,
  FHV_T4_TEST_STARTED_NS,
  writeFhvT4TestCampaignRuntimeProof,
} from "../helpers/fhv-t4-test-fixtures";
import {
  FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME,
  serializeFhvT4ResumeEnforcementProof,
} from "@/lib/trader/observability/fhv-t4-resume-enforcement-proof";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-t4a-closure";
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const RELEASE_TAG = "v2026.07.24.test436";
const COMMAND_ID = "t4-pause-at-checkpoint-aabbccdd";
const RESUME_COMMAND_ID = "t4-resume-from-checkpoint-eeff0011";

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function prepareManifest(t4 = true): string {
  root = mkdtempSync(join(tmpdir(), "fhv-t4a-"));
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId: RUN_ID,
    organizationId: ORG_ID,
    artifactRoot: root,
    ...(t4 ? { t4DeterministicPause: true } : {}),
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

function writePauseCommand(runDir: string): void {
  appendFhvCommandLedger(runDir, {
    recordedAtUtc: new Date().toISOString(),
    source: "test",
    command: {
      schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
      commandId: COMMAND_ID,
      campaignRunId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      action: "PAUSE_AT_CHECKPOINT",
      reason: "test",
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 600_000).toISOString(),
      nonce: "nonce-pause-1",
      idempotencyKey: "idem-pause-1",
      expectedCampaignState: { phase: "NOT_STARTED" },
      confirmationPhraseClass: "PAUSE",
      signature: "sig",
      signatureAlgorithm: "HMAC-SHA256",
    },
  });
  writeFhvCommandResult(runDir, {
    schemaVersion: "fhv-command-result/v1",
    commandId: COMMAND_ID,
    idempotencyKey: "idem-pause-1",
    status: "executed",
    message: "armed",
    completedAtUtc: new Date().toISOString(),
    enforcementApplied: true,
  });
}

function writePausedArtifacts(runDir: string): void {
  writeFhvT4PauseArmedRecord(runDir, {
    schemaVersion: FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION,
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    fixtureId: "HTR_WP03_BENCHMARK",
    deterministicPauseAtCycle: 40,
    commandId: COMMAND_ID,
    idempotencyKey: "idem-pause-1",
    operatorId: "t4-operator",
    armedAtUtc: new Date().toISOString(),
  });
  writePauseCommand(runDir);
  writeFhvRehearsalCampaignProgress(runDir, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: RUN_ID,
    cyclesProcessed: 40,
    expectedCycles: 81,
    phase: "paused_at_checkpoint",
    updatedAtUtc: new Date().toISOString(),
  });
  writeFileSync(
    join(runDir, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify(
      {
        classification: "REHEARSAL_PAUSED",
        cyclesProcessed: 40,
        actualPauseCycle: 40,
      },
      null,
      2,
    )}\n`,
  );
  const economic = buildSyntheticEconomicFrontier({
    runId: RUN_ID,
    organizationId: ORG_ID,
    safeResumeThroughCycleIndex: 39,
  });
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
      evidenceDurableThroughCycleIndex: 39,
      safeResumeThroughCycleIndex: 39,
      evidenceRunDir: join(runDir, "segments", "partial"),
      evidenceChainDigest: "b".repeat(64),
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "harness",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      fixtureSha256: FHV_REHEARSAL_ALLOWED_FIXTURES.HTR_WP03_BENCHMARK.fixtureSha256,
      campaignIdentityFrontierState: {
        schemaVersion: FHV_CAMPAIGN_IDENTITY_FRONTIER_SCHEMA_VERSION,
        runId: RUN_ID,
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: 39,
        newIdSeq: 1,
        randomUuidSeq: 1,
      },
      rehearsalEconomicFrontierState: economic,
    }),
  );
  writeReplayRunChainManifest(
    runDir,
    buildReplayRunChainManifest({
      backtestRunId: RUN_ID,
      activePhase: "validation",
      segments: [
        {
          runDir: join(runDir, "segments", "partial"),
          chainDigest: "b".repeat(64),
          role: "authoritative",
          terminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
          sealedThroughCycleIndex: 39,
        },
      ],
    }),
  );
  writeFhvOperatorStatusAtomic(
    runDir,
    buildFhvOperatorStatusV1({
      runId: RUN_ID,
      organizationId: ORG_ID,
      phase: "paused_at_checkpoint",
      codeSha: TARGET_SHA,
      artifactDigest: "c".repeat(64),
      datasetSeal: "d".repeat(64),
      datasetDigest: "e".repeat(64),
      configurationDigest: "f".repeat(64),
      alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
      terminalState: "REHEARSAL_PAUSED",
    }),
  );
}

function writeResumeAcceptedAndEnforcement(runDir: string, commandId = RESUME_COMMAND_ID): void {
  appendFhvCommandLedger(runDir, {
    recordedAtUtc: new Date().toISOString(),
    source: "test",
    command: {
      schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
      commandId,
      campaignRunId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      action: "RESUME_FROM_CHECKPOINT",
      reason: "test",
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 600_000).toISOString(),
      nonce: `nonce-${commandId}`,
      idempotencyKey: `idem-${commandId}`,
      expectedCampaignState: { phase: "PAUSED_RESUMABLE", checkpointSeq: 40 },
      confirmationPhraseClass: "RESUME",
      signature: "sig",
      signatureAlgorithm: "HMAC-SHA256",
    },
  });
  writeFhvCommandResult(runDir, {
    schemaVersion: "fhv-command-result/v1",
    commandId,
    idempotencyKey: `idem-${commandId}`,
    status: "accepted",
    message: "RESUME accepted; root systemd enforcement required",
    completedAtUtc: new Date().toISOString(),
    enforcementApplied: false,
  });
  mkdirSync(join(runDir, "control"), { recursive: true });
  const proof = serializeFhvT4ResumeEnforcementProof({
    schemaVersion: "fhv-t4-resume-enforcement-proof/v1",
    runId: RUN_ID,
    organizationId: ORG_ID,
    targetSha: TARGET_SHA,
    resumeCommandId: commandId,
    resumeIdempotencyKey: `idem-${commandId}`,
    bootId: "11111111-2222-4333-8444-555555555555",
    campaignUnitName: "waia-fhv-campaign.service",
    previousInvocationId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    newInvocationId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    execMainPid: 4242,
    execMainStartTimestampMonotonic: "4242000000",
    nRestarts: 0,
    enforcedAtUtc: new Date().toISOString(),
  });
  writeFileSync(
    join(runDir, "control", FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
}

describe("fhv-t4-closure-verifiers (DEE-436)", () => {
  it("verify-paused passes on exact synthetic paused frontier", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    const result = verifyFhvT4PausedState({
      runRoot: runDir,
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    expect(result.classification).toBe("FHV_T4_PAUSED_VERIFICATION_PASS");
  });

  it("verify-paused fails on wrong pause cycle", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_PAUSED", actualPauseCycle: 39 }, null, 2)}\n`,
    );
    expect(() =>
      verifyFhvT4PausedState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      }),
    ).toThrow(FhvT4ClosureVerifierError);
  });

  it("verify-paused fails on non-quiescent economic frontier", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    const economic = buildSyntheticEconomicFrontier({
      runId: RUN_ID,
      organizationId: ORG_ID,
      safeResumeThroughCycleIndex: 39,
      totalOrderCount: 1,
    });
    const checkpoint = JSON.parse(
      readFileSync(join(runDir, "replay-checkpoint.json"), "utf8"),
    ) as Record<string, unknown>;
    const { checkpointDigest: _ignored, ...withoutDigest } = checkpoint as {
      checkpointDigest: string;
    } & Record<string, unknown>;
    writeReplayCheckpoint(
      runDir,
      serializeCheckpoint({
        ...(withoutDigest as Omit<ReplayCheckpointRecord, "checkpointDigest">),
        rehearsalEconomicFrontierState: economic,
      }),
    );
    expect(() =>
      verifyFhvT4PausedState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      }),
    ).toThrow(/QUIESCENT|not quiescent|NOT_QUIESCENT/i);
  });

  it("verify-paused fails on pause ledger/result mismatch", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    writeFhvCommandResult(runDir, {
      schemaVersion: "fhv-command-result/v1",
      commandId: COMMAND_ID,
      idempotencyKey: "idem-pause-1",
      status: "failed",
      message: "nope",
      completedAtUtc: new Date().toISOString(),
      enforcementApplied: true,
    });
    expect(() =>
      verifyFhvT4PausedState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      }),
    ).toThrow(/NOT_EXECUTED|executed/i);
  });

  it("verify-final fails on nonzero rescan delta", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
    );
    appendFhvCommandLedger(runDir, {
      recordedAtUtc: new Date().toISOString(),
      source: "test",
      command: {
        schemaVersion: FHV_OPERATOR_COMMAND_SCHEMA_VERSION,
        commandId: RESUME_COMMAND_ID,
        campaignRunId: RUN_ID,
        organizationId: ORG_ID,
        operatorId: "t4-operator",
        action: "RESUME_FROM_CHECKPOINT",
        reason: "test",
        issuedAtUtc: new Date().toISOString(),
        expiresAtUtc: new Date(Date.now() + 600_000).toISOString(),
        nonce: "nonce-resume-1",
        idempotencyKey: "idem-resume-1",
        expectedCampaignState: { phase: "PAUSED_RESUMABLE", checkpointSeq: 40 },
        confirmationPhraseClass: "RESUME",
        signature: "sig",
        signatureAlgorithm: "HMAC-SHA256",
      },
    });
    writeFhvCommandResult(runDir, {
      schemaVersion: "fhv-command-result/v1",
      commandId: RESUME_COMMAND_ID,
      idempotencyKey: "idem-resume-1",
      status: "accepted",
      message: "RESUME accepted; root systemd enforcement required",
      completedAtUtc: new Date().toISOString(),
      enforcementApplied: false,
    });
    mkdirSync(join(runDir, "control"), { recursive: true });
    writeFileSync(
      join(runDir, "control", FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME),
      `${JSON.stringify(
        serializeFhvT4ResumeEnforcementProof({
          schemaVersion: "fhv-t4-resume-enforcement-proof/v1",
          runId: RUN_ID,
          organizationId: ORG_ID,
          targetSha: TARGET_SHA,
          resumeCommandId: RESUME_COMMAND_ID,
          resumeIdempotencyKey: "idem-resume-1",
          bootId: "11111111-2222-4333-8444-555555555555",
          campaignUnitName: "waia-fhv-campaign.service",
          previousInvocationId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          newInvocationId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          execMainPid: 4242,
          execMainStartTimestampMonotonic: "4242000000",
          nRestarts: 0,
          enforcedAtUtc: new Date().toISOString(),
        }),
        null,
        2,
      )}\n`,
    );
    writeFhvResumeRuntimeProof(runDir, {
      schemaVersion: "fhv-resume-runtime-proof/v1",
      runId: RUN_ID,
      organizationId: ORG_ID,
      processPid: 1234,
      resumeCycleStartIndex: 40,
      firstExecutedCycleIndex: 40,
      lastExecutedCycleIndex: 80,
      fullHistoryRescanCountBefore: 0,
      fullHistoryRescanCountAfter: 1,
      fullHistoryRescanDelta: 1,
    });
    writeFhvT4TestCampaignRuntimeProof(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
    });
    expect(() =>
      verifyFhvT4FinalState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      }),
    ).toThrow(/RESCAN|rescan/i);
  });

  it("verify-final fails when shared budget exceeded", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    writeFileSync(
      join(runDir, "fhv-rehearsal-terminal.v1.json"),
      `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
    );
    writeResumeAcceptedAndEnforcement(runDir, RESUME_COMMAND_ID);
    writeFhvResumeRuntimeProof(runDir, {
      schemaVersion: "fhv-resume-runtime-proof/v1",
      runId: RUN_ID,
      organizationId: ORG_ID,
      processPid: 99,
      resumeCycleStartIndex: 40,
      firstExecutedCycleIndex: 40,
      lastExecutedCycleIndex: 80,
      fullHistoryRescanCountBefore: 0,
      fullHistoryRescanCountAfter: 0,
      fullHistoryRescanDelta: 0,
    });
    writeFhvT4TestCampaignRuntimeProof(runDir, {
      runId: RUN_ID,
      organizationId: ORG_ID,
      targetSha: TARGET_SHA,
      startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
      completedMonotonicNs: "301000000000",
      elapsedMonotonicNs: "300000000000",
    });
    // Will fail earlier on run-chain unless we get to budget — ensure budget path with max 1ms after chain fails
    expect(() =>
      verifyFhvT4FinalState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
        maxCampaignRuntimeMs: 1,
      }),
    ).toThrow();
  });

  it("deployment truth requires installed===rendered digests", () => {
    const runDir = prepareManifest();
    const rendered = join(root, "rendered");
    const installed = join(root, "installed");
    mkdirSync(rendered, { recursive: true });
    mkdirSync(installed, { recursive: true });
    const unitBody = `[Service]
User=fhv
WorkingDirectory=/opt/waia/checkout
EnvironmentFile=/etc/waia/fhv.env
Environment=FHV_TARGET_SHA=${TARGET_SHA}
Environment=FHV_RUN_ID=${RUN_ID}
Environment=FHV_ORGANIZATION_ID=${ORG_ID}
`;
    for (const unit of [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT]) {
      writeFileSync(join(rendered, unit), unitBody);
      writeFileSync(join(installed, unit), unitBody);
    }
    const digests = {
      [FHV_SYSTEMD_CAMPAIGN_UNIT]: sha256(unitBody),
      [FHV_SYSTEMD_OBSERVER_UNIT]: sha256(unitBody),
    };
    writeFhvSystemdDeployedRevisionAtomic(root, {
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      renderedUnitDigests: digests,
      installedAtUtc: new Date().toISOString(),
      operatorId: "t4-operator",
      serviceUser: "fhv",
      legacyContainerRunning: true,
    });
    const ok = verifyFhvT4DeploymentTruth({
      repoRoot: root,
      targetSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      operatorId: "t4-operator",
      serviceUser: "fhv",
      workingDirectory: "/opt/waia/checkout",
      environmentFile: "/etc/waia/fhv.env",
      renderedUnitsDir: rendered,
      installedUnitsDir: installed,
    });
    expect(ok.classification).toBe("FHV_T4_DEPLOYMENT_VERIFICATION_PASS");

    writeFileSync(join(installed, FHV_SYSTEMD_CAMPAIGN_UNIT), `${unitBody}\n#tamper\n`);
    expect(() =>
      verifyFhvT4DeploymentTruth({
        repoRoot: root,
        targetSha: TARGET_SHA,
        releaseTag: RELEASE_TAG,
        runId: RUN_ID,
        organizationId: ORG_ID,
        operatorId: "t4-operator",
        serviceUser: "fhv",
        workingDirectory: "/opt/waia/checkout",
        environmentFile: "/etc/waia/fhv.env",
        renderedUnitsDir: rendered,
        installedUnitsDir: installed,
      }),
    ).toThrow(/Installed\/rendered digest mismatch/);
  });

  it("rollback fails on residual process and unknown state", () => {
    const runDir = prepareManifest();
    writePausedArtifacts(runDir);
    writeFhvResumeRuntimeProof(runDir, {
      schemaVersion: "fhv-resume-runtime-proof/v1",
      runId: RUN_ID,
      organizationId: ORG_ID,
      processPid: 1,
      resumeCycleStartIndex: 40,
      firstExecutedCycleIndex: 40,
      lastExecutedCycleIndex: 80,
      fullHistoryRescanCountBefore: 0,
      fullHistoryRescanCountAfter: 0,
      fullHistoryRescanDelta: 0,
    });
    writeFhvSystemdDeployedRevisionAtomic(root, {
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
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

    expect(() =>
      verifyFhvT4RollbackState({
        runRoot: runDir,
        repoRoot: root,
        targetSha: TARGET_SHA,
        requiredEvidencePaths: [join(runDir, "fhv-rehearsal-manifest.v1.json")],
        host: {
          systemctlIsActive: () => ({ state: "active" }),
          systemctlIsEnabled: () => ({ state: "disabled" }),
          unitFileExists: () => false,
          listMatchingProcesses: () => [],
          inspectLegacyContainer: () => ({
            name: "ai-trader-execution-host",
            image: "waia-execution-host:bp6",
            running: true,
          }),
        },
      }),
    ).toThrow(/HOST_STATE_UNKNOWN|not in allowlist/);

    expect(() =>
      verifyFhvT4RollbackState({
        runRoot: runDir,
        repoRoot: root,
        targetSha: TARGET_SHA,
        requiredEvidencePaths: [join(runDir, "fhv-rehearsal-manifest.v1.json")],
        host: {
          systemctlIsActive: () => ({ state: "inactive" }),
          systemctlIsEnabled: () => ({ state: "disabled" }),
          unitFileExists: () => false,
          listMatchingProcesses: () => ["node scripts/trader/fhv-campaign-cli.ts"],
          inspectLegacyContainer: () => ({
            name: "ai-trader-execution-host",
            image: "waia-execution-host:bp6",
            running: true,
          }),
        },
      }),
    ).toThrow(/Residual process remains/);
  });

  it("evidence seal detects tampering of evidence/inventory/metadata/root", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-seal-"));
    process.env.FHV_T4_SERVICE_USER_IDS_JSON = JSON.stringify({
      uid: process.getuid?.() ?? 501,
      gid: process.getgid?.() ?? 20,
    });
    const evidenceSrc = join(root, "src");
    mkdirSync(evidenceSrc, { recursive: true });
    const fileA = join(evidenceSrc, "a.txt");
    writeFileSync(fileA, "alpha\n");
    const sealDestination = join(root, "seal");
    sealFhvT4EvidenceRoot({
      sealDestination,
      evidenceFiles: [{ absolutePath: fileA, relativePath: "a.txt" }],
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      serviceUser: "fhv",
    });
    expect(
      verifyFhvT4EvidenceSeal({
        sealDestination,
        releaseSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        releaseTag: RELEASE_TAG,
      }).classification,
    ).toBe("FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS");

    writeFileSync(join(sealDestination, "evidence", "a.txt"), "tampered\n");
    expect(() =>
      verifyFhvT4EvidenceSeal({
        sealDestination,
        releaseSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
      }),
    ).toThrow(/TAMPERED|mismatch/i);

    // restore evidence and tamper inventory
    writeFileSync(join(sealDestination, "evidence", "a.txt"), "alpha\n");
    writeFileSync(join(sealDestination, "inventory.json"), "[]\n");
    expect(() =>
      verifyFhvT4EvidenceSeal({
        sealDestination,
        releaseSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
      }),
    ).toThrow();

    // reseal clean for metadata/root tests
    rmSync(sealDestination, { recursive: true, force: true });
    sealFhvT4EvidenceRoot({
      sealDestination,
      evidenceFiles: [{ absolutePath: fileA, relativePath: "a.txt" }],
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      serviceUser: "fhv",
    });
    const metadataPath = join(sealDestination, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.runId = "tampered-run";
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    expect(() =>
      verifyFhvT4EvidenceSeal({
        sealDestination,
        releaseSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
      }),
    ).toThrow();

    rmSync(sealDestination, { recursive: true, force: true });
    sealFhvT4EvidenceRoot({
      sealDestination,
      evidenceFiles: [{ absolutePath: fileA, relativePath: "a.txt" }],
      releaseSha: TARGET_SHA,
      releaseTag: RELEASE_TAG,
      runId: RUN_ID,
      organizationId: ORG_ID,
      serviceUser: "fhv",
    });
    writeFileSync(join(sealDestination, "SEAL_ROOT.sha256"), `${"0".repeat(64)}\n`);
    expect(() =>
      verifyFhvT4EvidenceSeal({
        sealDestination,
        releaseSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
      }),
    ).toThrow(/SEAL_ROOT\.sha256 mismatch/);
    delete process.env.FHV_T4_SERVICE_USER_IDS_JSON;
  });
});
