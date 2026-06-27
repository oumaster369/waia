import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_EVIDENCE_SCHEMA_VERSION,
  type MiEvidenceDirection,
  type MiEvidenceKind,
  type MiEvidenceMeasurementRef,
  type MiEvidenceObservationRef,
  type MiEvidenceSchemaVersion,
} from "@/lib/trader/mi/evidence.types";

export type EvidenceContentDigestInput = {
  organizationId: string;
  evidenceKind: MiEvidenceKind;
  direction: MiEvidenceDirection;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  measurementRefs: readonly MiEvidenceMeasurementRef[];
  observationRefs: readonly MiEvidenceObservationRef[];
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
  nullComparatorRef: string | null;
  regimeContextRef: string | null;
  trialRegistrationRef: string | null;
};

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

function sortMeasurementRefs(
  refs: readonly MiEvidenceMeasurementRef[],
): MiEvidenceMeasurementRef[] {
  return [...refs].sort((a, b) => {
    const keyCmp = a.measurementKey.localeCompare(b.measurementKey);
    if (keyCmp !== 0) return keyCmp;
    return a.measurementDefinitionDigest.localeCompare(b.measurementDefinitionDigest);
  });
}

function sortObservationRefs(
  refs: readonly MiEvidenceObservationRef[],
): MiEvidenceObservationRef[] {
  return [...refs].sort((a, b) => a.observationId.localeCompare(b.observationId));
}

export function canonicalizeEvidenceContentDigestInput(
  input: EvidenceContentDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: MI_EVIDENCE_SCHEMA_VERSION satisfies MiEvidenceSchemaVersion,
    organizationId: input.organizationId,
    evidenceKind: input.evidenceKind,
    direction: input.direction,
    hypothesisKey: input.hypothesisKey,
    hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
    measurementRefs: sortMeasurementRefs(input.measurementRefs),
    observationRefs: sortObservationRefs(input.observationRefs),
    eventTime: input.eventTime.toISOString(),
    ingestTime: input.ingestTime.toISOString(),
    recordedBy: input.recordedBy,
    nullComparatorRef: input.nullComparatorRef,
    regimeContextRef: input.regimeContextRef,
    trialRegistrationRef: input.trialRegistrationRef,
  }) as Record<string, unknown>;
}

/** Pure fact fingerprint — `seq` is intentionally excluded (R2). */
export function buildEvidenceContentDigest(input: EvidenceContentDigestInput): string {
  const canonical = canonicalizeEvidenceContentDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function serializeMeasurementRefsJson(refs: readonly MiEvidenceMeasurementRef[]): string {
  return JSON.stringify(sortMeasurementRefs(refs));
}

export function serializeObservationRefsJson(refs: readonly MiEvidenceObservationRef[]): string {
  return JSON.stringify(sortObservationRefs(refs));
}
