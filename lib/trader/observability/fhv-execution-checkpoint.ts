import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { backupSqliteDatabaseToFile } from "@/db/client";
import type {
  BacktestCycleBoundaryDecision,
  FhvCycleBoundarySnapshot,
} from "@/lib/trader/backtest/backtest-runner";
import { resolveEvidenceFrontier } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import type { FhvCompositeEvidenceSink } from "@/lib/trader/observability/fhv-composite-evidence-sink";
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
  publishFhvExecutionCheckpointBundle,
  type FhvExecutionCheckpointManifestV1,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { computeFhvCheckpointSnapshotDigests } from "@/lib/trader/observability/fhv-execution-checkpoint-runtime";
import {
  resolveFhvCheckpointPolicy,
  type FhvConfigurationFreezeV1,
} from "@/lib/trader/observability/fhv-configuration-freeze";
import type { FhvExecutionPurpose } from "@/lib/trader/observability/fhv-execution-purpose";
import { resolveFhvGenerationSessionDbPath } from "@/lib/trader/observability/fhv-generation-session-path";
import {
  computeEpochCommitDigest,
  FhvExecutionWalWriter,
  fsyncFhvExecutionWalFile,
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

export type FhvEpochCommitSnapshotDigests = Readonly<{
  sourceCursorDigest: string;
  executionStateDigest?: string;
  accountingFrontierDigest?: string;
  identityFrontierDigest?: string;
  evidenceFrontierDigest?: string;
  syntheticScaleAuthorityDigest?: string;
  executionConfigurationDigest?: string;
}>;

export type FhvEpochCommitResult = Readonly<{
  epochId: number;
  lastCycle: number;
  checkpointDir: string;
  checkpointRelativePath: string;
  manifest: FhvExecutionCheckpointManifestV1;
  epochCommitDigest: string;
  executionCheckpointDigest: string;
  authorizationClaim: FhvAuthorizationClaimV2;
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
  checkpointContentDigest?: string;
  sessionDatabaseDigest?: string;
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

async function captureSessionDatabaseBackup(input: {
  skipSessionBackup?: boolean;
}): Promise<{ sessionBuffer: Buffer; sessionDatabaseDigest: string }> {
  if (input.skipSessionBackup) {
    const placeholder = Buffer.from("fhv-session-backup-placeholder", "utf8");
    return {
      sessionBuffer: placeholder,
      sessionDatabaseDigest: createHash("sha256").update(placeholder).digest("hex"),
    };
  }

  const tempBackupPath = join(tmpdir(), `fhv-session-backup-${process.pid}-${Date.now()}.sqlite`);
  try {
    const backup = await backupSqliteDatabaseToFile(tempBackupPath);
    if (backup.integrityCheck !== "ok") {
      throw new Error(`[fhv] session backup integrity_check failed: ${backup.integrityCheck}`);
    }
    const sessionBuffer = readFileSync(tempBackupPath);
    return {
      sessionBuffer,
      sessionDatabaseDigest: createHash("sha256").update(sessionBuffer).digest("hex"),
    };
  } finally {
    try {
      rmSync(tempBackupPath, { force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
}

export async function commitFhvExecutionEpoch(input: {
  runDir: string;
  runId: string;
  claimPath: string;
  walWriter: FhvExecutionWalWriter;
  authorizationClaim: FhvAuthorizationClaimV2;
  epochId: number;
  epochFirstCycle: number;
  lastCycle: number;
  walStartOffset: number;
  previousEpochCommitDigest: string;
  snapshotDigests: FhvEpochCommitSnapshotDigests;
  checkpointFiles?: Readonly<Record<string, Buffer | string>>;
  skipSessionBackup?: boolean;
}): Promise<FhvEpochCommitResult> {
  const evidence = resolveEvidenceFrontier(input.runDir);
  const evidenceFrontier =
    input.snapshotDigests.evidenceFrontierDigest ??
    computeStableJsonDigest(String(evidence.evidenceDurableThroughCycleIndex));

  const { sessionBuffer, sessionDatabaseDigest } = await captureSessionDatabaseBackup({
    skipSessionBackup: input.skipSessionBackup,
  });

  const generation = input.authorizationClaim.fencingGeneration;
  const sessionDatabasePath = resolveFhvGenerationSessionDbPath(input.runDir, generation);

  const bundle = publishFhvExecutionCheckpointBundle({
    runDir: input.runDir,
    runId: input.runId,
    epochId: input.epochId,
    generation,
    firstCycle: input.epochFirstCycle,
    lastCycle: input.lastCycle,
    files: {
      ...(input.checkpointFiles ?? {}),
      "session.sqlite": sessionBuffer,
    },
    sourceCursorDigest: input.snapshotDigests.sourceCursorDigest,
    executionStateDigest: input.snapshotDigests.executionStateDigest ?? "0".repeat(64),
    accountingFrontierDigest: input.snapshotDigests.accountingFrontierDigest ?? "0".repeat(64),
    identityFrontierDigest: input.snapshotDigests.identityFrontierDigest ?? "0".repeat(64),
    evidenceFrontierDigest: evidenceFrontier,
    sessionDatabaseDigest,
    ...(input.snapshotDigests.syntheticScaleAuthorityDigest
      ? { syntheticScaleAuthorityDigest: input.snapshotDigests.syntheticScaleAuthorityDigest }
      : {}),
    ...(input.snapshotDigests.executionConfigurationDigest
      ? { executionConfigurationDigest: input.snapshotDigests.executionConfigurationDigest }
      : {}),
  });

  const executionCheckpointDigest = computeFhvExecutionCheckpointDigest({
    epochId: input.epochId,
    lastCycle: input.lastCycle,
    evidenceFrontier: String(evidence.evidenceDurableThroughCycleIndex),
    authorizationClaimDigest: input.authorizationClaim.authorizationClaimDigest,
    checkpointContentDigest: bundle.manifest.checkpointContentDigest,
    sessionDatabaseDigest,
  });

  input.walWriter.appendRecord({
    epochId: input.epochId,
    cycleIndex: input.lastCycle,
    cycleCommitId: `${input.runId}:${input.epochId}:${input.lastCycle}:checkpoint`,
    recordType: "EXECUTION_CHECKPOINT",
    payload: {
      epochId: input.epochId,
      lastCycle: input.lastCycle,
      executionCheckpointDigest,
      checkpointRelativePath: bundle.checkpointRelativePath,
      checkpointContentDigest: bundle.manifest.checkpointContentDigest,
      sessionDatabaseDigest,
    },
  });

  const walEndOffset = input.walWriter.walBytesWritten;
  const commitBody: Omit<FhvEpochCommitRecord, "epochCommitDigest"> = {
    firstCycle: input.epochFirstCycle,
    lastCycle: input.lastCycle,
    walStartOffset: input.walStartOffset,
    walEndOffset,
    recordCount: input.walWriter.totalRecords,
    sourceCursorDigest: input.snapshotDigests.sourceCursorDigest,
    executionCheckpointDigest,
    evidenceFrontier: String(evidence.evidenceDurableThroughCycleIndex),
    orderFillFrontier: "0".repeat(64),
    authorizationClaimDigest: input.authorizationClaim.authorizationClaimDigest,
    previousCommittedEpochDigest: input.previousEpochCommitDigest,
    checkpointRelativePath: bundle.checkpointRelativePath,
    sessionDatabaseDigest,
  };
  const epochCommitDigest = computeEpochCommitDigest(commitBody);
  const commitRecord: FhvEpochCommitRecord = { ...commitBody, epochCommitDigest };

  input.walWriter.appendRecord({
    epochId: input.epochId,
    cycleIndex: input.lastCycle,
    cycleCommitId: `${input.runId}:${input.epochId}:${input.lastCycle}:commit`,
    recordType: "EPOCH_COMMIT",
    payload: commitRecord,
  });

  advanceFhvLaunchJournal({
    runRoot: input.runDir,
    lastCommittedEpoch: input.epochId,
    lastCommittedCycle: input.lastCycle,
    lastEpochCommitDigest: epochCommitDigest,
  });

  const authorizationClaim = commitFhvAuthorizationEpoch({
    claimPath: input.claimPath,
    lastCommittedEpoch: input.epochId,
    lastCommittedCycle: input.lastCycle,
    checkpointDigest: executionCheckpointDigest,
    walCommitDigest: epochCommitDigest,
    sessionDatabasePath,
    activeGeneration: generation,
  });

  return {
    epochId: input.epochId,
    lastCycle: input.lastCycle,
    checkpointDir: bundle.checkpointDir,
    checkpointRelativePath: bundle.checkpointRelativePath,
    manifest: bundle.manifest,
    epochCommitDigest,
    executionCheckpointDigest,
    authorizationClaim,
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
  captureCheckpointFiles?: (
    boundary: FhvCycleBoundarySnapshot,
  ) => Record<string, Buffer | string> | Promise<Record<string, Buffer | string>>;
  skipSessionBackup?: boolean;
  snapshotDigests?: Partial<Omit<FhvEpochCommitSnapshotDigests, "sourceCursorDigest">>;
  compositeEvidenceSink?: FhvCompositeEvidenceSink;
}): {
  onCycleBoundary: (boundary: FhvCycleBoundarySnapshot) => Promise<BacktestCycleBoundaryDecision>;
  beginInitialEpoch: () => void;
  getCurrentEpochId: () => number;
  commitFinalPartialEpoch: (lastCycle: number) => Promise<FhvEpochCommitResult>;
} {
  const journal = existsSync(join(input.runDir, "fhv-launch-journal.v1.json"))
    ? readFhvLaunchJournal(input.runDir)
    : undefined;
  let epochId = journal ? journal.lastCommittedEpoch + 1 : 0;
  let epochFirstCycle = input.resumeFromCycle ?? 0;
  let walStartOffset = input.walWriter.walBytesWritten;
  let previousEpochCommitDigest = journal?.lastEpochCommitDigest ?? "0".repeat(64);
  let authorizationClaim = input.authorizationClaim;
  let lastBoundarySnapshot: FhvCycleBoundarySnapshot | undefined;

  const staticSnapshotDigests = (): Partial<
    Omit<FhvEpochCommitSnapshotDigests, "sourceCursorDigest">
  > => ({
    executionStateDigest: input.snapshotDigests?.executionStateDigest,
    accountingFrontierDigest: input.snapshotDigests?.accountingFrontierDigest,
    identityFrontierDigest: input.snapshotDigests?.identityFrontierDigest,
    evidenceFrontierDigest: input.snapshotDigests?.evidenceFrontierDigest,
    syntheticScaleAuthorityDigest: input.snapshotDigests?.syntheticScaleAuthorityDigest,
    executionConfigurationDigest: input.snapshotDigests?.executionConfigurationDigest,
  });

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

  const commitEpoch = async (
    lastCycle: number,
    boundary?: FhvCycleBoundarySnapshot,
  ): Promise<FhvEpochCommitResult> => {
    if (input.compositeEvidenceSink) {
      await input.compositeEvidenceSink.commitEpochSegment(lastCycle + 1);
    }
    const capturedCheckpointFiles =
      boundary && input.captureCheckpointFiles ? await input.captureCheckpointFiles(boundary) : {};
    const capturedDigests = computeFhvCheckpointSnapshotDigests({
      checkpointFiles: capturedCheckpointFiles,
      fallbackSourceCursorDigest: input.sourceCursorDigest,
    });
    const staticDigests = staticSnapshotDigests();
    const result = await commitFhvExecutionEpoch({
      runDir: input.runDir,
      runId: input.runId,
      claimPath: input.claimPath,
      walWriter: input.walWriter,
      authorizationClaim,
      epochId,
      epochFirstCycle,
      lastCycle,
      walStartOffset,
      previousEpochCommitDigest,
      snapshotDigests: {
        ...capturedDigests,
        ...(staticDigests.evidenceFrontierDigest
          ? { evidenceFrontierDigest: staticDigests.evidenceFrontierDigest }
          : {}),
        ...(staticDigests.syntheticScaleAuthorityDigest
          ? { syntheticScaleAuthorityDigest: staticDigests.syntheticScaleAuthorityDigest }
          : {}),
        ...(staticDigests.executionConfigurationDigest
          ? { executionConfigurationDigest: staticDigests.executionConfigurationDigest }
          : {}),
        sourceCursorDigest: capturedDigests.sourceCursorDigest,
      },
      checkpointFiles: capturedCheckpointFiles,
      skipSessionBackup: input.skipSessionBackup,
    });
    authorizationClaim = result.authorizationClaim;
    previousEpochCommitDigest = result.epochCommitDigest;
    epochId += 1;
    epochFirstCycle = lastCycle + 1;
    walStartOffset = input.walWriter.walBytesWritten;
    if (input.compositeEvidenceSink) {
      input.compositeEvidenceSink.beginNextEpochSegment({
        epochId,
        generation: authorizationClaim.fencingGeneration,
      });
    }
    return result;
  };

  return {
    beginInitialEpoch: () => {
      if ((input.resumeFromCycle ?? 0) === 0) {
        beginEpoch(0);
      }
    },
    getCurrentEpochId: () => epochId,
    commitFinalPartialEpoch: (lastCycle: number) => commitEpoch(lastCycle, lastBoundarySnapshot),
    onCycleBoundary: async (boundary) => {
      lastBoundarySnapshot = boundary;
      const { cycleCount } = boundary;
      if (cycleCount > 0 && cycleCount % input.checkpointConfig.checkpointEveryCycles === 0) {
        const lastCycle = cycleCount - 1;
        await commitEpoch(lastCycle, boundary);
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
  const recovery = recoverFhvExecutionWalTail(walPath);
  if (recovery.truncatedTailBytes > 0) {
    const validContent = recovery.validRecords
      .map((record) => `${JSON.stringify(record)}\n`)
      .join("");
    writeFileSync(walPath, validContent, "utf8");
    fsyncFhvExecutionWalFile(walPath);
  }
  return recovery;
}
