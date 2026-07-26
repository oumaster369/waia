/**
 * DEE-436 — ceremony semantic verification of observer qualification proofs.
 */

import { readFileSync } from "node:fs";

import { parseFhvT4ContinuitySnapshot } from "@/lib/trader/observability/fhv-t4-continuity-capture";
import { assertFhvT4BootIdEqual } from "@/lib/trader/observability/fhv-t4-boot-id";
import {
  parseFhvT4ObserverQualificationProof,
  readFhvT4ObserverQualificationProofFromFile,
  resolveFhvT4ObserverQualificationPostRestartPath,
  resolveFhvT4ObserverQualificationPreCampaignPath,
  type FhvT4ObserverQualificationProofV1,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import { FhvT4CeremonyQualificationError } from "@/lib/trader/observability/fhv-t4a-ceremony-qualification-errors";

export function verifyFhvT4CeremonyQualificationProofs(input: {
  runRoot: string;
  targetSha: string;
  runId: string;
  organizationId: string;
  continuityBeforePath: string;
  continuityAfterPath: string;
}): {
  preProof: FhvT4ObserverQualificationProofV1;
  postProof: FhvT4ObserverQualificationProofV1;
} {
  const prePath = resolveFhvT4ObserverQualificationPreCampaignPath(input.runRoot);
  const postPath = resolveFhvT4ObserverQualificationPostRestartPath(input.runRoot);
  let preProof: FhvT4ObserverQualificationProofV1;
  let postProof: FhvT4ObserverQualificationProofV1;
  try {
    preProof = readFhvT4ObserverQualificationProofFromFile(prePath);
    postProof = readFhvT4ObserverQualificationProofFromFile(postPath);
  } catch (error) {
    throw new FhvT4CeremonyQualificationError(
      "OBSERVER_QUALIFICATION_NOT_SEMANTICALLY_VERIFIED_BY_CEREMONY",
      error instanceof Error ? error.message : String(error),
    );
  }

  for (const proof of [preProof, postProof]) {
    if (proof.runId !== input.runId || proof.organizationId !== input.organizationId) {
      throw new FhvT4CeremonyQualificationError(
        "FHV_T4_CEREMONY_QUALIFICATION_IDENTITY_MISMATCH",
        "Qualification proof run identity mismatch.",
      );
    }
    if (proof.targetSha !== input.targetSha.trim().toLowerCase()) {
      throw new FhvT4CeremonyQualificationError(
        "FHV_T4_CEREMONY_QUALIFICATION_TARGET_SHA_MISMATCH",
        "Qualification proof targetSha mismatch.",
      );
    }
    if (!proof.bootId.trim()) {
      throw new FhvT4CeremonyQualificationError(
        "FHV_T4_CEREMONY_QUALIFICATION_BOOT_ID_MISSING",
        "Qualification proof bootId missing.",
      );
    }
    if (!proof.unitName.trim()) {
      throw new FhvT4CeremonyQualificationError(
        "FHV_T4_CEREMONY_QUALIFICATION_UNIT_MISSING",
        "Qualification proof unitName missing.",
      );
    }
    if (!proof.statusDigest.trim()) {
      throw new FhvT4CeremonyQualificationError(
        "FHV_T4_CEREMONY_QUALIFICATION_STATUS_DIGEST_MISSING",
        "Qualification proof statusDigest missing.",
      );
    }
  }

  if (preProof.phase !== "PRE_CAMPAIGN") {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_QUALIFICATION_PRE_PHASE_INVALID",
      "Pre proof must be PRE_CAMPAIGN.",
    );
  }
  if (postProof.phase !== "POST_RESTART") {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_QUALIFICATION_POST_PHASE_INVALID",
      "Post proof must be POST_RESTART.",
    );
  }

  const before = parseFhvT4ContinuitySnapshot(
    JSON.parse(readFileSync(input.continuityBeforePath, "utf8")) as unknown,
  );
  const after = parseFhvT4ContinuitySnapshot(
    JSON.parse(readFileSync(input.continuityAfterPath, "utf8")) as unknown,
  );

  try {
    assertFhvT4BootIdEqual(preProof.bootId, postProof.bootId);
  } catch {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_QUALIFICATION_BOOT_ID_CHANGED",
      "Host boot ID must remain unchanged across restart.",
    );
  }

  try {
    assertFhvT4BootIdEqual(preProof.bootId, before.observerSystemdIdentity.bootId);
    assertFhvT4BootIdEqual(postProof.bootId, after.observerSystemdIdentity.bootId);
  } catch {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_QUALIFICATION_BOOT_ID_CONTINUITY_MISMATCH",
      "Qualification proof bootId must match continuity snapshots.",
    );
  }

  if (postProof.identityBeforeCapture.invocationId === preProof.identityAfterCapture.invocationId) {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_OBSERVER_RESTART_NOT_PROVEN",
      "Observer invocation must change after restart.",
    );
  }

  if (!postProof.completedCampaignIdentityDigest?.trim()) {
    throw new FhvT4CeremonyQualificationError(
      "POST_RESTART_CAMPAIGN_IDENTITY_NOT_IN_PROOF",
      "POST_RESTART proof missing completedCampaignIdentityDigest.",
    );
  }

  const campaignDigestBefore = before.campaignSystemdIdentity.contentDigest;
  const campaignDigestAfter = after.campaignSystemdIdentity.contentDigest;
  if (postProof.completedCampaignIdentityDigest !== campaignDigestBefore) {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_CAMPAIGN_IDENTITY_CHANGED",
      "Completed campaign identity must match continuity-before.",
    );
  }
  if (campaignDigestBefore !== campaignDigestAfter) {
    throw new FhvT4CeremonyQualificationError(
      "FHV_T4_CEREMONY_CAMPAIGN_IDENTITY_CHANGED",
      "Completed campaign identity must match continuity-after.",
    );
  }

  return { preProof, postProof };
}
