/**
 * DEE-436 — immutable post-rollback proof artifact.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
  FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import type { FhvT4HostProbe } from "@/lib/trader/observability/fhv-t4-closure-verifiers";

export const FHV_T4_ROLLBACK_PROOF_SCHEMA_VERSION = "fhv-t4-rollback-proof/v1" as const;
export const FHV_T4_ROLLBACK_PROOF_FILENAME = "fhv-t4-rollback-proof.v1.json" as const;

export type FhvT4RollbackProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_ROLLBACK_PROOF_SCHEMA_VERSION;
  releaseSha: string;
  runId: string;
  organizationId: string;
  unitActiveStates: Readonly<Record<string, string>>;
  unitEnabledStates: Readonly<Record<string, string>>;
  unitFilesPresent: Readonly<Record<string, boolean>>;
  residualProcesses: readonly string[];
  legacyContainerName: typeof FHV_SYSTEMD_LEGACY_CONTAINER_NAME;
  legacyContainerImage: typeof FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE;
  legacyContainerRunning: true;
  deploymentRecordDigest: string;
  postRollbackHostProbeDigest: string;
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4RollbackProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4RollbackProofError";
  }
}

export function resolveFhvT4RollbackProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_ROLLBACK_PROOF_FILENAME);
}

export function captureFhvT4RollbackProofFromHost(input: {
  targetSha: string;
  runId: string;
  organizationId: string;
  deploymentRecordDigest: string;
  postRollbackHostProbeDigest: string;
  host: FhvT4HostProbe;
  capturedAtUtc?: string;
}): Omit<FhvT4RollbackProofV1, "schemaVersion" | "contentDigest"> {
  const units = [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT] as const;
  const unitActiveStates: Record<string, string> = {};
  const unitEnabledStates: Record<string, string> = {};
  const unitFilesPresent: Record<string, boolean> = {};
  for (const unit of units) {
    unitActiveStates[unit] = input.host.systemctlIsActive(unit).state;
    unitEnabledStates[unit] = input.host.systemctlIsEnabled(unit).state;
    unitFilesPresent[unit] = input.host.unitFileExists(unit);
  }
  const residualProcesses = [
    ...input.host.listMatchingProcesses("fhv-campaign-cli"),
    ...input.host.listMatchingProcesses("fhv-observer-cli"),
    ...input.host.listMatchingProcesses("waia-fhv-campaign"),
    ...input.host.listMatchingProcesses("waia-fhv-observer"),
  ];
  const legacy = input.host.inspectLegacyContainer();
  if (
    !legacy ||
    legacy.name !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME ||
    legacy.image !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE ||
    legacy.running !== true
  ) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_LEGACY_CONTAINER_INVALID",
      "Legacy container must be exact and running when capturing rollback proof.",
    );
  }
  return {
    releaseSha: input.targetSha,
    runId: input.runId,
    organizationId: input.organizationId,
    unitActiveStates,
    unitEnabledStates,
    unitFilesPresent,
    residualProcesses,
    legacyContainerName: FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
    legacyContainerImage: FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
    legacyContainerRunning: true,
    deploymentRecordDigest: input.deploymentRecordDigest,
    postRollbackHostProbeDigest: input.postRollbackHostProbeDigest,
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
  };
}

export function writeFhvT4RollbackProofAtomic(
  runRoot: string,
  input: Omit<FhvT4RollbackProofV1, "schemaVersion" | "contentDigest">,
): FhvT4RollbackProofV1 {
  const withoutDigest = {
    schemaVersion: FHV_T4_ROLLBACK_PROOF_SCHEMA_VERSION,
    ...input,
  };
  const record: FhvT4RollbackProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomicExclusive(
    resolveFhvT4RollbackProofPath(runRoot),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

export function readFhvT4RollbackProof(runRoot: string): FhvT4RollbackProofV1 | null {
  const path = resolveFhvT4RollbackProofPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4RollbackProofV1;
}

export function verifyFhvT4RollbackProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  runId: string;
  organizationId: string;
  deploymentProof: { contentDigest: string; deploymentRecordDigest: string; capturedAtUtc: string };
}): FhvT4RollbackProofV1 {
  const proof = readFhvT4RollbackProof(input.runRoot);
  if (!proof) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_MISSING",
      "Rollback proof artifact is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_DIGEST_MISMATCH",
      "Rollback proof contentDigest mismatch.",
    );
  }
  if (
    proof.releaseSha !== input.targetSha ||
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId
  ) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_IDENTITY_MISMATCH",
      "Rollback proof identity mismatch.",
    );
  }
  if (proof.deploymentRecordDigest !== input.deploymentProof.deploymentRecordDigest) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_DEPLOYMENT_RECORD_DIGEST_MISMATCH",
      "Rollback proof must preserve deployment record digest.",
    );
  }
  if (
    new Date(proof.capturedAtUtc).getTime() <
    new Date(input.deploymentProof.capturedAtUtc).getTime()
  ) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_ORDERING_INVALID",
      "Rollback proof must be captured after deployment proof.",
    );
  }
  for (const unit of [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT]) {
    const active = proof.unitActiveStates[unit];
    const enabled = proof.unitEnabledStates[unit];
    if (!["inactive", "not-found"].includes(active ?? "")) {
      throw new FhvT4RollbackProofError(
        "FHV_T4_ROLLBACK_PROOF_UNIT_ACTIVE",
        `Unit ${unit} must be inactive/not-found after rollback.`,
      );
    }
    if (!["disabled", "not-found"].includes(enabled ?? "")) {
      throw new FhvT4RollbackProofError(
        "FHV_T4_ROLLBACK_PROOF_UNIT_ENABLED",
        "Unit enabled state invalid after rollback.",
      );
    }
    if (proof.unitFilesPresent[unit] === true) {
      throw new FhvT4RollbackProofError(
        "FHV_T4_ROLLBACK_PROOF_UNIT_FILE_PRESENT",
        `Unit file must be absent for ${unit}.`,
      );
    }
  }
  if (proof.residualProcesses.length > 0) {
    throw new FhvT4RollbackProofError(
      "FHV_T4_ROLLBACK_PROOF_RESIDUAL_PROCESS",
      "Residual processes must be absent in rollback proof.",
    );
  }
  return proof;
}
