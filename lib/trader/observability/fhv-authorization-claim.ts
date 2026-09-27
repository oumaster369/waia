import {
  assertMetadataBytesSupported,
  readMetadataTextSync,
  type FhvMetadataReadOptions,
} from "@/lib/trader/backtest/streaming-evidence/bounded-metadata-read";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { FhvExecutionPurpose } from "@/lib/trader/observability/fhv-execution-purpose";

export const FHV_AUTHORIZATION_CLAIM_SCHEMA_VERSION = "fhv-authorization-claim/v2" as const;
export const FHV_AUTHORIZATION_CLAIM_FILENAME = "fhv-authorization-claim.v2.json" as const;
export const FHV_TERMINAL_RESULT_SCHEMA_VERSION = "fhv-terminal-result/v1" as const;
export const FHV_TERMINAL_RESULT_FILENAME = "fhv-terminal-result.v1.json" as const;

export type FhvAuthorizationClaimState = "ISSUED" | "CLAIMED" | "RUNNING" | "COMPLETED" | "ABORTED";

export type FhvAuthorizationClaimV2 = Readonly<{
  schemaVersion: typeof FHV_AUTHORIZATION_CLAIM_SCHEMA_VERSION;
  state: FhvAuthorizationClaimState;
  authorizationClaimDigest: string;
  authorizationReceiptDigest: string;
  executionPurpose: FhvExecutionPurpose;
  runId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
  fencingGeneration: number;
  leaseOwner: string;
  leaseExpiresAtUtc: string;
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  checkpointDigest: string;
  walCommitDigest: string;
  cycleZeroCheckpointDigest?: string;
  terminalResultDigest?: string;
  sessionDatabasePath?: string;
  activeGeneration?: number;
  claimedAtUtc?: string;
  completedAtUtc?: string;
  abortedAtUtc?: string;
  abortClassification?: string;
}>;

export type FhvTerminalResultV1 = Readonly<{
  schemaVersion: typeof FHV_TERMINAL_RESULT_SCHEMA_VERSION;
  runId: string;
  classification: string;
  semanticReproDigest: string;
  terminalResultDigest: string;
}>;

export type FhvTerminalReconcileResult =
  | Readonly<{ action: "resume" }>
  | Readonly<{ action: "complete"; claim: FhvAuthorizationClaimV2 }>
  | Readonly<{ action: "already_complete"; claim: FhvAuthorizationClaimV2 }>
  | Readonly<{
      action: "reconstructed";
      claim: FhvAuthorizationClaimV2;
      terminalResultPath: string;
    }>;

export class FhvAuthorizationClaimError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvAuthorizationClaimError";
  }
}

function computeAuthorizationClaimDigest(
  claim: Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest">,
): string {
  return computeStableJsonDigest(claim);
}

export function buildFhvAuthorizationClaimIssued(input: {
  authorizationReceiptDigest: string;
  executionPurpose: FhvExecutionPurpose;
  runId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
}): FhvAuthorizationClaimV2 {
  const body: Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest"> = {
    schemaVersion: FHV_AUTHORIZATION_CLAIM_SCHEMA_VERSION,
    state: "ISSUED",
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    executionPurpose: input.executionPurpose,
    runId: input.runId,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    configurationFreezeDigest: input.configurationFreezeDigest,
    ...(input.controlReplayReceiptDigest
      ? { controlReplayReceiptDigest: input.controlReplayReceiptDigest }
      : {}),
    fencingGeneration: 0,
    leaseOwner: "",
    leaseExpiresAtUtc: "1970-01-01T00:00:00.000Z",
    lastCommittedEpoch: -1,
    lastCommittedCycle: -1,
    checkpointDigest: "0".repeat(64),
    walCommitDigest: "0".repeat(64),
  };
  return { ...body, authorizationClaimDigest: computeAuthorizationClaimDigest(body) };
}

export function claimFhvAuthorizationExclusive(input: {
  claimPath: string;
  metadataReadProfile?: FhvMetadataReadOptions["metadataReadProfile"];
  leaseOwner: string;
  leaseExpiresAtUtc: string;
  cycleZeroCheckpointDigest: string;
}): FhvAuthorizationClaimV2 {
  mkdirSync(join(input.claimPath, ".."), { recursive: true });
  const lockPath = `${input.claimPath}.claim.lock`;
  const lockFd = claimFileExclusiveLock(lockPath);
  try {
    if (!existsSync(input.claimPath)) {
      throw new FhvAuthorizationClaimError("CLAIM_MISSING", "authorization claim file missing");
    }
    const expectedContent = readMetadataTextSync(input.claimPath, input);
    const claim = JSON.parse(expectedContent) as FhvAuthorizationClaimV2;
    validateAuthorizationClaimDigest(claim);
    if (claim.state !== "ISSUED") {
      throw new FhvAuthorizationClaimError("CLAIM_NOT_ISSUED", `claim state is ${claim.state}`);
    }
    const { authorizationClaimDigest: _issuedDigest, ...issuedBody } = claim;
    const withoutDigest: Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest"> = {
      ...issuedBody,
      state: "CLAIMED",
      fencingGeneration: 1,
      leaseOwner: input.leaseOwner,
      leaseExpiresAtUtc: input.leaseExpiresAtUtc,
      cycleZeroCheckpointDigest: input.cycleZeroCheckpointDigest,
      claimedAtUtc: new Date().toISOString(),
    };
    const next: FhvAuthorizationClaimV2 = {
      ...withoutDigest,
      authorizationClaimDigest: computeAuthorizationClaimDigest(withoutDigest),
    };
    writeFileAtomicCompareAndReplace({
      metadataReadProfile: input.metadataReadProfile,
      finalPath: input.claimPath,
      expectedContent,
      nextContent: `${JSON.stringify(next, null, 2)}\n`,
    });
    return next;
  } finally {
    releaseFileExclusiveLock(lockPath, lockFd);
  }
}

export function validateAuthorizationClaimDigest(claim: FhvAuthorizationClaimV2): void {
  const { authorizationClaimDigest, ...body } = claim;
  if (computeAuthorizationClaimDigest(body) !== authorizationClaimDigest) {
    throw new FhvAuthorizationClaimError(
      "CLAIM_DIGEST_MISMATCH",
      "authorization claim digest mismatch",
    );
  }
}

export function writeFhvAuthorizationClaimAtomic(
  claimPath: string,
  claim: FhvAuthorizationClaimV2,
  options?: FhvMetadataReadOptions,
): void {
  mkdirSync(join(claimPath, ".."), { recursive: true });
  if (existsSync(claimPath)) {
    throw new FhvAuthorizationClaimError("CLAIM_EXISTS", "authorization claim already exists");
  }
  const bytes = `${JSON.stringify(claim, null, 2)}\n`;
  assertMetadataBytesSupported(bytes, options);
  writeFileAtomicExclusive(claimPath, bytes);
}

export function readFhvAuthorizationClaim(
  claimPath: string,
  options?: FhvMetadataReadOptions,
): FhvAuthorizationClaimV2 {
  const claim = JSON.parse(readMetadataTextSync(claimPath, options)) as FhvAuthorizationClaimV2;
  validateAuthorizationClaimDigest(claim);
  return claim;
}

export function assertFhvStaleProcessRejected(input: {
  claim: FhvAuthorizationClaimV2;
  writerFencingGeneration: number;
}): void {
  if (input.writerFencingGeneration < input.claim.fencingGeneration) {
    throw new FhvAuthorizationClaimError(
      "STALE_FENCING_GENERATION",
      "stale process rejected by fencing generation",
    );
  }
}

export function resolveFhvAuthorizationClaimPath(runDir: string): string {
  return join(runDir, "control", FHV_AUTHORIZATION_CLAIM_FILENAME);
}

function stripAuthorizationClaimDigest(
  claim: FhvAuthorizationClaimV2 | Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest">,
): Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest"> {
  const { authorizationClaimDigest: _digest, ...body } = claim as FhvAuthorizationClaimV2;
  return body;
}

export type FhvAuthorizationClaimExpectedIdentity = Pick<
  FhvAuthorizationClaimV2,
  | "authorizationReceiptDigest"
  | "executionPurpose"
  | "runId"
  | "releaseSha"
  | "datasetContentDigest"
  | "manifestSemanticDigest"
  | "configurationFreezeDigest"
  | "controlReplayReceiptDigest"
>;
const CLAIM_IDENTITY_KEYS = [
  "authorizationReceiptDigest",
  "executionPurpose",
  "runId",
  "releaseSha",
  "datasetContentDigest",
  "manifestSemanticDigest",
  "configurationFreezeDigest",
  "controlReplayReceiptDigest",
] as const;

function transitionAuthorizationClaim(input: {
  claimPath: string;
  metadataReadProfile?: FhvMetadataReadOptions["metadataReadProfile"];
  expectedIdentity?: FhvAuthorizationClaimExpectedIdentity;
  expectedState: FhvAuthorizationClaimState;
  nextState: FhvAuthorizationClaimState;
  patch: (
    claim: FhvAuthorizationClaimV2,
  ) => Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest">;
}): FhvAuthorizationClaimV2 {
  const lockPath = `${input.claimPath}.claim.lock`;
  const lockFd = claimFileExclusiveLock(lockPath);
  try {
    const expectedContent = readMetadataTextSync(input.claimPath, input);
    const claim = JSON.parse(expectedContent) as FhvAuthorizationClaimV2;
    validateAuthorizationClaimDigest(claim);
    if (
      input.expectedIdentity &&
      CLAIM_IDENTITY_KEYS.some((key) => claim[key] !== input.expectedIdentity![key])
    ) {
      throw new FhvAuthorizationClaimError(
        "CLAIM_IDENTITY_MISMATCH",
        "Authorization claim immutable identity changed.",
      );
    }
    if (claim.state !== input.expectedState) {
      throw new FhvAuthorizationClaimError(
        "CLAIM_STATE_INVALID",
        `claim state is ${claim.state}, expected ${input.expectedState}`,
      );
    }
    const patched = input.patch(claim);
    const bodyWithoutDigest = stripAuthorizationClaimDigest(patched);
    const next: FhvAuthorizationClaimV2 = {
      ...bodyWithoutDigest,
      authorizationClaimDigest: computeAuthorizationClaimDigest(bodyWithoutDigest),
    };
    writeFileAtomicCompareAndReplace({
      metadataReadProfile: input.metadataReadProfile,
      finalPath: input.claimPath,
      expectedContent,
      nextContent: `${JSON.stringify(next, null, 2)}\n`,
    });
    return next;
  } finally {
    releaseFileExclusiveLock(lockPath, lockFd);
  }
}

export function beginFhvAuthorizationRunning(input: {
  claimPath: string;
  metadataReadProfile?: FhvMetadataReadOptions["metadataReadProfile"];
  leaseOwner: string;
}): FhvAuthorizationClaimV2 {
  return transitionAuthorizationClaim({
    metadataReadProfile: input.metadataReadProfile,
    claimPath: input.claimPath,
    expectedState: "CLAIMED",
    nextState: "RUNNING",
    patch: (claim) => ({
      ...claim,
      state: "RUNNING",
      leaseOwner: input.leaseOwner,
    }),
  });
}

export function commitFhvAuthorizationEpoch(input: {
  claimPath: string;
  metadataReadProfile?: FhvMetadataReadOptions["metadataReadProfile"];
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  checkpointDigest: string;
  walCommitDigest: string;
  sessionDatabasePath?: string;
  activeGeneration?: number;
}): FhvAuthorizationClaimV2 {
  return transitionAuthorizationClaim({
    metadataReadProfile: input.metadataReadProfile,
    claimPath: input.claimPath,
    expectedState: "RUNNING",
    nextState: "RUNNING",
    patch: (claim) => ({
      ...claim,
      lastCommittedEpoch: input.lastCommittedEpoch,
      lastCommittedCycle: input.lastCommittedCycle,
      checkpointDigest: input.checkpointDigest,
      walCommitDigest: input.walCommitDigest,
      ...(input.sessionDatabasePath ? { sessionDatabasePath: input.sessionDatabasePath } : {}),
      ...(input.activeGeneration !== undefined ? { activeGeneration: input.activeGeneration } : {}),
    }),
  });
}

export function takeoverFhvAuthorizationRunning(input: {
  claimPath: string;
  metadataReadProfile?: FhvMetadataReadOptions["metadataReadProfile"];
  expectedIdentity?: FhvAuthorizationClaimExpectedIdentity;
  leaseOwner: string;
  leaseExpiresAtUtc?: string;
}): FhvAuthorizationClaimV2 {
  return transitionAuthorizationClaim({
    metadataReadProfile: input.metadataReadProfile,
    claimPath: input.claimPath,
    expectedIdentity: input.expectedIdentity,
    expectedState: "RUNNING",
    nextState: "RUNNING",
    patch: (claim) => ({
      ...claim,
      state: "RUNNING",
      fencingGeneration: claim.fencingGeneration + 1,
      leaseOwner: input.leaseOwner,
      leaseExpiresAtUtc: input.leaseExpiresAtUtc ?? new Date(Date.now() + 86_400_000).toISOString(),
      activeGeneration: claim.fencingGeneration + 1,
    }),
  });
}

function computeTerminalResultDigest(
  terminal: Omit<FhvTerminalResultV1, "terminalResultDigest">,
): string {
  return computeStableJsonDigest(terminal);
}

export function buildFhvTerminalResult(input: {
  runId: string;
  classification: string;
  semanticReproDigest: string;
}): FhvTerminalResultV1 {
  const body: Omit<FhvTerminalResultV1, "terminalResultDigest"> = {
    schemaVersion: FHV_TERMINAL_RESULT_SCHEMA_VERSION,
    runId: input.runId,
    classification: input.classification,
    semanticReproDigest: input.semanticReproDigest,
  };
  return { ...body, terminalResultDigest: computeTerminalResultDigest(body) };
}

export function readFhvTerminalResult(
  terminalResultPath: string,
  options?: FhvMetadataReadOptions,
): FhvTerminalResultV1 {
  if (!existsSync(terminalResultPath)) {
    throw new FhvAuthorizationClaimError("TERMINAL_RESULT_MISSING", "terminal result file missing");
  }
  const terminal = JSON.parse(
    readMetadataTextSync(terminalResultPath, options),
  ) as FhvTerminalResultV1;
  const { terminalResultDigest, ...body } = terminal;
  if (computeTerminalResultDigest(body) !== terminalResultDigest) {
    throw new FhvAuthorizationClaimError(
      "TERMINAL_DIGEST_INVALID",
      "terminal result digest mismatch",
    );
  }
  return terminal;
}

export function writeFhvTerminalResultAtomic(
  terminalResultPath: string,
  terminal: FhvTerminalResultV1,
): void {
  mkdirSync(join(terminalResultPath, ".."), { recursive: true });
  if (existsSync(terminalResultPath)) {
    throw new FhvAuthorizationClaimError(
      "TERMINAL_RESULT_EXISTS",
      "terminal result already exists",
    );
  }
  writeFileAtomicExclusive(terminalResultPath, `${JSON.stringify(terminal, null, 2)}\n`);
}

export function resolveFhvTerminalResultPath(runDir: string): string {
  return join(runDir, "control", FHV_TERMINAL_RESULT_FILENAME);
}

export function completeFhvAuthorizationClaim(input: {
  claimPath: string;
  terminalResultDigest: string;
}): FhvAuthorizationClaimV2 {
  return transitionAuthorizationClaim({
    claimPath: input.claimPath,
    expectedState: "RUNNING",
    nextState: "COMPLETED",
    patch: (claim) => ({
      ...claim,
      state: "COMPLETED",
      terminalResultDigest: input.terminalResultDigest,
      completedAtUtc: new Date().toISOString(),
    }),
  });
}

function reconstructTerminalFromCheckpoint(input: {
  runDir: string;
  claim: FhvAuthorizationClaimV2;
  terminalResultPath: string;
}): FhvTerminalReconcileResult {
  if (input.claim.lastCommittedEpoch < 0) {
    throw new FhvAuthorizationClaimError(
      "TERMINAL_CHECKPOINT_MISSING",
      "cannot reconstruct terminal without committed epoch checkpoint",
    );
  }
  const checkpointDir = resolveFhvEpochCheckpointDir(input.runDir, input.claim.lastCommittedEpoch);
  readFhvExecutionCheckpointBundle(checkpointDir);
  const terminalSnapshotPath = join(checkpointDir, FHV_TERMINAL_RESULT_FILENAME);
  if (!existsSync(terminalSnapshotPath)) {
    throw new FhvAuthorizationClaimError(
      "TERMINAL_CHECKPOINT_MISSING",
      "terminal checkpoint snapshot missing from last committed epoch",
    );
  }
  const terminal = readFhvTerminalResult(terminalSnapshotPath);
  if (terminal.terminalResultDigest !== input.claim.terminalResultDigest) {
    throw new FhvAuthorizationClaimError(
      "TERMINAL_CHECKPOINT_DIGEST_MISMATCH",
      "terminal checkpoint digest does not match completed claim",
    );
  }
  writeFhvTerminalResultAtomic(input.terminalResultPath, terminal);
  return {
    action: "reconstructed",
    claim: input.claim,
    terminalResultPath: input.terminalResultPath,
  };
}

export function reconcileFhvTerminalState(input: {
  claimPath: string;
  terminalResultPath: string;
  runDir: string;
}): FhvTerminalReconcileResult {
  const claim = readFhvAuthorizationClaim(input.claimPath);
  const terminalExists = existsSync(input.terminalResultPath);

  if (claim.state === "COMPLETED") {
    if (!terminalExists) {
      return reconstructTerminalFromCheckpoint({
        runDir: input.runDir,
        claim,
        terminalResultPath: input.terminalResultPath,
      });
    }
    const terminal = readFhvTerminalResult(input.terminalResultPath);
    if (claim.terminalResultDigest !== terminal.terminalResultDigest) {
      throw new FhvAuthorizationClaimError(
        "TERMINAL_DIGEST_MISMATCH",
        "completed claim terminal digest does not match terminal result file",
      );
    }
    return { action: "already_complete", claim };
  }

  if (claim.state !== "RUNNING") {
    throw new FhvAuthorizationClaimError(
      "CLAIM_STATE_INVALID",
      `cannot reconcile terminal for claim state ${claim.state}`,
    );
  }

  if (!terminalExists) {
    return { action: "resume" };
  }

  let terminal: FhvTerminalResultV1;
  try {
    terminal = readFhvTerminalResult(input.terminalResultPath);
  } catch (error) {
    if (error instanceof FhvAuthorizationClaimError && error.code === "TERMINAL_DIGEST_INVALID") {
      throw error;
    }
    throw new FhvAuthorizationClaimError(
      "TERMINAL_DIGEST_INVALID",
      `invalid terminal result at ${input.terminalResultPath}: ${String(error)}`,
    );
  }

  const completed = completeFhvAuthorizationClaim({
    claimPath: input.claimPath,
    terminalResultDigest: terminal.terminalResultDigest,
  });
  return { action: "complete", claim: completed };
}
