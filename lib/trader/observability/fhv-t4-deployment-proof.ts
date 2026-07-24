/**
 * DEE-436 — immutable pre-rollback deployment proof artifact.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
  FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

export const FHV_T4_DEPLOYMENT_PROOF_SCHEMA_VERSION = "fhv-t4-deployment-proof/v1" as const;
export const FHV_T4_DEPLOYMENT_PROOF_FILENAME = "fhv-t4-deployment-proof.v1.json" as const;

export type FhvT4DeploymentProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_DEPLOYMENT_PROOF_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  serviceUser: string;
  workingDirectory: string;
  environmentFile: string;
  renderedUnitDigests: Readonly<Record<string, string>>;
  installedUnitDigests: Readonly<Record<string, string>>;
  deploymentRecordDigest: string;
  legacyContainerName: typeof FHV_SYSTEMD_LEGACY_CONTAINER_NAME;
  legacyContainerImage: typeof FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE;
  legacyContainerRunning: true;
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4DeploymentProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4DeploymentProofError";
  }
}

export function resolveFhvT4DeploymentProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_DEPLOYMENT_PROOF_FILENAME);
}

export function writeFhvT4DeploymentProofAtomic(
  runRoot: string,
  input: Omit<FhvT4DeploymentProofV1, "schemaVersion" | "contentDigest">,
): FhvT4DeploymentProofV1 {
  const withoutDigest = {
    schemaVersion: FHV_T4_DEPLOYMENT_PROOF_SCHEMA_VERSION,
    ...input,
  };
  const record: FhvT4DeploymentProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(resolveFhvT4DeploymentProofPath(runRoot), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function readFhvT4DeploymentProof(runRoot: string): FhvT4DeploymentProofV1 | null {
  const path = resolveFhvT4DeploymentProofPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4DeploymentProofV1;
}

export function verifyFhvT4DeploymentProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
}): FhvT4DeploymentProofV1 {
  const proof = readFhvT4DeploymentProof(input.runRoot);
  if (!proof) {
    throw new FhvT4DeploymentProofError(
      "FHV_T4_DEPLOYMENT_PROOF_MISSING",
      "Deployment proof artifact is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4DeploymentProofError(
      "FHV_T4_DEPLOYMENT_PROOF_DIGEST_MISMATCH",
      "Deployment proof contentDigest mismatch.",
    );
  }
  if (
    proof.releaseSha !== input.targetSha ||
    proof.releaseTag !== input.releaseTag ||
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId
  ) {
    throw new FhvT4DeploymentProofError(
      "FHV_T4_DEPLOYMENT_PROOF_IDENTITY_MISMATCH",
      "Deployment proof identity mismatch.",
    );
  }
  for (const unit of [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT]) {
    const rendered = proof.renderedUnitDigests[unit];
    const installed = proof.installedUnitDigests[unit];
    if (!rendered || !installed || rendered !== installed) {
      throw new FhvT4DeploymentProofError(
        "FHV_T4_DEPLOYMENT_PROOF_UNIT_DIGEST_MISMATCH",
        `Rendered/installed digest mismatch for ${unit}.`,
      );
    }
  }
  if (
    proof.legacyContainerName !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME ||
    proof.legacyContainerImage !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE ||
    proof.legacyContainerRunning !== true
  ) {
    throw new FhvT4DeploymentProofError(
      "FHV_T4_DEPLOYMENT_PROOF_LEGACY_CONTAINER_INVALID",
      "Legacy container fields invalid in deployment proof.",
    );
  }
  return proof;
}
