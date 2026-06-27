export const MI_EVIDENCE_SCHEMA_VERSION = "mi-evidence-v1" as const;

export type MiEvidenceSchemaVersion = typeof MI_EVIDENCE_SCHEMA_VERSION;

export const miEvidenceDirectionValues = ["FOR", "AGAINST", "NEUTRAL"] as const;

export type MiEvidenceDirection = (typeof miEvidenceDirectionValues)[number];

/** LD-5b adds `null_comparator` via additive enum extension. */
export const miEvidenceKindValues = ["observed"] as const;

export type MiEvidenceKind = (typeof miEvidenceKindValues)[number];

/** Version-exact observation pin (LD-5a.2a / R1). */
export type MiEvidenceObservationRef = {
  observationId: string;
};

/** Version-exact measurement pin (same contract as hypothesis measurementRefs). */
export type MiEvidenceMeasurementRef = {
  measurementKey: string;
  measurementDefinitionDigest: string;
};

/**
 * Append-only Evidence record (DEE-289 / LD-5a.2a).
 * Typed link only — no free-form payload; measured values live in pinned observations.
 */
export type MiEvidence = {
  id: string;
  organizationId: string;
  evidenceKind: MiEvidenceKind;
  direction: MiEvidenceDirection;
  hypothesisId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  measurementRefsJson: string;
  observationRefsJson: string;
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  nullComparatorRef: string | null;
  regimeContextRef: string | null;
  trialRegistrationRef: string | null;
  createdAt: Date;
};

/**
 * Closed typed input — no free-form payload.
 *
 * `nullComparatorRef` / `regimeContextRef` remain reserved (always NULL until LD-5b/5c).
 * `trialRegistrationRef` is accepted from LD-5a.2b: an optional version-exact link to an
 * in-org Trial Registration (validated + enforced by composite FK / guard trigger).
 */
export type RecordEvidenceInput = {
  evidenceKind?: MiEvidenceKind;
  direction: MiEvidenceDirection;
  hypothesisId: string;
  hypothesisDefinitionDigest: string;
  measurementRefs: readonly MiEvidenceMeasurementRef[];
  observationRefs: readonly MiEvidenceObservationRef[];
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
  trialRegistrationRef?: string | null;
};

export type MiEvidenceSummary = {
  forCount: number;
  againstCount: number;
  neutralCount: number;
  latestSeq: number | null;
};
