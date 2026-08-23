import { createHash } from "node:crypto";

import {
  CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  DOWNSTREAM_MEASUREMENT_CATEGORIES_V1,
  type CanonicalPrimitiveObservationKindV1,
  type DownstreamMeasurementCategoryV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export const CANONICAL_MEASUREMENT_DEFINITION_V1_SCHEMA_VERSION =
  "canonical-measurement-definition-v1" as const;
export const CANONICAL_MEASUREMENT_VALUE_LINEAGE_V1_SCHEMA_VERSION =
  "canonical-measurement-value-lineage-v1" as const;

export const CANONICAL_MEASUREMENT_CATEGORIES_V1 = [
  "feature_transform",
  ...DOWNSTREAM_MEASUREMENT_CATEGORIES_V1,
] as const;

export type CanonicalMeasurementCategoryV1 =
  | "feature_transform"
  | DownstreamMeasurementCategoryV1;

export type CanonicalMeasurementInputContractV1 = {
  observationKind: CanonicalPrimitiveObservationKindV1;
  observationSchemaVersion: typeof CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION;
};

export type CanonicalMeasurementDefinitionV1 = {
  id: string;
  schemaVersion: typeof CANONICAL_MEASUREMENT_DEFINITION_V1_SCHEMA_VERSION;
  organizationId: string;
  category: CanonicalMeasurementCategoryV1;
  name: string;
  inputContracts: CanonicalMeasurementInputContractV1[];
  outputSchemaVersion: string;
  authority: "INERT_DEFINITION_ONLY";
  contentDigest: string;
};

export type CanonicalMeasurementObservationLineageV1 = {
  observationId: string;
  observationKind: CanonicalPrimitiveObservationKindV1;
  observationSchemaVersion: typeof CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION;
  observationContentDigest: string;
  sourceId: string;
  trustAsOfReceiptId: string;
  trustRevisionId: string;
  trustRevisionContentDigest: string;
};

export type CanonicalMeasurementValueLineageV1 = {
  id: string;
  schemaVersion: typeof CANONICAL_MEASUREMENT_VALUE_LINEAGE_V1_SCHEMA_VERSION;
  organizationId: string;
  definitionId: string;
  definitionContentDigest: string;
  outputContentDigest: string;
  inputs: CanonicalMeasurementObservationLineageV1[];
  authority: "INERT_LINEAGE_ONLY";
  contentDigest: string;
};

const HEX_64 = /^[0-9a-f]{64}$/;

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`CANONICAL_MEASUREMENT_INVALID:${field}`);
  }
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!HEX_64.test(value)) {
    throw new Error(`CANONICAL_MEASUREMENT_INVALID:${field}`);
  }
  return value;
}

function canonicalInputContractKey(input: CanonicalMeasurementInputContractV1): string {
  return `${input.observationKind}:${input.observationSchemaVersion}`;
}

function canonicalLineageKey(input: CanonicalMeasurementObservationLineageV1): string {
  return [
    input.observationId,
    input.observationContentDigest,
    input.trustAsOfReceiptId,
    input.trustRevisionId,
    input.trustRevisionContentDigest,
  ].join(":");
}

export function defineCanonicalMeasurementV1(input: {
  organizationId: string;
  category: CanonicalMeasurementCategoryV1;
  name: string;
  inputContracts: readonly CanonicalMeasurementInputContractV1[];
  outputSchemaVersion: string;
}): CanonicalMeasurementDefinitionV1 {
  requireNonEmpty(input.organizationId, "organizationId");
  requireNonEmpty(input.name, "name");
  requireNonEmpty(input.outputSchemaVersion, "outputSchemaVersion");
  if (!(CANONICAL_MEASUREMENT_CATEGORIES_V1 as readonly string[]).includes(input.category)) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:category");
  }
  if (input.inputContracts.length === 0) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:inputContracts");
  }

  const inputContracts = [...input.inputContracts]
    .map((contract) => {
      if (
        !(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 as readonly string[]).includes(
          contract.observationKind,
        ) || contract.observationSchemaVersion !== CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION
      ) {
        throw new Error("CANONICAL_MEASUREMENT_INVALID:inputContract");
      }
      return { ...contract };
    })
    .sort((left, right) => canonicalInputContractKey(left).localeCompare(canonicalInputContractKey(right)));

  if (new Set(inputContracts.map(canonicalInputContractKey)).size !== inputContracts.length) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:duplicateInputContract");
  }

  const body = {
    schemaVersion: CANONICAL_MEASUREMENT_DEFINITION_V1_SCHEMA_VERSION,
    organizationId: input.organizationId,
    category: input.category,
    name: input.name,
    inputContracts,
    outputSchemaVersion: input.outputSchemaVersion,
    authority: "INERT_DEFINITION_ONLY" as const,
  };
  const contentDigest = sha256Canonical(body);
  return { ...body, id: contentDigest, contentDigest };
}

export function identifyCanonicalMeasurementValueV1(input: {
  organizationId: string;
  definition: CanonicalMeasurementDefinitionV1;
  outputContentDigest: string;
  inputs: readonly CanonicalMeasurementObservationLineageV1[];
}): CanonicalMeasurementValueLineageV1 {
  requireNonEmpty(input.organizationId, "organizationId");
  requireDigest(input.outputContentDigest, "outputContentDigest");
  if (
    input.definition.organizationId !== input.organizationId ||
    input.definition.id !== input.definition.contentDigest ||
    !HEX_64.test(input.definition.contentDigest)
  ) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:definitionIdentity");
  }
  if (input.inputs.length === 0) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:lineageInputs");
  }

  const inputs = [...input.inputs]
    .map((lineage) => {
      requireNonEmpty(lineage.observationId, "observationId");
      requireNonEmpty(lineage.sourceId, "sourceId");
      requireNonEmpty(lineage.trustRevisionId, "trustRevisionId");
      requireDigest(lineage.observationContentDigest, "observationContentDigest");
      requireDigest(lineage.trustAsOfReceiptId, "trustAsOfReceiptId");
      requireDigest(lineage.trustRevisionContentDigest, "trustRevisionContentDigest");
      if (lineage.observationSchemaVersion !== CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION) {
        throw new Error("CANONICAL_MEASUREMENT_INVALID:observationSchemaVersion");
      }
      return { ...lineage };
    })
    .sort((left, right) => canonicalLineageKey(left).localeCompare(canonicalLineageKey(right)));

  if (new Set(inputs.map(canonicalLineageKey)).size !== inputs.length) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:duplicateLineageInput");
  }

  const contractKinds = new Set(input.definition.inputContracts.map((entry) => entry.observationKind));
  if (inputs.some((entry) => !contractKinds.has(entry.observationKind))) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:undeclaredObservationKind");
  }

  const body = {
    schemaVersion: CANONICAL_MEASUREMENT_VALUE_LINEAGE_V1_SCHEMA_VERSION,
    organizationId: input.organizationId,
    definitionId: input.definition.id,
    definitionContentDigest: input.definition.contentDigest,
    outputContentDigest: input.outputContentDigest,
    inputs,
    authority: "INERT_LINEAGE_ONLY" as const,
  };
  const contentDigest = sha256Canonical(body);
  return { ...body, id: contentDigest, contentDigest };
}
