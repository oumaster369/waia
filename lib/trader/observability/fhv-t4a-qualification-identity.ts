/**
 * DEE-436 — strict observer qualification identity validation (F-09 / Q-01).
 */

import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";
import {
  parseFhvT4ObserverSystemdIdentity,
  type FhvT4ObserverSystemdIdentityV1,
} from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";
import type { FhvT4ObserverQualificationIdentityCapture } from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";

export class FhvT4aQualificationIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aQualificationIdentityError";
  }
}

export const FHV_T4A_OBSERVER_QUALIFICATION_UNIT = "waia-fhv-observer.service";

export function parseFhvT4aQualificationObserverIdentity(
  raw: unknown,
): FhvT4ObserverSystemdIdentityV1 {
  try {
    return parseFhvT4ObserverSystemdIdentity(raw);
  } catch (error) {
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_IDENTITY_NOT_CANONICALLY_PARSED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function projectFhvT4ObserverQualificationIdentityCapture(
  identity: FhvT4ObserverSystemdIdentityV1,
): FhvT4ObserverQualificationIdentityCapture {
  return {
    unitName: identity.unitName,
    bootId: normalizeFhvT4BootId(identity.bootId),
    invocationId: identity.invocationId,
    mainPid: identity.mainPid,
    activeEnterTimestampMonotonicUs: identity.activeEnterTimestampMonotonicUs,
    activeState: identity.activeState,
  };
}

function assertCaptureBootIdMatchesProof(
  capture: FhvT4ObserverQualificationIdentityCapture,
  proofBootId: string,
  label: string,
): void {
  try {
    const normalizedCaptureBootId = normalizeFhvT4BootId(capture.bootId);
    const normalizedProofBootId = normalizeFhvT4BootId(proofBootId);
    if (normalizedCaptureBootId !== normalizedProofBootId) {
      throw new FhvT4aQualificationIdentityError(
        "QUALIFICATION_PROOF_BOOT_ID_CAPTURE_MISMATCH",
        `${label} capture bootId must equal proof bootId.`,
      );
    }
  } catch (error) {
    if (error instanceof FhvT4aQualificationIdentityError) {
      throw error;
    }
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH",
      `${label} capture bootId invalid.`,
    );
  }
}

export function assertFhvT4aQualificationIdentityCapture(
  capture: FhvT4ObserverQualificationIdentityCapture,
  label: string,
  proofBootId?: string,
): void {
  if (!capture.unitName.trim()) {
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_CAPTURE_UNIT_NAME_NOT_PERSISTED",
      `${label} capture unitName required.`,
    );
  }
  if (!capture.bootId.trim()) {
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_CAPTURE_BOOT_ID_NOT_PERSISTED",
      `${label} capture bootId required.`,
    );
  }
  if (capture.unitName.trim() !== FHV_T4A_OBSERVER_QUALIFICATION_UNIT) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_UNIT_MISMATCH",
      `${label} capture unit must be ${FHV_T4A_OBSERVER_QUALIFICATION_UNIT}.`,
    );
  }
  if (proofBootId !== undefined) {
    assertCaptureBootIdMatchesProof(capture, proofBootId, label);
  }
  if (capture.activeState !== "active") {
    throw new FhvT4aQualificationIdentityError(
      label === "after"
        ? "QUALIFICATION_SECOND_CAPTURE_NOT_ACTIVE"
        : "FHV_T4_OBSERVER_QUALIFICATION_NOT_ACTIVE",
      `${label} capture must be active.`,
    );
  }
  if (!capture.invocationId.trim()) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_REQUIRED",
      `${label} capture invocationId required.`,
    );
  }
  if (!Number.isInteger(capture.mainPid) || capture.mainPid <= 0) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_MAIN_PID_INVALID",
      `${label} capture mainPid must be positive.`,
    );
  }
  if (!capture.activeEnterTimestampMonotonicUs.trim()) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_ACTIVE_ENTER_REQUIRED",
      `${label} capture activeEnterTimestampMonotonicUs required.`,
    );
  }
}

export function assertFhvT4aQualificationIdentityStability(input: {
  before: FhvT4ObserverQualificationIdentityCapture;
  after: FhvT4ObserverQualificationIdentityCapture;
  proofBootId: string;
}): void {
  assertFhvT4aQualificationIdentityCapture(input.before, "before", input.proofBootId);
  assertFhvT4aQualificationIdentityCapture(input.after, "after", input.proofBootId);

  if (input.before.unitName.trim() !== input.after.unitName.trim()) {
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_CAPTURE_UNIT_MISMATCH",
      "Observer unitName drift between health and second capture.",
    );
  }

  try {
    const beforeBootId = normalizeFhvT4BootId(input.before.bootId);
    const afterBootId = normalizeFhvT4BootId(input.after.bootId);
    if (beforeBootId !== afterBootId) {
      throw new FhvT4aQualificationIdentityError(
        "QUALIFICATION_CAPTURE_BOOT_ID_MISMATCH",
        "Observer bootId drift between health and second capture.",
      );
    }
  } catch (error) {
    if (error instanceof FhvT4aQualificationIdentityError) {
      throw error;
    }
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH",
      "Observer capture bootId invalid.",
    );
  }

  if (input.before.invocationId !== input.after.invocationId) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_DRIFT",
      "Observer invocation drift between health and second capture.",
    );
  }
  if (input.before.mainPid !== input.after.mainPid) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_PID_DRIFT",
      "Observer MainPID drift between health and second capture.",
    );
  }
  if (
    input.before.activeEnterTimestampMonotonicUs !== input.after.activeEnterTimestampMonotonicUs
  ) {
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_ACTIVE_ENTER_TIMESTAMP_DRIFT",
      "Observer active-enter timestamp drift between captures.",
    );
  }
  if (input.before.activeState !== input.after.activeState) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_STATE_DRIFT",
      "Observer activeState drift between captures.",
    );
  }
}

export function assertFhvT4aPostRestartInvocationChanged(input: {
  preCampaignInvocationId: string;
  postRestartInvocationId: string;
}): void {
  if (input.preCampaignInvocationId === input.postRestartInvocationId) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_CEREMONY_OBSERVER_RESTART_NOT_PROVEN",
      "POST_RESTART invocation must differ from PRE_CAMPAIGN invocation.",
    );
  }
}
