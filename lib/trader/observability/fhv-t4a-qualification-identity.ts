/**
 * DEE-436 — strict observer qualification identity validation (F-09).
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

const OBSERVER_UNIT = "waia-fhv-observer.service";

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

export function assertFhvT4aQualificationIdentityCapture(
  capture: FhvT4ObserverQualificationIdentityCapture,
  label: string,
): void {
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
  bootId: string;
  unitName: string;
}): void {
  assertFhvT4aQualificationIdentityCapture(input.before, "before");
  assertFhvT4aQualificationIdentityCapture(input.after, "after");
  const normalizedBootId = normalizeFhvT4BootId(input.bootId);
  if (input.unitName.trim() !== OBSERVER_UNIT) {
    throw new FhvT4aQualificationIdentityError(
      "FHV_T4_OBSERVER_QUALIFICATION_UNIT_MISMATCH",
      "Observer unit must be waia-fhv-observer.service.",
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
  try {
    normalizeFhvT4BootId(input.bootId);
  } catch {
    throw new FhvT4aQualificationIdentityError(
      "QUALIFICATION_BOOT_ID_INTERNAL_MISMATCH",
      "Proof bootId invalid.",
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
