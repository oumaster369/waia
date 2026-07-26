/**
 * DEE-436 — FHV T4A disconnect/reconnect continuity capture and verification.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readFhvCommandLedgerEntries } from "@/lib/trader/observability/fhv-command-ledger";
import { readFhvRehearsalManifest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvSystemdDeployedRevision } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_T4_CAMPAIGN_RUNTIME_FILENAME,
  readFhvT4CampaignRuntimeProof,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  assertFhvT4CompletedCampaignProcessUnchanged,
  parseFhvT4CompletedCampaignSystemdIdentity,
  type FhvT4CompletedCampaignSystemdIdentityV1,
} from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";
import {
  assertFhvT4ObserverRestartProven,
  type FhvT4ObserverSystemdIdentityV1,
} from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";

export const FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION = "fhv-t4-continuity-snapshot/v4" as const;
export const FHV_T4_CONTINUITY_VERIFICATION_PASS = "FHV_T4_CONTINUITY_VERIFICATION_PASS" as const;
export const FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_VERSION =
  "fhv-t4-continuity-verification-proof/v1" as const;
export const FHV_T4_CONTINUITY_VERIFICATION_PROOF_FILENAME =
  "fhv-t4-continuity-verification-proof.v1.json" as const;

export type FhvT4ContinuityCapturePhase = "before_disconnect" | "after_reconnect";

export type FhvT4ContinuityDigestKey =
  | "manifest"
  | "terminal"
  | "checkpoint"
  | "economicFrontier"
  | "resumeRuntimeProof"
  | "runChainManifest"
  | "deploymentRecord"
  | "commandLedger"
  | "campaignRuntimeProof";

export type FhvT4ContinuitySnapshotV1 = Readonly<{
  schemaVersion: typeof FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  targetSha: string;
  capturePhase: FhvT4ContinuityCapturePhase;
  /** Narrative metadata only; never machine proof. */
  operatorNarrativeEvent?: "SSH_DISCONNECT" | "SSH_RECONNECT";
  observerSystemdIdentity: FhvT4ObserverSystemdIdentityV1;
  campaignSystemdIdentity: FhvT4CompletedCampaignSystemdIdentityV1;
  digests: Readonly<Record<FhvT4ContinuityDigestKey, string>>;
  contentDigest: string;
}>;

export type FhvT4ContinuityVerificationProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  targetSha: string;
  beforeDigest: string;
  afterDigest: string;
  classification: typeof FHV_T4_CONTINUITY_VERIFICATION_PASS;
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4ContinuityCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ContinuityCaptureError";
  }
}

const REQUIRED_DIGEST_KEYS: readonly FhvT4ContinuityDigestKey[] = [
  "manifest",
  "terminal",
  "checkpoint",
  "economicFrontier",
  "resumeRuntimeProof",
  "runChainManifest",
  "deploymentRecord",
  "commandLedger",
  "campaignRuntimeProof",
] as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireFile(path: string, code: string): void {
  if (!existsSync(path)) {
    throw new FhvT4ContinuityCaptureError(code, `Required path missing: ${path}`);
  }
}

function digestCheckpointEconomicFrontier(runRoot: string): string {
  const checkpointPath = join(runRoot, "replay-checkpoint.json");
  requireFile(checkpointPath, "FHV_T4_CONTINUITY_CHECKPOINT_MISSING");
  const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as {
    rehearsalEconomicFrontierState?: unknown;
  };
  if (!checkpoint.rehearsalEconomicFrontierState) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_ECONOMIC_FRONTIER_MISSING",
      "Checkpoint rehearsalEconomicFrontierState is required.",
    );
  }
  return computePayloadDigest(checkpoint.rehearsalEconomicFrontierState);
}

function digestCommandLedger(runRoot: string): string {
  const entries = readFhvCommandLedgerEntries(runRoot);
  if (entries.length === 0) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_COMMAND_LEDGER_EMPTY",
      "Command ledger must contain at least one entry.",
    );
  }
  return computePayloadDigest(entries);
}

function digestDeploymentRecord(repoRoot: string): string {
  const record = readFhvSystemdDeployedRevision(repoRoot);
  if (!record) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_DEPLOYMENT_RECORD_MISSING",
      "Systemd deployment record is required.",
    );
  }
  return computePayloadDigest(record);
}

function digestCampaignRuntimeProof(runRoot: string): string {
  const proof = readFhvT4CampaignRuntimeProof(runRoot);
  if (!proof) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_CAMPAIGN_RUNTIME_MISSING",
      "Campaign runtime proof is required for continuity capture.",
    );
  }
  return computePayloadDigest(proof);
}

export function resolveFhvT4ContinuityVerificationProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_CONTINUITY_VERIFICATION_PROOF_FILENAME);
}

export function captureFhvT4ContinuitySnapshot(input: {
  runRoot: string;
  repoRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  capturePhase: FhvT4ContinuityCapturePhase;
  observerSystemdIdentity: FhvT4ObserverSystemdIdentityV1;
  campaignSystemdIdentity: FhvT4CompletedCampaignSystemdIdentityV1;
  operatorNarrativeEvent?: "SSH_DISCONNECT" | "SSH_RECONNECT";
}): FhvT4ContinuitySnapshotV1 {
  const manifest = readFhvRehearsalManifest(input.runRoot);
  if (manifest.runId !== input.runId || manifest.organizationId !== input.organizationId) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_MANIFEST_IDENTITY_MISMATCH",
      "Manifest run/org identity mismatch.",
    );
  }
  if (manifest.targetSha !== input.targetSha) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_TARGET_SHA_MISMATCH",
      "Manifest targetSha mismatch.",
    );
  }
  if (!input.campaignSystemdIdentity.unitName.includes("campaign")) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_CAMPAIGN_UNIT_INVALID",
      "campaignSystemdIdentity.unitName must identify the campaign unit.",
    );
  }
  if (!input.observerSystemdIdentity.unitName.includes("observer")) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_OBSERVER_UNIT_INVALID",
      "observerSystemdIdentity.unitName must identify the observer unit.",
    );
  }

  const manifestPath = join(input.runRoot, "fhv-rehearsal-manifest.v1.json");
  const terminalPath = join(input.runRoot, "fhv-rehearsal-terminal.v1.json");
  const checkpointPath = join(input.runRoot, "replay-checkpoint.json");
  const resumeProofPath = join(input.runRoot, "fhv-resume-runtime-proof.v1.json");
  const runChainPath = join(input.runRoot, "run-chain.json");
  const runtimeProofPath = join(input.runRoot, FHV_T4_CAMPAIGN_RUNTIME_FILENAME);

  for (const [path, code] of [
    [manifestPath, "FHV_T4_CONTINUITY_MANIFEST_MISSING"],
    [terminalPath, "FHV_T4_CONTINUITY_TERMINAL_MISSING"],
    [checkpointPath, "FHV_T4_CONTINUITY_CHECKPOINT_MISSING"],
    [resumeProofPath, "FHV_T4_CONTINUITY_RESUME_PROOF_MISSING"],
    [runChainPath, "FHV_T4_CONTINUITY_RUN_CHAIN_MISSING"],
    [runtimeProofPath, "FHV_T4_CONTINUITY_RUNTIME_PROOF_MISSING"],
  ] as const) {
    requireFile(path, code);
  }

  const digests: Record<FhvT4ContinuityDigestKey, string> = {
    manifest: sha256File(manifestPath),
    terminal: sha256File(terminalPath),
    checkpoint: sha256File(checkpointPath),
    economicFrontier: digestCheckpointEconomicFrontier(input.runRoot),
    resumeRuntimeProof: sha256File(resumeProofPath),
    runChainManifest: sha256File(runChainPath),
    deploymentRecord: digestDeploymentRecord(input.repoRoot),
    commandLedger: digestCommandLedger(input.runRoot),
    campaignRuntimeProof: digestCampaignRuntimeProof(input.runRoot),
  };

  const withoutDigest = {
    schemaVersion: FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
    capturePhase: input.capturePhase,
    ...(input.operatorNarrativeEvent
      ? { operatorNarrativeEvent: input.operatorNarrativeEvent }
      : {}),
    observerSystemdIdentity: input.observerSystemdIdentity,
    campaignSystemdIdentity: input.campaignSystemdIdentity,
    digests,
  };

  return {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
}

export function verifyFhvT4ContinuitySnapshots(input: {
  before: FhvT4ContinuitySnapshotV1;
  after: FhvT4ContinuitySnapshotV1;
}): {
  classification: typeof FHV_T4_CONTINUITY_VERIFICATION_PASS;
} {
  for (const snapshot of [input.before, input.after]) {
    const { contentDigest, ...withoutDigest } = snapshot;
    if (computePayloadDigest(withoutDigest) !== contentDigest) {
      throw new FhvT4ContinuityCaptureError(
        "FHV_T4_CONTINUITY_SNAPSHOT_DIGEST_MISMATCH",
        `Snapshot contentDigest mismatch for ${snapshot.capturePhase}.`,
      );
    }
  }

  if (input.before.capturePhase !== "before_disconnect") {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_BEFORE_PHASE_INVALID",
      "Before snapshot must be before_disconnect.",
    );
  }
  if (input.after.capturePhase !== "after_reconnect") {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_AFTER_PHASE_INVALID",
      "After snapshot must be after_reconnect.",
    );
  }
  if (input.before.runId !== input.after.runId) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_RUN_ID_MISMATCH",
      "Before/after runId mismatch.",
    );
  }
  if (input.before.organizationId !== input.after.organizationId) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_ORG_MISMATCH",
      "Before/after organizationId mismatch.",
    );
  }
  if (input.before.targetSha !== input.after.targetSha) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_SHA_MISMATCH",
      "Before/after targetSha mismatch.",
    );
  }
  if (input.after.observerSystemdIdentity.activeState !== "active") {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_OBSERVER_NOT_ACTIVE",
      "Observer must be active after reconnect.",
    );
  }
  assertFhvT4ObserverRestartProven({
    before: input.before.observerSystemdIdentity,
    after: input.after.observerSystemdIdentity,
  });
  assertFhvT4CompletedCampaignProcessUnchanged({
    before: input.before.campaignSystemdIdentity,
    after: input.after.campaignSystemdIdentity,
  });

  for (const key of REQUIRED_DIGEST_KEYS) {
    if (!input.before.digests[key] || !input.after.digests[key]) {
      throw new FhvT4ContinuityCaptureError(
        "FHV_T4_CONTINUITY_DIGEST_KEY_MISSING",
        `Digest key missing: ${key}`,
      );
    }
    if (input.before.digests[key] !== input.after.digests[key]) {
      throw new FhvT4ContinuityCaptureError(
        "FHV_T4_CONTINUITY_DIGEST_CHANGED",
        `Continuity digest changed for ${key}.`,
      );
    }
  }

  return { classification: FHV_T4_CONTINUITY_VERIFICATION_PASS };
}

export function writeFhvT4ContinuityVerificationProofAtomic(input: {
  runRoot: string;
  before: FhvT4ContinuitySnapshotV1;
  after: FhvT4ContinuitySnapshotV1;
}): FhvT4ContinuityVerificationProofV1 {
  const verified = verifyFhvT4ContinuitySnapshots({ before: input.before, after: input.after });
  const withoutDigest = {
    schemaVersion: FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_VERSION,
    runId: input.before.runId,
    organizationId: input.before.organizationId,
    targetSha: input.before.targetSha,
    beforeDigest: input.before.contentDigest,
    afterDigest: input.after.contentDigest,
    classification: verified.classification,
    capturedAtUtc: new Date().toISOString(),
  };
  const proof: FhvT4ContinuityVerificationProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(
    resolveFhvT4ContinuityVerificationProofPath(input.runRoot),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  return proof;
}

export function readFhvT4ContinuityVerificationProof(
  runRoot: string,
): FhvT4ContinuityVerificationProofV1 | null {
  const path = resolveFhvT4ContinuityVerificationProofPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4ContinuityVerificationProofV1;
}

export function verifyFhvT4ContinuityVerificationProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  runId: string;
  organizationId: string;
  beforeDigest: string;
  afterDigest: string;
}): FhvT4ContinuityVerificationProofV1 {
  const proof = readFhvT4ContinuityVerificationProof(input.runRoot);
  if (!proof) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_MISSING",
      "Continuity verification proof is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_DIGEST_MISMATCH",
      "Continuity verification proof contentDigest mismatch.",
    );
  }
  if (
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId ||
    proof.targetSha !== input.targetSha ||
    proof.beforeDigest !== input.beforeDigest ||
    proof.afterDigest !== input.afterDigest ||
    proof.classification !== FHV_T4_CONTINUITY_VERIFICATION_PASS
  ) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_IDENTITY_MISMATCH",
      "Continuity verification proof identity mismatch.",
    );
  }
  return proof;
}

export function parseFhvT4ContinuityVerificationProof(
  raw: unknown,
): FhvT4ContinuityVerificationProofV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_INVALID",
      "Continuity verification proof must be an object.",
    );
  }
  const proof = raw as FhvT4ContinuityVerificationProofV1;
  if (proof.schemaVersion !== FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_VERSION) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_SCHEMA_MISMATCH",
      "Continuity verification proof schemaVersion mismatch.",
    );
  }
  if (
    !proof.runId?.trim() ||
    !proof.organizationId?.trim() ||
    !proof.targetSha?.trim() ||
    !proof.beforeDigest?.trim() ||
    !proof.afterDigest?.trim() ||
    !proof.capturedAtUtc?.trim()
  ) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_FIELD_MISSING",
      "Continuity verification proof missing required fields.",
    );
  }
  if (proof.classification !== FHV_T4_CONTINUITY_VERIFICATION_PASS) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_CLASSIFICATION_INVALID",
      "Continuity verification proof classification invalid.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_VERIFICATION_PROOF_DIGEST_MISMATCH",
      "Continuity verification proof contentDigest mismatch.",
    );
  }
  return proof;
}

export function parseFhvT4ContinuitySnapshot(raw: unknown): FhvT4ContinuitySnapshotV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_SNAPSHOT_INVALID",
      "Snapshot must be an object.",
    );
  }
  const snapshot = raw as FhvT4ContinuitySnapshotV1;
  if (snapshot.schemaVersion !== FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_SCHEMA_MISMATCH",
      "Snapshot schemaVersion mismatch.",
    );
  }
  if (!snapshot.campaignSystemdIdentity) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_CAMPAIGN_IDENTITY_MISSING",
      "campaignSystemdIdentity is required.",
    );
  }
  parseFhvT4CompletedCampaignSystemdIdentity(snapshot.campaignSystemdIdentity);
  return snapshot;
}
