import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { BacktestCycleBoundaryDecision } from "@/lib/trader/backtest/backtest-runner";
import { resolveEvidenceFrontier } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  assertFhvStaleProcessRejected,
  beginFhvAuthorizationRunning,
  buildFhvAuthorizationClaimIssued,
  claimFhvAuthorizationExclusive,
  commitFhvAuthorizationEpoch,
  readFhvAuthorizationClaim,
  resolveFhvAuthorizationClaimPath,
  writeFhvAuthorizationClaimAtomic,
  type FhvAuthorizationClaimV2,
} from "@/lib/trader/observability/fhv-authorization-claim";
import {
  resolveFhvCheckpointPolicy,
  type FhvConfigurationFreezeV1,
} from "@/lib/trader/observability/fhv-configuration-freeze";
import type { FhvExecutionPurpose } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  computeEpochCommitDigest,
  FhvExecutionWalWriter,
  recoverFhvExecutionWalTail,
  type FhvEpochCommitRecord,
} from "@/lib/trader/observability/fhv-execution-wal";
import {
  advanceFhvLaunchJournal,
  buildFhvLaunchJournal,
  readFhvLaunchJournal,
  writeFhvLaunchJournalAtomic,
} from "@/lib/trader/observability/fhv-launch-journal";

export type FhvExecutionCheckpointConfig = Readonly<{
  checkpointEveryCycles: number;
  maxCheckpointWalBytes: number;
}>;

export type FhvOfficialLaunchExecutionArtifacts = Readonly<{
  walWriter: FhvExecutionWalWriter;
  authorizationClaim: FhvAuthorizationClaimV2;
  claimPath: string;
  journalPath: string;
  checkpointConfig: FhvExecutionCheckpointConfig;
  resumeFromCycle: number;
}>;

export function computeFhvCycleZeroCheckpointDigest(input: {
  configurationFreezeDigest: string;
  executionPurpose: FhvExecutionPurpose;
  runId: string;
}): string {
  return computeStableJsonDigest({
    schemaVersion: "fhv-cycle-zero-checkpoint/v1",
    configurationFreezeDigest: input.configurationFreezeDigest,
    executionPurpose: input.executionPurpose,
    runId: input.runId,
  });
}

export function computeFhvExecutionCheckpointDigest(input: {
  epochId: number;
  lastCycle: number;
  evidenceFrontier: string;
  authorizationClaimDigest: string;
}): string {
  return computeStableJsonDigest(input);
}

export function resolveFhvExecutionCheckpointConfig(
  configurationFreeze: FhvConfigurationFreezeV1,
): FhvExecutionCheckpointConfig {
  return resolveFhvCheckpointPolicy(configurationFreeze);
}

export function prepareFhvOfficialLaunchExecution(input: {
  runDir: string;
  runId: string;
  executionPurpose: FhvExecutionPurpose;
  authorizationReceiptDigest: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  controlReplayReceiptDigest?: string;
  leaseOwner: string;
  leaseExpiresAtUtc?: string;
}): FhvOfficialLaunchExecutionArtifacts {
  mkdirSync(join(input.runDir, "control"), { recursive: true });
  const claimPath = resolveFhvAuthorizationClaimPath(input.runDir);
  const checkpointConfig = resolveFhvExecutionCheckpointConfig(input.configurationFreeze);
  const cycleZeroCheckpointDigest = computeFhvCycleZeroCheckpointDigest({
    configurationFreezeDigest: input.configurationFreeze.configurationFreezeDigest,
    executionPurpose: input.executionPurpose,
    runId: input.runId,
  });

  let authorizationClaim: FhvAuthorizationClaimV2;
  let walWriter: FhvExecutionWalWriter;
  let journalPath: string;
  let resumeFromCycle = 0;

  if (existsSync(claimPath)) {
    authorizationClaim = readFhvAuthorizationClaim(claimPath);
    if (authorizationClaim.state !== "RUNNING") {
      throw new Error(
        `[fhv] authorization claim must be RUNNING for resume, got ${authorizationClaim.state}`,
      );
    }
    walWriter = FhvExecutionWalWriter.openExisting({
      runRoot: input.runDir,
      runId: input.runId,
      executionPurpose: input.executionPurpose,
      fencingGeneration: authorizationClaim.fencingGeneration,
    });
    assertFhvStaleProcessRejected({
      claim: authorizationClaim,
      writerFencingGeneration: authorizationClaim.fencingGeneration,
    });
    const journal = readFhvLaunchJournal(input.runDir);
    journalPath = join(input.runDir, "fhv-launch-journal.v1.json");
    resumeFromCycle = journal.lastCommittedCycle + 1;
  } else {
    const issued = buildFhvAuthorizationClaimIssued({
      authorizationReceiptDigest: input.authorizationReceiptDigest,
      executionPurpose: input.executionPurpose,
      runId: input.runId,
      releaseSha: input.releaseSha,
      datasetContentDigest: input.datasetContentDigest,
      manifestSemanticDigest: input.manifestSemanticDigest,
      configurationFreezeDigest: input.configurationFreeze.configurationFreezeDigest,
      ...(input.controlReplayReceiptDigest
        ? { controlReplayReceiptDigest: input.controlReplayReceiptDigest }
        : {}),
    });
    writeFhvAuthorizationClaimAtomic(claimPath, issued);
    authorizationClaim = claimFhvAuthorizationExclusive({
      claimPath,
      leaseOwner: input.leaseOwner,
      leaseExpiresAtUtc: input.leaseExpiresAtUtc ?? new Date(Date.now() + 86_400_000).toISOString(),
      cycleZeroCheckpointDigest,
    });
    authorizationClaim = beginFhvAuthorizationRunning({
      claimPath,
      leaseOwner: input.leaseOwner,
    });
    walWriter = new FhvExecutionWalWriter(
      input.runDir,
      input.runId,
      input.executionPurpose,
      authorizationClaim.fencingGeneration,
    );
    journalPath = writeFhvLaunchJournalAtomic(
      input.runDir,
      buildFhvLaunchJournal({
        runId: input.runId,
        walPath: walWriter.getWalPath(),
      }),
    );
  }

  return {
    walWriter,
    authorizationClaim,
    claimPath,
    journalPath,
    checkpointConfig,
    resumeFromCycle,
  };
}

export function createFhvEpochBoundaryController(input: {
  runDir: string;
  runId: string;
  claimPath: string;
  walWriter: FhvExecutionWalWriter;
  authorizationClaim: FhvAuthorizationClaimV2;
  checkpointConfig: FhvExecutionCheckpointConfig;
  sourceCursorDigest: string;
  resumeFromCycle?: number;
}): {
  onCycleBoundary: (boundary: {
    cycleIndex: number;
    cycleCount: number;
  }) => BacktestCycleBoundaryDecision;
  beginInitialEpoch: () => void;
  getCurrentEpochId: () => number;
} {
  const journal = existsSync(join(input.runDir, "fhv-launch-journal.v1.json"))
    ? readFhvLaunchJournal(input.runDir)
    : undefined;
  let epochId = journal ? journal.lastCommittedEpoch + 1 : 0;
  let epochFirstCycle = input.resumeFromCycle ?? 0;
  let walStartOffset = input.walWriter.walBytesWritten;
  let previousEpochCommitDigest = journal?.lastEpochCommitDigest ?? "0".repeat(64);
  let authorizationClaim = input.authorizationClaim;

  const beginEpoch = (cycleIndex: number): void => {
    input.walWriter.appendRecord({
      epochId,
      cycleIndex,
      cycleCommitId: `${input.runId}:${epochId}:${cycleIndex}:begin`,
      recordType: "EPOCH_BEGIN",
      payload: {
        epochId,
        firstCycle: epochFirstCycle,
        walStartOffset,
      },
    });
  };

  const commitEpoch = (lastCycle: number): void => {
    const evidence = resolveEvidenceFrontier(input.runDir);
    const walEndOffset = input.walWriter.walBytesWritten;
    const executionCheckpointDigest = computeFhvExecutionCheckpointDigest({
      epochId,
      lastCycle,
      evidenceFrontier: String(evidence.evidenceDurableThroughCycleIndex),
      authorizationClaimDigest: authorizationClaim.authorizationClaimDigest,
    });
    input.walWriter.appendRecord({
      epochId,
      cycleIndex: lastCycle,
      cycleCommitId: `${input.runId}:${epochId}:${lastCycle}:checkpoint`,
      recordType: "EXECUTION_CHECKPOINT",
      payload: {
        epochId,
        lastCycle,
        executionCheckpointDigest,
      },
    });
    const commitBody: Omit<FhvEpochCommitRecord, "epochCommitDigest"> = {
      firstCycle: epochFirstCycle,
      lastCycle,
      walStartOffset,
      walEndOffset,
      recordCount: input.walWriter.totalRecords,
      sourceCursorDigest: input.sourceCursorDigest,
      executionCheckpointDigest,
      evidenceFrontier: String(evidence.evidenceDurableThroughCycleIndex),
      orderFillFrontier: "0".repeat(64),
      authorizationClaimDigest: authorizationClaim.authorizationClaimDigest,
      previousCommittedEpochDigest: previousEpochCommitDigest,
    };
    const epochCommitDigest = computeEpochCommitDigest(commitBody);
    const commitRecord: FhvEpochCommitRecord = { ...commitBody, epochCommitDigest };
    input.walWriter.appendRecord({
      epochId,
      cycleIndex: lastCycle,
      cycleCommitId: `${input.runId}:${epochId}:${lastCycle}:commit`,
      recordType: "EPOCH_COMMIT",
      payload: commitRecord,
    });
    advanceFhvLaunchJournal({
      runRoot: input.runDir,
      lastCommittedEpoch: epochId,
      lastCommittedCycle: lastCycle,
      lastEpochCommitDigest: epochCommitDigest,
    });
    authorizationClaim = commitFhvAuthorizationEpoch({
      claimPath: input.claimPath,
      lastCommittedEpoch: epochId,
      lastCommittedCycle: lastCycle,
      checkpointDigest: executionCheckpointDigest,
      walCommitDigest: epochCommitDigest,
    });
    previousEpochCommitDigest = epochCommitDigest;
    epochId += 1;
    epochFirstCycle = lastCycle + 1;
    walStartOffset = input.walWriter.walBytesWritten;
  };

  return {
    beginInitialEpoch: () => {
      if ((input.resumeFromCycle ?? 0) === 0) {
        beginEpoch(0);
      }
    },
    getCurrentEpochId: () => epochId,
    onCycleBoundary: ({ cycleCount }) => {
      if (cycleCount > 0 && cycleCount % input.checkpointConfig.checkpointEveryCycles === 0) {
        const lastCycle = cycleCount - 1;
        commitEpoch(lastCycle);
        if (input.walWriter.walBytesWritten >= input.checkpointConfig.maxCheckpointWalBytes) {
          return "stop";
        }
        beginEpoch(lastCycle + 1);
      }
      return "continue";
    },
  };
}

export function recoverFhvExecutionWalForResume(runDir: string): {
  validRecords: ReturnType<typeof recoverFhvExecutionWalTail>["validRecords"];
  truncatedTailBytes: number;
} {
  const walPath = join(runDir, "execution.wal.ndjson");
  return recoverFhvExecutionWalTail(walPath);
}
