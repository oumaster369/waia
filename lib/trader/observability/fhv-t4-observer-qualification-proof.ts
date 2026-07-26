/**
 * DEE-436 — immutable observer qualification proof (pre-campaign / post-restart).
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  AtomicFileWriteError,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";

export const FHV_T4_OBSERVER_QUALIFICATION_PROOF_SCHEMA_VERSION =
  "fhv-t4-observer-qualification-proof/v1" as const;

export type FhvT4ObserverQualificationPhase = "PRE_CAMPAIGN" | "POST_RESTART";

export type FhvT4ObserverQualificationIdentityCapture = Readonly<{
  unitName: string;
  bootId: string;
  invocationId: string;
  mainPid: number;
  activeEnterTimestampMonotonicUs: string;
  activeState: string;
}>;

/** Unsigned payload — no contentDigest; serialized exactly once at publication. */
export type FhvT4ObserverQualificationProofUnsignedV1 = Readonly<{
  schemaVersion: typeof FHV_T4_OBSERVER_QUALIFICATION_PROOF_SCHEMA_VERSION;
  phase: FhvT4ObserverQualificationPhase;
  runId: string;
  organizationId: string;
  targetSha: string;
  bootId: string;
  unitName: string;
  identityBeforeCapture: FhvT4ObserverQualificationIdentityCapture;
  identityAfterCapture: FhvT4ObserverQualificationIdentityCapture;
  statusDigest: string;
  capturedAtUtc: string;
  /** Required for POST_RESTART — persisted completed campaign identity digest. */
  completedCampaignIdentityDigest?: string;
}>;

export type FhvT4ObserverQualificationProofV1 = FhvT4ObserverQualificationProofUnsignedV1 &
  Readonly<{
    contentDigest: string;
  }>;

export class FhvT4ObserverQualificationProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ObserverQualificationProofError";
  }
}

const OBSERVER_QUALIFICATION_UNIT = "waia-fhv-observer.service";

function normalizeCapture(
  capture: FhvT4ObserverQualificationIdentityCapture,
): FhvT4ObserverQualificationIdentityCapture {
  if (!capture.unitName?.trim()) {
    throw new FhvT4ObserverQualificationProofError(
      "QUALIFICATION_CAPTURE_UNIT_NAME_NOT_PERSISTED",
      "identity capture unitName required.",
    );
  }
  if (!capture.bootId?.trim()) {
    throw new FhvT4ObserverQualificationProofError(
      "QUALIFICATION_CAPTURE_BOOT_ID_NOT_PERSISTED",
      "identity capture bootId required.",
    );
  }
  return {
    unitName: capture.unitName.trim(),
    bootId: normalizeFhvT4BootId(capture.bootId),
    invocationId: capture.invocationId.trim(),
    mainPid: capture.mainPid,
    activeEnterTimestampMonotonicUs: capture.activeEnterTimestampMonotonicUs.trim(),
    activeState: capture.activeState.trim(),
  };
}

function normalizeUnsignedInput(
  input: FhvT4ObserverQualificationProofUnsignedV1,
): FhvT4ObserverQualificationProofUnsignedV1 {
  const normalized = {
    ...input,
    bootId: normalizeFhvT4BootId(input.bootId),
    unitName: input.unitName.trim(),
    identityBeforeCapture: normalizeCapture(input.identityBeforeCapture),
    identityAfterCapture: normalizeCapture(input.identityAfterCapture),
    targetSha: input.targetSha.trim().toLowerCase(),
  };
  if (normalized.unitName !== OBSERVER_QUALIFICATION_UNIT) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_UNIT_MISMATCH",
      "Proof unitName must be waia-fhv-observer.service.",
    );
  }
  for (const [label, capture] of [
    ["before", normalized.identityBeforeCapture],
    ["after", normalized.identityAfterCapture],
  ] as const) {
    if (capture.unitName !== OBSERVER_QUALIFICATION_UNIT) {
      throw new FhvT4ObserverQualificationProofError(
        "FHV_T4_OBSERVER_QUALIFICATION_UNIT_MISMATCH",
        `${label} capture unitName must be waia-fhv-observer.service.`,
      );
    }
    if (capture.bootId !== normalized.bootId) {
      throw new FhvT4ObserverQualificationProofError(
        "QUALIFICATION_PROOF_BOOT_ID_CAPTURE_MISMATCH",
        `${label} capture bootId must equal proof bootId.`,
      );
    }
  }
  if (normalized.identityBeforeCapture.unitName !== normalized.identityAfterCapture.unitName) {
    throw new FhvT4ObserverQualificationProofError(
      "QUALIFICATION_CAPTURE_UNIT_MISMATCH",
      "Observer unitName drift between health and second capture.",
    );
  }
  if (normalized.identityBeforeCapture.bootId !== normalized.identityAfterCapture.bootId) {
    throw new FhvT4ObserverQualificationProofError(
      "QUALIFICATION_CAPTURE_BOOT_ID_MISMATCH",
      "Observer bootId drift between health and second capture.",
    );
  }
  if (
    normalized.identityBeforeCapture.invocationId !== normalized.identityAfterCapture.invocationId
  ) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_DRIFT",
      "Observer identity drift between health and second capture.",
    );
  }
  if (normalized.identityBeforeCapture.mainPid !== normalized.identityAfterCapture.mainPid) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_PID_DRIFT",
      "Observer MainPID drift between health and second capture.",
    );
  }
  if (normalized.identityBeforeCapture.activeState !== "active") {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_NOT_ACTIVE",
      "Observer must be active at qualification.",
    );
  }
  if (!normalized.statusDigest.trim()) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_STATUS_DIGEST_MISSING",
      "statusDigest required.",
    );
  }
  if (normalized.phase === "POST_RESTART" && !normalized.completedCampaignIdentityDigest?.trim()) {
    throw new FhvT4ObserverQualificationProofError(
      "POST_RESTART_CAMPAIGN_IDENTITY_NOT_IN_PROOF",
      "POST_RESTART proof requires completedCampaignIdentityDigest.",
    );
  }
  if (normalized.phase === "PRE_CAMPAIGN" && normalized.completedCampaignIdentityDigest) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_PRE_CAMPAIGN_CAMPAIGN_FIELD",
      "PRE_CAMPAIGN proof must not include completedCampaignIdentityDigest.",
    );
  }
  return normalized;
}

export function parseFhvT4ObserverQualificationProofUnsigned(
  raw: unknown,
): FhvT4ObserverQualificationProofUnsignedV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVALID",
      "Observer qualification proof must be an object.",
    );
  }
  const candidate = raw as Record<string, unknown>;
  if ("contentDigest" in candidate) {
    throw new FhvT4ObserverQualificationProofError(
      "QUALIFICATION_DOUBLE_SERIALIZATION",
      "Unsigned qualification payload must not include contentDigest.",
    );
  }
  return normalizeUnsignedInput(candidate as FhvT4ObserverQualificationProofUnsignedV1);
}

export function serializeFhvT4ObserverQualificationProof(
  input: FhvT4ObserverQualificationProofUnsignedV1,
): FhvT4ObserverQualificationProofV1 {
  const normalized = normalizeUnsignedInput(input);
  return {
    ...normalized,
    contentDigest: computePayloadDigest(normalized),
  };
}

export function parseFhvT4ObserverQualificationProof(
  raw: unknown,
): FhvT4ObserverQualificationProofV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVALID",
      "Observer qualification proof must be an object.",
    );
  }
  const proof = raw as FhvT4ObserverQualificationProofV1;
  if (proof.schemaVersion !== FHV_T4_OBSERVER_QUALIFICATION_PROOF_SCHEMA_VERSION) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_SCHEMA_MISMATCH",
      "schemaVersion mismatch.",
    );
  }
  normalizeUnsignedInput(proof);
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4ObserverQualificationProofError(
      "QUALIFICATION_CONTENT_DIGEST_INVALID",
      "contentDigest mismatch.",
    );
  }
  return proof;
}

export function resolveFhvT4ObserverQualificationPreCampaignPath(runRoot: string): string {
  return join(runRoot, "control", "fhv-t4-observer-qualification-pre-campaign.v1.json");
}

export function resolveFhvT4ObserverQualificationPostRestartPath(runRoot: string): string {
  return join(runRoot, "control", "fhv-t4-observer-qualification-post-restart.v1.json");
}

export function resolveFhvT4ObserverQualificationProofPath(
  runRoot: string,
  phase: FhvT4ObserverQualificationPhase,
): string {
  return phase === "PRE_CAMPAIGN"
    ? resolveFhvT4ObserverQualificationPreCampaignPath(runRoot)
    : resolveFhvT4ObserverQualificationPostRestartPath(runRoot);
}

export function writeFhvT4ObserverQualificationProofAtomic(
  outputPath: string,
  input: FhvT4ObserverQualificationProofUnsignedV1,
): FhvT4ObserverQualificationProofV1 {
  mkdirSync(dirname(outputPath), { recursive: true });
  const proof = serializeFhvT4ObserverQualificationProof(input);
  const serialized = `${JSON.stringify(proof, null, 2)}\n`;
  writeFileAtomicExclusive(outputPath, serialized);
  parseFhvT4ObserverQualificationProof(JSON.parse(serialized));
  return proof;
}

export function readFhvT4ObserverQualificationProofFromFile(
  path: string,
): FhvT4ObserverQualificationProofV1 {
  if (!existsSync(path)) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_PROOF_MISSING",
      `Proof missing: ${path}`,
    );
  }
  return parseFhvT4ObserverQualificationProof(JSON.parse(readFileSync(path, "utf8")));
}

export { AtomicFileWriteError as FhvT4ObserverQualificationProofWriteError };
