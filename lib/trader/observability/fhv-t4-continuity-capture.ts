/**
 * DEE-436 — FHV T4A disconnect/reconnect continuity capture and verification.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readFhvCommandLedgerEntries } from "@/lib/trader/observability/fhv-command-ledger";
import { readFhvRehearsalManifest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvSystemdDeployedRevision } from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_T4_CAMPAIGN_RUNTIME_FILENAME,
  readFhvT4CampaignRuntimeProof,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";

export const FHV_T4_CONTINUITY_SNAPSHOT_SCHEMA_VERSION = "fhv-t4-continuity-snapshot/v1" as const;
export const FHV_T4_CONTINUITY_VERIFICATION_PASS = "FHV_T4_CONTINUITY_VERIFICATION_PASS" as const;

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
  observerRestartRecorded: boolean;
  digests: Readonly<Record<FhvT4ContinuityDigestKey, string>>;
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

export function captureFhvT4ContinuitySnapshot(input: {
  runRoot: string;
  repoRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  capturePhase: FhvT4ContinuityCapturePhase;
  observerRestartRecorded: boolean;
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

  if (input.capturePhase === "after_reconnect" && input.observerRestartRecorded !== true) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_OBSERVER_RESTART_REQUIRED",
      "after_reconnect capture requires observerRestartRecorded=true.",
    );
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
    observerRestartRecorded: input.observerRestartRecorded,
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
  if (input.after.observerRestartRecorded !== true) {
    throw new FhvT4ContinuityCaptureError(
      "FHV_T4_CONTINUITY_OBSERVER_RESTART_NOT_RECORDED",
      "After snapshot must record observer restart.",
    );
  }

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
  return snapshot;
}
