import { createHash } from "node:crypto";

import type { MsvEnvelope } from "@/lib/trader/intelligence/types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_OBSERVATION_SCHEMA_VERSION,
  type MiObservationKind,
  type MiObservationSchemaVersion,
} from "@/lib/trader/mi/observation.types";

export type ObservationKeyInput = {
  organizationId: string;
  sourceId: string;
  observationKind: MiObservationKind;
  subjectRef: string;
  eventTime: Date;
};

export type ObservationDigestInput = {
  schemaVersion: MiObservationSchemaVersion;
  organizationId: string;
  sourceId: string;
  observationKey: string;
  observationKind: MiObservationKind;
  subjectRef: string;
  eventTime: Date;
  payloadCanonical: Record<string, unknown>;
};

const DATA_QUALITY_SCORE_PRECISION = 4;

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

function toUtcIsoMs(date: Date): string {
  return date.toISOString();
}

export function normalizeDataQualityScore(score: number): string {
  return score.toFixed(DATA_QUALITY_SCORE_PRECISION);
}

export function buildMsvPayloadCanonical(msv: MsvEnvelope): Record<string, unknown> {
  const payload = {
    instrumentId: msv.instrumentId,
    evaluatedAt: msv.evaluatedAt,
    physics: msv.physics,
    liquidity: msv.liquidity,
    crowd: msv.crowd,
    futureContext: msv.futureContext,
    derived: {
      ...msv.derived,
      dataQualityScore: normalizeDataQualityScore(msv.derived.dataQualityScore),
    },
  };
  return sortKeysDeep(payload) as Record<string, unknown>;
}

export function serializeMsvPayloadJson(msv: MsvEnvelope): string {
  return JSON.stringify(msv);
}

export function parseMsvPayloadJson(payloadJson: string): MsvEnvelope {
  return JSON.parse(payloadJson) as MsvEnvelope;
}

export function canonicalizeObservationKeyInput(
  input: ObservationKeyInput,
): Record<string, unknown> {
  return sortKeysDeep({
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    observationKind: input.observationKind,
    subjectRef: input.subjectRef,
    eventTime: toUtcIsoMs(input.eventTime),
  }) as Record<string, unknown>;
}

export function computeObservationKey(input: ObservationKeyInput): string {
  const canonical = canonicalizeObservationKeyInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function canonicalizeObservationDigestInput(
  input: ObservationDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    observationKey: input.observationKey,
    observationKind: input.observationKind,
    subjectRef: input.subjectRef,
    eventTime: toUtcIsoMs(input.eventTime),
    payloadCanonical: input.payloadCanonical,
  }) as Record<string, unknown>;
}

export function computeObservationDigest(input: ObservationDigestInput): string {
  const canonical = canonicalizeObservationDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildObservationDigestInput(
  input: Omit<ObservationDigestInput, "schemaVersion">,
): ObservationDigestInput {
  return {
    ...input,
    schemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
  };
}

export function buildObservationDigestFromMsv(input: {
  organizationId: string;
  sourceId: string;
  observationKey: string;
  observationKind: MiObservationKind;
  subjectRef: string;
  eventTime: Date;
  msv: MsvEnvelope;
}): string {
  return computeObservationDigest(
    buildObservationDigestInput({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      observationKey: input.observationKey,
      observationKind: input.observationKind,
      subjectRef: input.subjectRef,
      eventTime: input.eventTime,
      payloadCanonical: buildMsvPayloadCanonical(input.msv),
    }),
  );
}
