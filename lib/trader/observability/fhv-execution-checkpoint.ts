import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { getRawSqliteDatabase } from "@/db/client";
import {
  getIdhpsSession,
  recordIdhpsCheckpointMetrics,
  recordIdhpsCheckpointSnapshotCost,
  setIdhpsSealedAuthority,
} from "@/lib/trader/execution/idhps-session-registry";
import { pruneFhvCheckpointBundlesToTwoNewest } from "@/lib/trader/observability/fhv-checkpoint-retention";
import { tryNativeCloneFile } from "@/lib/trader/observability/fhv-native-clone";
import {
  collectFhvLifecycleAuditRows,
  collectFhvSealCandidates,
  collectFhvSealedEconomicRows,
  isFhvBoundedHotStateEnabled,
  pruneFhvSealedEconomicRows,
  pruneFhvSealedLifecycleAuditRows,
} from "@/lib/trader/execution/fhv-hot-state-pruner";
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
  evaluateFhvSealBoundary,
  type FhvSealBoundaryProof,
  type FhvSealCandidateOrder,
} from "@/lib/trader/observability/fhv-economic-seal-eligibility";
import type {
  BacktestCycleBoundaryDecision,
  FhvCycleBoundarySnapshot,
} from "@/lib/trader/backtest/backtest-runner";
import {
  resolveFhvEpochEvidenceSegmentDir,
  type FhvCompositeEvidenceSink,
} from "@/lib/trader/observability/fhv-composite-evidence-sink";
import { verifyFhvDestinationShaOffMainThread } from "@/lib/trader/observability/fhv-destination-sha-verifier";
import {
  captureFrozenPendingIdhpsEpoch,
  materializePostCommitIdhpsCompositeFromFrozen,
  rotateIdhpsLiveEpochWorkingSetAfterProvisionalFreeze,
  type FrozenPendingIdhpsEpochV1,
} from "@/lib/trader/observability/fhv-idhps-epoch-rotation";
import { assertSqliteWalTruncated } from "@/lib/trader/observability/fhv-sqlite-wal-truncate";
import {
  cleanupFhvEpochEvidenceGenerations,
  cleanupFhvTwoPhaseResumeState,
} from "@/lib/trader/observability/fhv-two-phase-recovery";
import { IDHPS_COMPOSITE_MIRROR_FILENAME } from "@/lib/trader/observability/idhps-composite-mirror-snapshot";
import { createEmptyIdhpsInventoryMirror } from "@/lib/trader/paper/idhps-inventory-mirror";
import { createEmptyIdhpsAccountRiskMirror } from "@/lib/trader/paper/idhps-account-risk-mirror";
import { createEmptyIdhpsSemanticDigestFrontier } from "@/lib/trader/backtest/streaming-evidence/idhps-semantic-digest-frontier";
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
  finalizeFhvProvisionalCheckpointBundle,
  fsyncFhvCheckpointPath,
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
  resolveFhvProvisionalEpochCheckpointDir,
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
  truncateFhvExecutionWalToJournalAuthoritativeCommit,
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
  orderFillFrontierDigest?: string;
}>;

/** Authoritative digest over canonical consumed fill id sequence (not a zero placeholder). */
export function computeOrderFillFrontierDigest(consumedFillIds: readonly string[]): string {
  return computeStableJsonDigest({
    schemaVersion: "fhv-order-fill-frontier/v1",
    consumedFillIds: [...consumedFillIds],
  });
}

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
    const recovered = cleanupFhvTwoPhaseResumeState(input.runDir);
    const evidenceRoot = join(input.runDir, "evidence");
    if (recovered.lastCommittedEpoch >= 0 && existsSync(evidenceRoot)) {
      cleanupFhvEpochEvidenceGenerations({
        runDir: input.runDir,
        epochId: recovered.lastCommittedEpoch,
        keepGeneration: authorizationClaim.fencingGeneration,
      });
    }
    if (recovered.lastCommittedEpoch > authorizationClaim.lastCommittedEpoch) {
      reconcileFhvJournalClaimCatchUp({
        runDir: input.runDir,
        claimPath,
        claim: authorizationClaim,
        journalEpoch: recovered.lastCommittedEpoch,
        journalCycle: recovered.lastCommittedCycle,
        journalDigest: recovered.lastEpochCommitDigest,
      });
      authorizationClaim = readFhvAuthorizationClaim(claimPath);
    } else if (authorizationClaim.lastCommittedEpoch > recovered.lastCommittedEpoch) {
      throw new Error("FHV_CLAIM_AHEAD_OF_JOURNAL");
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
    journalPath = join(input.runDir, "fhv-launch-journal.v1.json");
    resumeFromCycle = recovered.lastCommittedCycle + 1;
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

function reconcileFhvJournalClaimCatchUp(input: {
  runDir: string;
  claimPath: string;
  claim: FhvAuthorizationClaimV2;
  journalEpoch: number;
  journalCycle: number;
  journalDigest: string;
}): void {
  if (input.claim.fencingGeneration < 1) {
    throw new Error("FHV_STALE_FENCE_PROMOTION_FORBIDDEN");
  }
  const checkpointDir = resolveFhvEpochCheckpointDir(input.runDir, input.journalEpoch);
  const bundle = readFhvExecutionCheckpointBundle(checkpointDir);
  const hasComposite = bundle.manifest.files.some(
    (file) => file.relativePath === IDHPS_COMPOSITE_MIRROR_FILENAME,
  );
  if (!hasComposite) {
    throw new Error("FHV_IDHPS_COMPOSITE_REQUIRED_MISSING");
  }
  const prefix = truncateFhvExecutionWalToJournalAuthoritativeCommit({
    walPath: join(input.runDir, "execution.wal.ndjson"),
    lastCommittedEpoch: input.journalEpoch,
    lastCommittedCycle: input.journalCycle,
    lastEpochCommitDigest: input.journalDigest,
  });
  const commit = prefix.records.at(-1);
  if (!commit || commit.recordType !== "EPOCH_COMMIT") {
    throw new Error("FHV_WAL_JOURNAL_COMMIT_NOT_UNIQUE");
  }
  const payload = commit.payload as {
    epochCommitDigest?: string;
    executionCheckpointDigest?: string;
  };
  if (payload.epochCommitDigest !== input.journalDigest) {
    throw new Error("FHV_WAL_JOURNAL_COMMIT_NOT_UNIQUE");
  }
  const evidenceRoot = join(input.runDir, "evidence");
  if (existsSync(evidenceRoot)) {
    const canonicalEvidence = resolveFhvEpochEvidenceSegmentDir(
      input.runDir,
      input.journalEpoch,
      input.claim.fencingGeneration,
    );
    if (!existsSync(canonicalEvidence)) {
      throw new Error("FHV_EVIDENCE_CLEANUP_REQUIRED_EPOCH_MISSING");
    }
  }
  commitFhvAuthorizationEpoch({
    claimPath: input.claimPath,
    lastCommittedEpoch: input.journalEpoch,
    lastCommittedCycle: input.journalCycle,
    checkpointDigest: payload.executionCheckpointDigest ?? bundle.manifest.checkpointContentDigest,
    walCommitDigest: input.journalDigest,
    activeGeneration: input.claim.fencingGeneration,
  });
}

function copyFileOnly(sourcePath: string, destPath: string): void {
  const sourceFd = openSync(sourcePath, "r");
  const destFd = openSync(destPath, "w");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let offset = 0;
    for (;;) {
      const read = readSync(sourceFd, buffer, 0, buffer.length, offset);
      if (read <= 0) break;
      writeSync(destFd, buffer, 0, read);
      offset += read;
    }
  } finally {
    closeSync(destFd);
    closeSync(sourceFd);
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
function captureSessionDatabaseBackup(input: { skipSessionBackup?: boolean; destPath: string }): {
  sessionDatabaseBytes: number;
  ficloneSucceeded: boolean;
} {
  mkdirSync(dirname(input.destPath), { recursive: true });
  if (input.skipSessionBackup) {
    const placeholder = Buffer.from("fhv-session-backup-placeholder", "utf8");
    writeFileSync(input.destPath, placeholder);
    fsyncFhvCheckpointPath(input.destPath);
    chmodSync(input.destPath, 0o444);
    return { sessionDatabaseBytes: placeholder.length, ficloneSucceeded: false };
  }

  const sqlite = getRawSqliteDatabase();
  assertSqliteWalTruncated({
    sqliteName: sqlite.name,
    pragmaResult: sqlite.pragma("wal_checkpoint(TRUNCATE)"),
  });
  const clone = tryNativeCloneFile(sqlite.name, input.destPath);
  const ficloneSucceeded = clone.status === "NATIVE_CLONE_SUCCEEDED";
  if (!ficloneSucceeded) {
    copyFileOnly(sqlite.name, input.destPath);
  }
  fsyncFhvCheckpointPath(input.destPath);
  chmodSync(input.destPath, 0o444);
  const sessionDatabaseBytes = statSync(input.destPath).size;
  recordIdhpsCheckpointSnapshotCost({
    checkpointSessionBytes: sessionDatabaseBytes,
    ficloneSucceeded,
  });
  return { sessionDatabaseBytes, ficloneSucceeded };
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
    // No economic orders to seal this epoch, but append-only lifecycle audit still accumulates
    // and must be bounded every epoch.
    sealAndPruneFhvLifecycleAudit(sqlite, input);
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

  // Lifecycle audit is sealed AFTER the economic seal so the order-path ledger digests are
  // unchanged from the pre-repair baseline; it runs every epoch regardless of order eligibility.
  sealAndPruneFhvLifecycleAudit(sqlite, input);
}

/**
 * Seal + prune append-only lifecycle audit rows for a committed epoch (ADR-0025 AD-2).
 *
 * Lifecycle events are write-only provenance in the FHV path, so once durably sealed into the
 * economic ledger they may leave bounded hot state. Same fail-closed ordering as the economic
 * seal — seal + verify BEFORE the destructive delete — and the same durable-boundary gate, so a
 * dirty/uncommitted boundary prunes nothing.
 */
function sealAndPruneFhvLifecycleAudit(
  sqlite: ReturnType<typeof getRawSqliteDatabase>,
  input: { runDir: string; epochId: number; boundaryProof: FhvSealBoundaryProof },
): void {
  if (evaluateFhvSealBoundary(input.boundaryProof) !== null) {
    return;
  }
  const lifecycle = collectFhvLifecycleAuditRows(sqlite);
  if (lifecycle.rows.length === 0) {
    return;
  }
  sealFhvEconomicLedgerEpoch({
    runDir: input.runDir,
    epochId: input.epochId,
    rows: lifecycle.rows,
  });
  const verification = verifyFhvEconomicLedger(input.runDir);
  if (!verification.ok) {
    throw new Error(
      `FHV_SEALED_LEDGER_DIGEST_MISMATCH: ${verification.failures.join(",")} epoch=${input.epochId} kind=lifecycle`,
    );
  }
  pruneFhvSealedLifecycleAuditRows(sqlite, lifecycle.ids);
}

export type FhvProvisionalEpochCapture = Readonly<{
  runDir: string;
  runId: string;
  claimPath: string;
  walWriter: FhvExecutionWalWriter;
  epochId: number;
  epochFirstCycle: number;
  lastCycle: number;
  walStartOffset: number;
  previousEpochCommitDigest: string;
  snapshotDigests: FhvEpochCommitSnapshotDigests;
  generation: number;
  destPath: string;
  destBytes: number;
  destDev: number;
  destIno: number;
  fencingGeneration: number;
  frozen: FrozenPendingIdhpsEpochV1 | null;
  evidenceFrontier: string;
  evidenceDurableThroughCycleIndex: number;
  verifier: Promise<{
    digest: string;
    byteCount: number;
    destPath: string;
    fencingGeneration: number;
    runId: string;
    epochId: number;
    generation: number;
  }>;
  compositeEvidenceSink?: FhvCompositeEvidenceSink;
  boundedHotState?: {
    organizationId: string;
    sessionIdentity: string;
    resolveSealedAtReplayMs: () => number;
    isReconciliationClean: () => boolean;
    resolveReconciliationProofIdentity: () => string;
  };
  onCheckpointMetrics?: (input: { epochId: number; checkpointBackupDurationMs: number }) => void;
  checkpointBackupDurationMs: number;
}>;

function writeSidecarFiles(
  destDir: string,
  files: Readonly<Record<string, Buffer | string>>,
): void {
  mkdirSync(destDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    if (relativePath.includes("..") || relativePath.startsWith("/")) {
      throw new Error(`FHV_CHECKPOINT_FILE_PATH_INVALID: ${relativePath}`);
    }
    const destPath = join(destDir, relativePath);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, typeof content === "string" ? content : content);
  }
}

export async function captureFhvProvisionalExecutionEpoch(input: {
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
  compositeEvidenceSink?: FhvCompositeEvidenceSink;
  boundedHotState?: FhvProvisionalEpochCapture["boundedHotState"];
  onCheckpointMetrics?: FhvProvisionalEpochCapture["onCheckpointMetrics"];
  verifierDelayMs?: number;
}): Promise<FhvProvisionalEpochCapture> {
  const captureStartedAt = performance.now();
  const generation = input.authorizationClaim.fencingGeneration;
  let evidenceDurableThroughCycleIndex = -1;
  let evidenceFrontier =
    input.snapshotDigests.evidenceFrontierDigest ??
    computeStableJsonDigest(String(evidenceDurableThroughCycleIndex));

  if (input.compositeEvidenceSink) {
    const sealed = await input.compositeEvidenceSink.commitEpochSegment(input.lastCycle + 1);
    evidenceDurableThroughCycleIndex = sealed.manifest.sealedThroughCycleIndex;
    evidenceFrontier = sealed.manifest.chainDigest;
  }

  const provisionalDir = resolveFhvProvisionalEpochCheckpointDir(input.runDir, input.epochId);
  rmSync(provisionalDir, { recursive: true, force: true });
  mkdirSync(provisionalDir, { recursive: true });
  writeSidecarFiles(provisionalDir, input.checkpointFiles ?? {});

  const frozen = getIdhpsSession() ? captureFrozenPendingIdhpsEpoch(input.epochId) : null;
  if (frozen) {
    rotateIdhpsLiveEpochWorkingSetAfterProvisionalFreeze(frozen);
  }

  const destPath = join(provisionalDir, "session.sqlite");
  const backup = captureSessionDatabaseBackup({
    skipSessionBackup: input.skipSessionBackup,
    destPath,
  });
  const destStat = statSync(destPath);

  input.walWriter.freezeUntilEpochCommit(input.epochId);

  if (input.compositeEvidenceSink) {
    input.compositeEvidenceSink.beginNextEpochSegment({
      epochId: input.epochId + 1,
      generation,
    });
  }

  const verifier = verifyFhvDestinationShaOffMainThread({
    runId: input.runId,
    epochId: input.epochId,
    generation,
    destPath,
    expectedBytes: backup.sessionDatabaseBytes,
    fencingGeneration: generation,
    delayMs: input.verifierDelayMs,
  });

  return {
    runDir: input.runDir,
    runId: input.runId,
    claimPath: input.claimPath,
    walWriter: input.walWriter,
    epochId: input.epochId,
    epochFirstCycle: input.epochFirstCycle,
    lastCycle: input.lastCycle,
    walStartOffset: input.walStartOffset,
    previousEpochCommitDigest: input.previousEpochCommitDigest,
    snapshotDigests: {
      ...input.snapshotDigests,
      evidenceFrontierDigest: evidenceFrontier,
    },
    generation,
    destPath,
    destBytes: backup.sessionDatabaseBytes,
    destDev: destStat.dev,
    destIno: destStat.ino,
    fencingGeneration: generation,
    frozen,
    evidenceFrontier,
    evidenceDurableThroughCycleIndex,
    verifier,
    ...(input.compositeEvidenceSink ? { compositeEvidenceSink: input.compositeEvidenceSink } : {}),
    ...(input.boundedHotState ? { boundedHotState: input.boundedHotState } : {}),
    ...(input.onCheckpointMetrics ? { onCheckpointMetrics: input.onCheckpointMetrics } : {}),
    checkpointBackupDurationMs: performance.now() - captureStartedAt,
  };
}

export async function promoteFhvVerifiedExecutionEpoch(
  pending: FhvProvisionalEpochCapture,
): Promise<FhvEpochCommitResult> {
  const verified = await pending.verifier;
  const liveClaim = readFhvAuthorizationClaim(pending.claimPath);
  if (liveClaim.fencingGeneration !== pending.fencingGeneration) {
    throw new Error("FHV_STALE_FENCE_PROMOTION_FORBIDDEN");
  }
  if (verified.fencingGeneration !== pending.fencingGeneration) {
    throw new Error("FHV_STALE_FENCE_PROMOTION_FORBIDDEN");
  }
  if (verified.generation !== pending.generation) {
    throw new Error("FHV_STALE_FENCE_PROMOTION_FORBIDDEN");
  }
  if (verified.destPath !== pending.destPath || verified.byteCount !== pending.destBytes) {
    throw new Error("FHV_DEST_SHA_MISMATCH");
  }
  if (verified.runId !== pending.runId || verified.epochId !== pending.epochId) {
    throw new Error("FHV_DEST_SHA_STALE_RESULT");
  }
  const destStat = statSync(pending.destPath);
  if (destStat.size !== pending.destBytes) {
    throw new Error("FHV_DEST_SHA_SIZE_MISMATCH");
  }
  if (destStat.dev !== pending.destDev || destStat.ino !== pending.destIno) {
    throw new Error("FHV_DEST_INODE_CHANGED");
  }

  const composite = pending.frozen
    ? materializePostCommitIdhpsCompositeFromFrozen(pending.frozen)
    : materializePostCommitIdhpsCompositeFromFrozen({
        epochId: pending.epochId,
        inventory: createEmptyIdhpsInventoryMirror(),
        accountRisk: createEmptyIdhpsAccountRiskMirror(),
        semanticDigestFrontier: createEmptyIdhpsSemanticDigestFrontier(),
        accounting: null,
      });

  if (pending.compositeEvidenceSink) {
    pending.compositeEvidenceSink.promoteSealedEpochEvidence({
      epochId: pending.epochId,
      generation: pending.generation,
    });
  }

  const bundle = finalizeFhvProvisionalCheckpointBundle({
    runDir: pending.runDir,
    runId: pending.runId,
    epochId: pending.epochId,
    generation: pending.generation,
    firstCycle: pending.epochFirstCycle,
    lastCycle: pending.lastCycle,
    additionalFiles: {
      [IDHPS_COMPOSITE_MIRROR_FILENAME]: `${JSON.stringify(composite, null, 2)}\n`,
    },
    verifiedSessionDatabaseDigest: verified.digest,
    verifiedSessionDatabaseBytes: verified.byteCount,
    sourceCursorDigest: pending.snapshotDigests.sourceCursorDigest,
    executionStateDigest: pending.snapshotDigests.executionStateDigest ?? "0".repeat(64),
    accountingFrontierDigest: pending.snapshotDigests.accountingFrontierDigest ?? "0".repeat(64),
    identityFrontierDigest: pending.snapshotDigests.identityFrontierDigest ?? "0".repeat(64),
    evidenceFrontierDigest: pending.evidenceFrontier,
    ...(pending.snapshotDigests.syntheticScaleAuthorityDigest
      ? { syntheticScaleAuthorityDigest: pending.snapshotDigests.syntheticScaleAuthorityDigest }
      : {}),
    ...(pending.snapshotDigests.executionConfigurationDigest
      ? { executionConfigurationDigest: pending.snapshotDigests.executionConfigurationDigest }
      : {}),
  });

  const sessionDatabaseDigest = verified.digest;
  const executionCheckpointDigest = computeFhvExecutionCheckpointDigest({
    epochId: pending.epochId,
    lastCycle: pending.lastCycle,
    evidenceFrontier: String(pending.evidenceDurableThroughCycleIndex),
    authorizationClaimDigest: liveClaim.authorizationClaimDigest,
    checkpointContentDigest: bundle.manifest.checkpointContentDigest,
    sessionDatabaseDigest,
  });

  pending.walWriter.appendRecord({
    epochId: pending.epochId,
    cycleIndex: pending.lastCycle,
    cycleCommitId: `${pending.runId}:${pending.epochId}:${pending.lastCycle}:checkpoint`,
    recordType: "EXECUTION_CHECKPOINT",
    payload: {
      epochId: pending.epochId,
      lastCycle: pending.lastCycle,
      executionCheckpointDigest,
      checkpointRelativePath: bundle.checkpointRelativePath,
      checkpointContentDigest: bundle.manifest.checkpointContentDigest,
      sessionDatabaseDigest,
    },
  });

  const walEndOffset = pending.walWriter.walBytesWritten;
  const commitBody: Omit<FhvEpochCommitRecord, "epochCommitDigest"> = {
    firstCycle: pending.epochFirstCycle,
    lastCycle: pending.lastCycle,
    walStartOffset: pending.walStartOffset,
    walEndOffset,
    recordCount: pending.walWriter.totalRecords,
    sourceCursorDigest: pending.snapshotDigests.sourceCursorDigest,
    executionCheckpointDigest,
    evidenceFrontier: String(pending.evidenceDurableThroughCycleIndex),
    orderFillFrontier:
      pending.snapshotDigests.orderFillFrontierDigest ?? computeOrderFillFrontierDigest([]),
    authorizationClaimDigest: liveClaim.authorizationClaimDigest,
    previousCommittedEpochDigest: pending.previousEpochCommitDigest,
    checkpointRelativePath: bundle.checkpointRelativePath,
    sessionDatabaseDigest,
  };
  const epochCommitDigest = computeEpochCommitDigest(commitBody);
  pending.walWriter.appendRecord({
    epochId: pending.epochId,
    cycleIndex: pending.lastCycle,
    cycleCommitId: `${pending.runId}:${pending.epochId}:${pending.lastCycle}:commit`,
    recordType: "EPOCH_COMMIT",
    payload: { ...commitBody, epochCommitDigest },
  });

  advanceFhvLaunchJournal({
    runRoot: pending.runDir,
    lastCommittedEpoch: pending.epochId,
    lastCommittedCycle: pending.lastCycle,
    lastEpochCommitDigest: epochCommitDigest,
  });

  const sessionDatabasePath = resolveFhvGenerationSessionDbPath(pending.runDir, pending.generation);
  const authorizationClaim = commitFhvAuthorizationEpoch({
    claimPath: pending.claimPath,
    lastCommittedEpoch: pending.epochId,
    lastCommittedCycle: pending.lastCycle,
    checkpointDigest: executionCheckpointDigest,
    walCommitDigest: epochCommitDigest,
    sessionDatabasePath,
    activeGeneration: pending.generation,
  });

  recordIdhpsCheckpointMetrics({
    checkpointBackupDurationMs: pending.checkpointBackupDurationMs,
    walBytes: null,
  });
  pending.onCheckpointMetrics?.({
    epochId: pending.epochId,
    checkpointBackupDurationMs: pending.checkpointBackupDurationMs,
  });
  writeFileSync(
    join(bundle.checkpointDir, "idhps-checkpoint-metrics.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: "idhps-checkpoint-metrics/v1",
        epochId: pending.epochId,
        checkpointBackupDurationMs: pending.checkpointBackupDurationMs,
        walBytes: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  pruneFhvCheckpointBundlesToTwoNewest(pending.runDir);
  if (pending.boundedHotState) {
    applyFhvBoundedHotState({
      runDir: pending.runDir,
      runId: pending.runId,
      epochId: pending.epochId,
      epochLastCycle: pending.lastCycle,
      organizationId: pending.boundedHotState.organizationId,
      sessionIdentity: pending.boundedHotState.sessionIdentity,
      boundaryProof: {
        epochCommitted: true,
        sourceFrontierProven: Boolean(pending.snapshotDigests.sourceCursorDigest),
        reconciliationClean: pending.boundedHotState.isReconciliationClean(),
        ledgerDurable: true,
      },
      sealedAtReplayMs: pending.boundedHotState.resolveSealedAtReplayMs(),
      accountingFrontierSequence: -1,
      sourceFrontierGlobalEventSequence: pending.lastCycle + 1,
      reconciliationProofIdentity: pending.boundedHotState.resolveReconciliationProofIdentity(),
    });
  }

  return {
    epochId: pending.epochId,
    lastCycle: pending.lastCycle,
    checkpointDir: bundle.checkpointDir,
    checkpointRelativePath: bundle.checkpointRelativePath,
    manifest: bundle.manifest,
    epochCommitDigest,
    executionCheckpointDigest,
    authorizationClaim,
  };
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
  compositeEvidenceSink?: FhvCompositeEvidenceSink;
  boundedHotState?: FhvProvisionalEpochCapture["boundedHotState"];
  onCheckpointMetrics?: FhvProvisionalEpochCapture["onCheckpointMetrics"];
  verifierDelayMs?: number;
}): Promise<FhvEpochCommitResult> {
  const pending = await captureFhvProvisionalExecutionEpoch(input);
  return promoteFhvVerifiedExecutionEpoch(pending);
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
  /** Test-only: stall the destination verifier so callers can prove cycle-loop progress. */
  verifierDelayMs?: number;
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
  drainPendingVerification: () => Promise<FhvEpochCommitResult | null>;
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
  let pendingCapture: FhvProvisionalEpochCapture | null = null;
  let pendingSettled = false;

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

  const applyPromoted = (result: FhvEpochCommitResult, lastCycle: number): void => {
    authorizationClaim = result.authorizationClaim;
    previousEpochCommitDigest = result.epochCommitDigest;
    epochId = result.epochId + 1;
    epochFirstCycle = lastCycle + 1;
    walStartOffset = input.walWriter.walBytesWritten;
    beginEpoch(lastCycle + 1);
  };

  const promotePending = async (): Promise<FhvEpochCommitResult> => {
    if (!pendingCapture) {
      throw new Error("FHV_CHECKPOINT_VERIFY_BACKLOG_EXCEEDED");
    }
    const pending = pendingCapture;
    pendingCapture = null;
    pendingSettled = false;
    const result = await promoteFhvVerifiedExecutionEpoch(pending);
    applyPromoted(result, pending.lastCycle);
    return result;
  };

  const captureBoundary = async (
    lastCycle: number,
    boundary?: FhvCycleBoundarySnapshot,
  ): Promise<FhvProvisionalEpochCapture> => {
    if (pendingCapture) {
      throw new Error("FHV_CHECKPOINT_VERIFY_BACKLOG_EXCEEDED");
    }
    const capturedCheckpointFiles =
      boundary && input.captureCheckpointFiles ? await input.captureCheckpointFiles(boundary) : {};
    const capturedDigests = computeFhvCheckpointSnapshotDigests({
      checkpointFiles: capturedCheckpointFiles,
      fallbackSourceCursorDigest: input.sourceCursorDigest,
    });
    const staticDigests = staticSnapshotDigests();
    const pending = await captureFhvProvisionalExecutionEpoch({
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
      ...(input.compositeEvidenceSink
        ? { compositeEvidenceSink: input.compositeEvidenceSink }
        : {}),
      ...(input.boundedHotState ? { boundedHotState: input.boundedHotState } : {}),
      ...(input.onCheckpointMetrics ? { onCheckpointMetrics: input.onCheckpointMetrics } : {}),
      ...(input.verifierDelayMs !== undefined ? { verifierDelayMs: input.verifierDelayMs } : {}),
    });
    pendingCapture = pending;
    pendingSettled = false;
    void pending.verifier.then(
      () => {
        if (pendingCapture === pending) pendingSettled = true;
      },
      () => {
        if (pendingCapture === pending) pendingSettled = true;
      },
    );
    return pending;
  };

  const commitEpoch = async (
    lastCycle: number,
    boundary?: FhvCycleBoundarySnapshot,
  ): Promise<FhvEpochCommitResult> => {
    if (pendingCapture) {
      await promotePending();
    }
    await captureBoundary(lastCycle, boundary);
    return promotePending();
  };

  return {
    beginInitialEpoch: () => {
      if ((input.resumeFromCycle ?? 0) === 0) {
        beginEpoch(0);
      }
    },
    getCurrentEpochId: () => epochId,
    commitFinalPartialEpoch: async (lastCycle: number) => {
      if (pendingCapture) {
        if (pendingCapture.lastCycle === lastCycle) {
          return promotePending();
        }
        await promotePending();
      }
      return commitEpoch(lastCycle, lastBoundarySnapshot);
    },
    drainPendingVerification: async () => {
      if (!pendingCapture) {
        return null;
      }
      return promotePending();
    },
    onCycleBoundary: async (boundary) => {
      lastBoundarySnapshot = boundary;
      if (pendingCapture && pendingSettled) {
        await promotePending();
      }
      const { cycleCount } = boundary;
      if (cycleCount > 0 && cycleCount % input.checkpointConfig.checkpointEveryCycles === 0) {
        const lastCycle = cycleCount - 1;
        if (pendingCapture) {
          await promotePending();
        }
        await captureBoundary(lastCycle, boundary);
        if (input.walWriter.walBytesWritten >= input.checkpointConfig.maxCheckpointWalBytes) {
          return "stop";
        }
      }
      return "continue";
    },
  };
}

export function recoverFhvExecutionWalForResume(runDir: string): {
  validRecords: ReturnType<typeof recoverFhvExecutionWalTail>["validRecords"];
  truncatedTailBytes: number;
} {
  const journal = existsSync(join(runDir, "fhv-launch-journal.v1.json"))
    ? readFhvLaunchJournal(runDir)
    : undefined;
  if (!journal) {
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
  const walPath = join(runDir, "execution.wal.ndjson");
  const originalBytes = existsSync(walPath) ? statSync(walPath).size : 0;
  const prefix = truncateFhvExecutionWalToJournalAuthoritativeCommit({
    walPath,
    lastCommittedEpoch: journal.lastCommittedEpoch,
    lastCommittedCycle: journal.lastCommittedCycle,
    lastEpochCommitDigest: journal.lastEpochCommitDigest,
  });
  return {
    validRecords: prefix.records,
    truncatedTailBytes: Math.max(0, originalBytes - prefix.truncatedToBytes),
  };
}
