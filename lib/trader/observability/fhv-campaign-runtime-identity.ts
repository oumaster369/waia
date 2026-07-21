import {
  readFhvRehearsalManifest,
  type FhvRehearsalLaunchConfigV1,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

export class FhvCampaignRuntimeIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvCampaignRuntimeIdentityError";
  }
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function assertFhvTargetSha(targetSha: string | undefined): string {
  const normalized = targetSha?.trim();
  if (!normalized) {
    throw new FhvCampaignRuntimeIdentityError(
      "FHV_TARGET_SHA_REQUIRED",
      "FHV_TARGET_SHA is required before campaign start.",
    );
  }
  if (normalized.length !== 40) {
    throw new FhvCampaignRuntimeIdentityError(
      "FHV_TARGET_SHA_INVALID_LENGTH",
      "FHV_TARGET_SHA must be a full 40-character git SHA.",
    );
  }
  if (normalized !== normalized.toLowerCase()) {
    throw new FhvCampaignRuntimeIdentityError(
      "FHV_TARGET_SHA_INVALID_CASE",
      "FHV_TARGET_SHA must be lowercase hex.",
    );
  }
  if (!FULL_SHA.test(normalized)) {
    throw new FhvCampaignRuntimeIdentityError(
      "FHV_TARGET_SHA_INVALID_FORMAT",
      "FHV_TARGET_SHA must be lowercase hex.",
    );
  }
  return normalized;
}

export function assertFhvCampaignRuntimeIdentity(input: {
  runRoot: string;
  targetSha: string | undefined;
  runId: string | undefined;
  organizationId: string | undefined;
}): FhvRehearsalLaunchConfigV1 {
  const targetSha = assertFhvTargetSha(input.targetSha);
  const runId = input.runId?.trim();
  const organizationId = input.organizationId?.trim();
  if (!runId) {
    throw new FhvCampaignRuntimeIdentityError("FHV_RUN_ID_REQUIRED", "FHV_RUN_ID is required.");
  }
  if (!organizationId) {
    throw new FhvCampaignRuntimeIdentityError(
      "FHV_ORGANIZATION_ID_REQUIRED",
      "FHV_ORGANIZATION_ID is required.",
    );
  }

  const manifest = readFhvRehearsalManifest(input.runRoot);
  if (manifest.targetSha !== targetSha) {
    throw new FhvCampaignRuntimeIdentityError(
      "MANIFEST_TARGET_SHA_MISMATCH",
      "Rehearsal manifest targetSha does not match FHV_TARGET_SHA.",
    );
  }
  if (manifest.runId !== runId) {
    throw new FhvCampaignRuntimeIdentityError(
      "MANIFEST_RUN_ID_MISMATCH",
      "Rehearsal manifest runId does not match FHV_RUN_ID.",
    );
  }
  if (manifest.organizationId !== organizationId) {
    throw new FhvCampaignRuntimeIdentityError(
      "MANIFEST_ORGANIZATION_ID_MISMATCH",
      "Rehearsal manifest organizationId does not match FHV_ORGANIZATION_ID.",
    );
  }
  return manifest;
}
