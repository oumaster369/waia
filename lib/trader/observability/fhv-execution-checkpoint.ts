import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getRawSqliteDatabase } from "@/db/client";
import {
  applyIdhpsDurableEpochStep10,
  recordIdhpsCheckpointMetrics,
  recordIdhpsCheckpointSnapshotCost,
  writeIdhpsCompositeMirrorForCheckpoint,
} from "@/lib/trader/execution/idhps-session-registry";
import { pruneFhvCheckpointBundlesToTwoNewest } from "@/lib/trader/observability/fhv-checkpoint-retention";
import {
  collectFhvSealCandidates,
  collectFhvSealedEconomicRows,
  isFhvBoundedHotStateEnabled,
  pruneFhvSealedEconomicRows,
} from "@/lib/trader/execution/fhv-hot-state-pruner";
import { setIdhpsSealedAuthority } from "@/lib/trader/execution/idhps-session-registry";
import {
  openFhvVerifiedEconomicLedgerSnapshot,
  sealFhvEconomicLedgerEpoch,
  verifyFhvEconomicLedger,
} from "@/lib/trader/observability/fhv-economic-ledger";
import {
  computeFhvFillIdentityCommitment,
  FHV_ECONOMIC_SEAL_SCHEMA,
  openFhvSealedOrderRegistry,
  publishFhvEconomicSeals,
} from "@/lib/trader/observability/fhv-economic-seal";
import {
  evaluateFhvEconomicSealEligibility,
  type FhvSealBoundaryProof,
  type FhvSealCandidateOrder,
} from "@/lib/trader/observability/fhv-economic-seal-eligibility";
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

function sha256FileSync(filePath: string): string {
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let offset = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, offset);
      if (n <= 0) {
        break;
      }
      hash.update(buf.subarray(0, n));
      offset += n;
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

/**
 * Quiescent hot-path session backup: WAL checkpoint + copyFile + streaming digest.
 * Avoids better-sqlite3 page backup + full integrity_check + multi-GB Buffer load
 * (IDHPS full-corpus checkpoint budget).
 *
 * Snapshot into an exclusive temp file before publish so the durable checkpoint copy never
 * reads the live SQLite path while the engine still holds it open (CI ARM probe sensitivity).
 */
function captureSessionDatabaseBackup(input: { skipSessionBackup?: boolean }): {
  sessionFile: Buffer | { copyFromPath: string };
  sessionDatabaseDigest: string;
  cleanupTempPath?: string;
} {
  if (input.skipSessionBackup) {
    const placeholder = Buffer.from("fhv-session-backup-placeholder", "utf8");
    return {
      sessionFile: placeholder,
      sessionDatabaseDigest: createHash("sha256").update(placeholder).digest("hex"),
    };
  }

  const sqlite = getRawSqliteDatabase();
  // Single-writer FHV path: checkpoint then copy/clone is a consistent snapshot.
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  const tempBackupPath = join(tmpdir(), `fhv-session-backup-${process.pid}-${Date.now()}.sqlite`);
  let ficloneSucceeded = false;
  try {
    copyFileSync(sqlite.name, tempBackupPath, fsConstants.COPYFILE_FICLONE);
    ficloneSucceeded = true;
  } catch {
    // ext4 has no reflink support: this fallback pays a full byte copy.
    copyFileSync(sqlite.name, tempBackupPath);
  }
  const sessionDatabaseDigest = sha256FileSync(tempBackupPath);
  let checkpointSessionBytes: number | null = null;
  try {
    checkpointSessionBytes = statSync(tempBackupPath).size;
  } catch {
    checkpointSessionBytes = null;
  }
  recordIdhpsCheckpointSnapshotCost({ checkpointSessionBytes, ficloneSucceeded });
  return {
    sessionFile: { copyFromPath: tempBackupPath },
    sessionDatabaseDigest,
    cleanupTempPath: tempBackupPath,
  };
}

/**
 * ADR-0025 OPTION_E: publish economic seals for economically complete, reconciled orders, then
 * prune only their hot-state copies.
 *
 * Required order (never reordered):
 *   ledger append -> ledger verification -> reconciliation proof -> epoch commit
 *   -> economic seal publication -> checkpoint durability -> prune
 *
 * This runs after the epoch checkpoint is durable, so the bundle just published still contains
 * the full pre-prune database. A crash before the seal leaves the rows in place; a crash after
 * the seal but before the prune leaves recoverable duplicates. Pruned rows without a committed
 * seal are impossible.
 *
 * Terminal OrderState is deliberately not the frontier — see fhv-economic-seal.ts.
 *
 * Disabled by default; the legacy path stays canonical until dual-path parity is proven.
 */
function applyFhvBoundedHotState(input: {
  runDir: string;
  runId: string;
  epochId: number;
  epochLastCycle: number;
  organizationId: string;
  sessionIdentity: string;
  boundaryProof: FhvSealBoundaryProof;
  sealedAtReplayMs: number;
  accountingFrontierSequence: number;
  sourceFrontierGlobalEventSequence: number;
  reconciliationProofIdentity: string;
}): void {
  if (!isFhvBoundedHotStateEnabled()) {
    return;
  }
  const sqlite = getRawSqliteDatabase();

  const { candidates } = collectFhvSealCandidates(sqlite);
  const eligible = candidates
    .map((candidate) => evaluateFhvEconomicSealEligibility(candidate, input.boundaryProof))
    .filter((result) => result.eligible)
    .map((result) => result.orderId);
  if (eligible.length === 0) {
    return;
  }

  const collected = collectFhvSealedEconomicRows(sqlite, eligible);
  const candidateById = new Map(candidates.map((candidate) => [candidate.orderId, candidate]));

  // 1. Ledger append + durable seal of the segment.
  const ledger = sealFhvEconomicLedgerEpoch({
    runDir: input.runDir,
    epochId: input.epochId,
    rows: collected.rows,
  });
  // 2. Verify before anything is allowed to depend on it.
  const verification = verifyFhvEconomicLedger(input.runDir);
  if (!verification.ok) {
    throw new Error(
      `FHV_SEALED_LEDGER_DIGEST_MISMATCH: ${verification.failures.join(",")} epoch=${input.epochId}`,
    );
  }

  // 3. Publish the economic seals.
  publishFhvEconomicSeals({
    runDir: input.runDir,
    organizationId: input.organizationId,
    runId: input.runId,
    sessionIdentity: input.sessionIdentity,
    seals: eligible.map((orderId) => {
      const candidate = candidateById.get(orderId) as FhvSealCandidateOrder;
      const identity = collected.fillIdentityByOrderId.get(orderId) ?? {
        fillIds: [],
        exchangeTradeIds: [],
      };
      return {
        schemaVersion: FHV_ECONOMIC_SEAL_SCHEMA,
        organizationId: input.organizationId,
        runId: input.runId,
        sessionIdentity: input.sessionIdentity,
        orderId,
        executionMode: "mock",
        finalObservedOrderState: candidate.state,
        finalQuantity: candidate.quantity,
        finalFilledQuantity: candidate.filledQuantity,
        finalAvgFillPrice: candidate.avgFillPrice,
        lastOrderEventSeq: collected.lastEventSeqByOrderId.get(orderId) ?? -1,
        fillIdentityCommitment: computeFhvFillIdentityCommitment(
          identity.fillIds,
          identity.exchangeTradeIds,
        ),
        fillIds: identity.fillIds,
        exchangeTradeIds: identity.exchangeTradeIds,
        accountingFrontierSequence: input.accountingFrontierSequence,
        sourceFrontierGlobalEventSequence: input.sourceFrontierGlobalEventSequence,
        owningEpochId: input.epochId,
        owningLastCycle: input.epochLastCycle,
        ledgerSegmentSeq: Math.max(0, ledger.segments.length - 1),
        ledgerChainDigest: ledger.chainDigest,
        economicExportDigest: verification.chainDigest,
        sealedAtReplayMs: input.sealedAtReplayMs,
        sealingReason: "EPOCH_COMMIT_ECONOMICALLY_COMPLETE",
        reconciliationProofIdentity: input.reconciliationProofIdentity,
      };
    }),
  });

  // 4. Only now may the redundant hot-state copies go.
  pruneFhvSealedEconomicRows(sqlite, eligible);

  // 5. Publish the verified sealed authority for the run so post-seal writes stay idempotent
  //    after the parent rows are gone. Built once per seal publication, never per write.
  setIdhpsSealedAuthority({
    registry: openFhvSealedOrderRegistry({
      runDir: input.runDir,
      organizationId: input.organizationId,
      runId: input.runId,
      sessionIdentity: input.sessionIdentity,
    }),
    snapshot: openFhvVerifiedEconomicLedgerSnapshot(input.runDir),
  });
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

  const sessionBackup = captureSessionDatabaseBackup({
    skipSessionBackup: input.skipSessionBackup,
  });
  const { sessionFile, sessionDatabaseDigest } = sessionBackup;

  const generation = input.authorizationClaim.fencingGeneration;
  const sessionDatabasePath = resolveFhvGenerationSessionDbPath(input.runDir, generation);

  let bundle: ReturnType<typeof publishFhvExecutionCheckpointBundle>;
  try {
    bundle = publishFhvExecutionCheckpointBundle({
      runDir: input.runDir,
      runId: input.runId,
      epochId: input.epochId,
      generation,
      firstCycle: input.epochFirstCycle,
      lastCycle: input.lastCycle,
      files: {
        ...(input.checkpointFiles ?? {}),
        "session.sqlite": sessionFile,
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
  } finally {
    if (sessionBackup.cleanupTempPath) {
      try {
        rmSync(sessionBackup.cleanupTempPath, { force: true });
      } catch {
        // best-effort temp cleanup
      }
    }
  }

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
  /** Observational only — must not affect checkpoint authority or retention. */
  onCheckpointMetrics?: (input: { epochId: number; checkpointBackupDurationMs: number }) => void;
  /**
   * Required for the bounded-hot-state path (ADR-0025 OPTION_E). Seals are org/run scoped and
   * carry a deterministic replay timestamp; without these the seal cannot be issued.
   */
  boundedHotState?: {
    organizationId: string;
    sessionIdentity: string;
    /** Deterministic replay clock reading. Never wall clock. */
    resolveSealedAtReplayMs: () => number;
    /** Reality reconciliation produced no outstanding discrepancy at this boundary. */
    isReconciliationClean: () => boolean;
    resolveReconciliationProofIdentity: () => string;
  };
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
    const checkpointBackupStartedAt = performance.now();
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
    const checkpointBackupDurationMs = performance.now() - checkpointBackupStartedAt;
    // Durable authority step 10: clear epoch-scoped IDHPS mirrors only after claim.
    applyIdhpsDurableEpochStep10();
    // Persist post-step-10 mirrors for crash-resume parity (portfolio sizing / inventory).
    writeIdhpsCompositeMirrorForCheckpoint(result.checkpointDir, result.epochId);
    let walBytes: number | null = null;
    try {
      const sqlite = getRawSqliteDatabase();
      // Metrics-only maintenance; never used as clear-mirror authority.
      sqlite.pragma("wal_checkpoint(PASSIVE)");
      const walPath = `${sqlite.name}-wal`;
      walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
    } catch {
      walBytes = null;
    }
    recordIdhpsCheckpointMetrics({ checkpointBackupDurationMs, walBytes });
    input.onCheckpointMetrics?.({
      epochId: result.epochId,
      checkpointBackupDurationMs,
    });
    writeFileSync(
      join(result.checkpointDir, "idhps-checkpoint-metrics.v1.json"),
      `${JSON.stringify(
        {
          schemaVersion: "idhps-checkpoint-metrics/v1",
          epochId: result.epochId,
          checkpointBackupDurationMs,
          walBytes,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    pruneFhvCheckpointBundlesToTwoNewest(input.runDir);
    if (input.boundedHotState) {
      const accountingFrontier = boundary?.accountingFrontierState;
      applyFhvBoundedHotState({
        runDir: input.runDir,
        runId: input.runId,
        epochId: result.epochId,
        epochLastCycle: lastCycle,
        organizationId: input.boundedHotState.organizationId,
        sessionIdentity: input.boundedHotState.sessionIdentity,
        boundaryProof: {
          // The epoch commit above succeeded and its checkpoint bundle is durable.
          epochCommitted: true,
          // The cycle boundary supplied a source cursor digest for the consumed frontier.
          sourceFrontierProven: Boolean(capturedDigests.sourceCursorDigest),
          reconciliationClean: input.boundedHotState.isReconciliationClean(),
          ledgerDurable: true,
        },
        sealedAtReplayMs: input.boundedHotState.resolveSealedAtReplayMs(),
        accountingFrontierSequence: accountingFrontier?.accountingSequence ?? -1,
        sourceFrontierGlobalEventSequence: boundary?.cycleCount ?? lastCycle + 1,
        reconciliationProofIdentity: input.boundedHotState.resolveReconciliationProofIdentity(),
      });
    }
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
