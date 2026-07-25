/**
 * DEE-436 — immutable normalized host-probe proof (service-user owned).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
  FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";

export const FHV_T4_HOST_PROBE_PROOF_SCHEMA_VERSION = "fhv-t4-host-probe-proof/v1" as const;
export const FHV_T4_HOST_PROBE_PROOF_FILENAME = "fhv-t4-host-probe-proof.v1.json" as const;
export const FHV_T4_POST_ROLLBACK_HOST_PROBE_PROOF_FILENAME =
  "fhv-t4-post-rollback-host-probe-proof.v1.json" as const;

export type FhvT4HostProbePhase = "DEPLOYMENT" | "POST_ROLLBACK";

export type FhvT4HostProbeLegacyV1 = Readonly<{
  name: string;
  image: string;
  running: boolean;
}>;

export type FhvT4HostProbeProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_HOST_PROBE_PROOF_SCHEMA_VERSION;
  hostProbePhase: FhvT4HostProbePhase;
  releaseSha: string;
  runId: string;
  organizationId: string;
  hostBootId: string | null;
  active: Readonly<Record<string, string>>;
  enabled: Readonly<Record<string, string>>;
  unitFiles: Readonly<Record<string, boolean>>;
  processes: readonly string[];
  legacy: FhvT4HostProbeLegacyV1;
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4HostProbeProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4HostProbeProofError";
  }
}

export function resolveFhvT4HostProbeProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_HOST_PROBE_PROOF_FILENAME);
}

export function resolveFhvT4PostRollbackHostProbeProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_POST_ROLLBACK_HOST_PROBE_PROOF_FILENAME);
}

export function resolveFhvT4HostProbeProofPathForPhase(
  runRoot: string,
  phase: FhvT4HostProbePhase,
): string {
  return phase === "POST_ROLLBACK"
    ? resolveFhvT4PostRollbackHostProbeProofPath(runRoot)
    : resolveFhvT4HostProbeProofPath(runRoot);
}

export function parseFhvT4RawHostProbeJson(raw: string): {
  active: Record<string, string>;
  enabled: Record<string, string>;
  unitFiles: Record<string, boolean>;
  processes: string[];
  legacy: FhvT4HostProbeLegacyV1 | null;
  hostBootId?: string | null;
} {
  const parsed = JSON.parse(raw) as {
    active?: Record<string, string>;
    enabled?: Record<string, string>;
    unitFiles?: Record<string, boolean>;
    processes?: string[];
    legacy?: FhvT4HostProbeLegacyV1 | null;
    hostBootId?: string | null;
  };
  if (!parsed.active || !parsed.enabled || !parsed.unitFiles || !Array.isArray(parsed.processes)) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_JSON_INVALID",
      "Host probe JSON missing required fields.",
    );
  }
  return {
    active: parsed.active,
    enabled: parsed.enabled,
    unitFiles: parsed.unitFiles,
    processes: parsed.processes,
    legacy: parsed.legacy ?? null,
    hostBootId: parsed.hostBootId ?? null,
  };
}

export function ingestFhvT4HostProbeProofAtomic(input: {
  runRoot: string;
  releaseSha: string;
  runId: string;
  organizationId: string;
  rawProbeJson: string;
  hostProbePhase?: FhvT4HostProbePhase;
  requireLegacyRunning?: boolean;
  capturedAtUtc?: string;
}): FhvT4HostProbeProofV1 {
  const hostProbePhase = input.hostProbePhase ?? "DEPLOYMENT";
  const probe = parseFhvT4RawHostProbeJson(input.rawProbeJson);
  if (
    !probe.legacy ||
    probe.legacy.name !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME ||
    probe.legacy.image !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE
  ) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_LEGACY_IDENTITY_INVALID",
      "Legacy container name/image must match exact contract identity.",
    );
  }
  if (input.requireLegacyRunning !== false && probe.legacy.running !== true) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_LEGACY_NOT_RUNNING",
      "Legacy container must be observed running.",
    );
  }
  const withoutDigest = {
    schemaVersion: FHV_T4_HOST_PROBE_PROOF_SCHEMA_VERSION,
    hostProbePhase,
    releaseSha: input.releaseSha,
    runId: input.runId,
    organizationId: input.organizationId,
    hostBootId: probe.hostBootId ?? null,
    active: probe.active,
    enabled: probe.enabled,
    unitFiles: probe.unitFiles,
    processes: probe.processes,
    legacy: {
      name: probe.legacy.name,
      image: probe.legacy.image,
      running: probe.legacy.running,
    },
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
  };
  const proof: FhvT4HostProbeProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(
    resolveFhvT4HostProbeProofPathForPhase(input.runRoot, hostProbePhase),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  return proof;
}

export function readFhvT4HostProbeProof(
  runRoot: string,
  phase: FhvT4HostProbePhase = "DEPLOYMENT",
): FhvT4HostProbeProofV1 | null {
  const path = resolveFhvT4HostProbeProofPathForPhase(runRoot, phase);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4HostProbeProofV1;
}

export function readFhvT4PostRollbackHostProbeProof(runRoot: string): FhvT4HostProbeProofV1 | null {
  return readFhvT4HostProbeProof(runRoot, "POST_ROLLBACK");
}

export function verifyFhvT4HostProbeProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  runId: string;
  organizationId: string;
  hostProbePhase?: FhvT4HostProbePhase;
  requireLegacyRunning?: boolean;
}): FhvT4HostProbeProofV1 {
  const hostProbePhase = input.hostProbePhase ?? "DEPLOYMENT";
  const proof = readFhvT4HostProbeProof(input.runRoot, hostProbePhase);
  if (!proof) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_PROOF_MISSING",
      "Host probe proof is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_PROOF_DIGEST_MISMATCH",
      "Host probe proof contentDigest mismatch.",
    );
  }
  if (proof.hostProbePhase !== hostProbePhase) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_PROOF_PHASE_MISMATCH",
      "Host probe proof phase mismatch.",
    );
  }
  if (
    proof.releaseSha !== input.targetSha ||
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId
  ) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_PROOF_IDENTITY_MISMATCH",
      "Host probe proof identity mismatch.",
    );
  }
  if (
    proof.legacy.name !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME ||
    proof.legacy.image !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE
  ) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_PROOF_LEGACY_IDENTITY_INVALID",
      "Host probe proof legacy identity invalid.",
    );
  }
  if (input.requireLegacyRunning !== false && proof.legacy.running !== true) {
    throw new FhvT4HostProbeProofError(
      "FHV_T4_HOST_PROBE_PROOF_LEGACY_NOT_RUNNING",
      "Host probe proof legacy container is not running.",
    );
  }
  return proof;
}
