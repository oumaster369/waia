import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { FhvExecutionPurpose } from "@/lib/trader/observability/fhv-execution-purpose";

export const FHV_AUTHORIZATION_CLAIM_SCHEMA_VERSION = "fhv-authorization-claim/v2" as const;
export const FHV_AUTHORIZATION_CLAIM_FILENAME = "fhv-authorization-claim.v2.json" as const;

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
  claimedAtUtc?: string;
  completedAtUtc?: string;
  abortedAtUtc?: string;
  abortClassification?: string;
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
    const expectedContent = readFileSync(input.claimPath, "utf8");
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
): void {
  mkdirSync(join(claimPath, ".."), { recursive: true });
  if (existsSync(claimPath)) {
    throw new FhvAuthorizationClaimError("CLAIM_EXISTS", "authorization claim already exists");
  }
  writeFileAtomicExclusive(claimPath, `${JSON.stringify(claim, null, 2)}\n`);
}

export function readFhvAuthorizationClaim(claimPath: string): FhvAuthorizationClaimV2 {
  const claim = JSON.parse(readFileSync(claimPath, "utf8")) as FhvAuthorizationClaimV2;
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

function transitionAuthorizationClaim(input: {
  claimPath: string;
  expectedState: FhvAuthorizationClaimState;
  nextState: FhvAuthorizationClaimState;
  patch: (
    claim: FhvAuthorizationClaimV2,
  ) => Omit<FhvAuthorizationClaimV2, "authorizationClaimDigest">;
}): FhvAuthorizationClaimV2 {
  const lockPath = `${input.claimPath}.claim.lock`;
  const lockFd = claimFileExclusiveLock(lockPath);
  try {
    const expectedContent = readFileSync(input.claimPath, "utf8");
    const claim = JSON.parse(expectedContent) as FhvAuthorizationClaimV2;
    validateAuthorizationClaimDigest(claim);
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
  leaseOwner: string;
}): FhvAuthorizationClaimV2 {
  return transitionAuthorizationClaim({
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
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  checkpointDigest: string;
  walCommitDigest: string;
}): FhvAuthorizationClaimV2 {
  return transitionAuthorizationClaim({
    claimPath: input.claimPath,
    expectedState: "RUNNING",
    nextState: "RUNNING",
    patch: (claim) => ({
      ...claim,
      lastCommittedEpoch: input.lastCommittedEpoch,
      lastCommittedCycle: input.lastCommittedCycle,
      checkpointDigest: input.checkpointDigest,
      walCommitDigest: input.walCommitDigest,
    }),
  });
}
