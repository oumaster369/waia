export const MI_TRIAL_INTEGRITY_SCHEMA_VERSION = "mi-trial-integrity-v1" as const;

export type MiTrialIntegritySchemaVersion = typeof MI_TRIAL_INTEGRITY_SCHEMA_VERSION;

export const miTrialIntegrityEventTypeValues = ["invalidated", "reinstated"] as const;

export type MiTrialIntegrityEventType = (typeof miTrialIntegrityEventTypeValues)[number];

export const miTrialIntegrityReasonCodeValues = [
  "look_ahead_contamination",
  "pre_registration_breach",
  "computation_defect",
  "provenance_gap",
] as const;

export type MiTrialIntegrityReasonCode = (typeof miTrialIntegrityReasonCodeValues)[number];

export const miTrialIntegrityStatusValues = ["valid", "invalidated"] as const;

export type MiTrialIntegrityStatus = (typeof miTrialIntegrityStatusValues)[number];

/** Append-only Trial Integrity event (DEE-291 / LD-5a.2c). */
export type MiTrialIntegrityEvent = {
  id: string;
  organizationId: string;
  trialId: string;
  eventType: MiTrialIntegrityEventType;
  reasonCode: MiTrialIntegrityReasonCode | null;
  rationale: string;
  causeRef: string | null;
  schemaVersion: MiTrialIntegritySchemaVersion;
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  createdAt: Date;
};

/** Derived integrity read-model (latest-transition-wins fold). */
export type MiTrialIntegrityState = {
  status: MiTrialIntegrityStatus;
  reasonCode: MiTrialIntegrityReasonCode | null;
  since: Date | null;
  latestEventId: string | null;
};

/** MVP write input — invalidates a trial in-org. */
export type InvalidateTrialInput = {
  trialId: string;
  reasonCode: MiTrialIntegrityReasonCode;
  rationale: string;
  causeRef?: string | null;
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
};

export function deriveTrialIntegrityState(
  events: readonly MiTrialIntegrityEvent[],
): MiTrialIntegrityState {
  if (events.length === 0) {
    return {
      status: "valid",
      reasonCode: null,
      since: null,
      latestEventId: null,
    };
  }

  const latest = events[events.length - 1]!;

  if (latest.eventType === "invalidated") {
    return {
      status: "invalidated",
      reasonCode: latest.reasonCode,
      since: latest.eventTime,
      latestEventId: latest.id,
    };
  }

  // Reserved for future `reinstated` — latest transition into valid.
  return {
    status: "valid",
    reasonCode: null,
    since: latest.eventTime,
    latestEventId: latest.id,
  };
}

export function isMiTrialIntegrityReasonCode(value: string): value is MiTrialIntegrityReasonCode {
  return (miTrialIntegrityReasonCodeValues as readonly string[]).includes(value);
}

export function isMiTrialIntegrityEventType(value: string): value is MiTrialIntegrityEventType {
  return (miTrialIntegrityEventTypeValues as readonly string[]).includes(value);
}
