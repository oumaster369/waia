import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_MEASUREMENT_SCHEMA_VERSION,
  type MeasurementDefinition,
  type MiMeasurementKind,
  type MiMeasurementSchemaVersion,
} from "@/lib/trader/mi/measurement.types";

export type MeasurementKeyInput = {
  organizationId: string;
  measurementKind: MiMeasurementKind;
  name: string;
};

export type MeasurementDigestInput = {
  schemaVersion: MiMeasurementSchemaVersion;
  organizationId: string;
  measurementKey: string;
  measurementKind: MiMeasurementKind;
  name: string;
  definitionCanonical: Record<string, unknown>;
};

/** Fixed precision for normalizing numeric definition parameters before hashing (M3). */
const MEASUREMENT_PARAM_PRECISION = 8;

function normalizeNumbersDeep(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("[trader] measurement definition contains a non-finite numeric parameter");
    }
    return value.toFixed(MEASUREMENT_PARAM_PRECISION);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNumbersDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, normalizeNumbersDeep(record[key])]),
    );
  }
  return value;
}

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

/** Canonical, numeric-normalized form of a transform definition (M3). */
export function buildDefinitionCanonical(
  definition: MeasurementDefinition,
): Record<string, unknown> {
  return normalizeNumbersDeep(definition) as Record<string, unknown>;
}

export function serializeMeasurementDefinitionJson(definition: MeasurementDefinition): string {
  return JSON.stringify(definition);
}

export function parseMeasurementDefinitionJson(definitionJson: string): MeasurementDefinition {
  return JSON.parse(definitionJson) as MeasurementDefinition;
}

export function canonicalizeMeasurementKeyInput(
  input: MeasurementKeyInput,
): Record<string, unknown> {
  return sortKeysDeep({
    organizationId: input.organizationId,
    measurementKind: input.measurementKind,
    name: input.name,
  }) as Record<string, unknown>;
}

/** Deterministic logical family key, stable across versions (M2). */
export function computeMeasurementKey(input: MeasurementKeyInput): string {
  const canonical = canonicalizeMeasurementKeyInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function canonicalizeMeasurementDigestInput(
  input: MeasurementDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    measurementKey: input.measurementKey,
    measurementKind: input.measurementKind,
    name: input.name,
    definitionCanonical: input.definitionCanonical,
  }) as Record<string, unknown>;
}

/** Reproducible content fingerprint of a versioned definition (M3). */
export function computeMeasurementDigest(input: MeasurementDigestInput): string {
  const canonical = canonicalizeMeasurementDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildMeasurementDigestInput(
  input: Omit<MeasurementDigestInput, "schemaVersion">,
): MeasurementDigestInput {
  return {
    ...input,
    schemaVersion: MI_MEASUREMENT_SCHEMA_VERSION,
  };
}

export function buildMeasurementDigestFromDefinition(input: {
  organizationId: string;
  measurementKey: string;
  measurementKind: MiMeasurementKind;
  name: string;
  definition: MeasurementDefinition;
}): string {
  return computeMeasurementDigest(
    buildMeasurementDigestInput({
      organizationId: input.organizationId,
      measurementKey: input.measurementKey,
      measurementKind: input.measurementKind,
      name: input.name,
      definitionCanonical: buildDefinitionCanonical(input.definition),
    }),
  );
}
