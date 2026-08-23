import { createHash } from "node:crypto";

import {
  CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  DOWNSTREAM_MEASUREMENT_CATEGORIES_V1,
  type CanonicalExternalObservationKindV1,
  type CanonicalPrimitiveObservationKindV1,
  type DownstreamMeasurementCategoryV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import { MI_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/observation.types";
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

export type CanonicalMeasurementInputContractV1 =
  | {
      observationKind: "msv_envelope";
      observationSchemaVersion: typeof MI_OBSERVATION_SCHEMA_VERSION;
    }
  | {
      observationKind: CanonicalExternalObservationKindV1;
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

type CanonicalMeasurementObservationLineageBaseV1 = {
  observationId: string;
  observationContentDigest: string;
  sourceId: string;
};

export type CanonicalMeasurementObservationLineageV1 =
  | (CanonicalMeasurementObservationLineageBaseV1 & {
      observationKind: "msv_envelope";
      observationSchemaVersion: typeof MI_OBSERVATION_SCHEMA_VERSION;
      trustAsOfReceiptId: null;
      trustRevisionId: null;
      trustRevisionContentDigest: null;
    })
  | (CanonicalMeasurementObservationLineageBaseV1 & {
      observationKind: CanonicalExternalObservationKindV1;
      observationSchemaVersion: typeof CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION;
      trustAsOfReceiptId: string;
      trustRevisionId: string;
      trustRevisionContentDigest: string;
    });

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
    input.trustAsOfReceiptId ?? "null",
    input.trustRevisionId ?? "null",
    input.trustRevisionContentDigest ?? "null",
  ].join(":");
}

function expectedObservationSchemaVersion(
  kind: CanonicalPrimitiveObservationKindV1,
): typeof MI_OBSERVATION_SCHEMA_VERSION | typeof CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION {
  return kind === "msv_envelope"
    ? MI_OBSERVATION_SCHEMA_VERSION
    : CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION;
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
        ) ||
        contract.observationSchemaVersion !== expectedObservationSchemaVersion(contract.observationKind)
      ) {
        throw new Error("CANONICAL_MEASUREMENT_INVALID:inputContract");
      }
      return {
        observationKind: contract.observationKind,
        observationSchemaVersion: contract.observationSchemaVersion,
      } as CanonicalMeasurementInputContractV1;
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

export function assertCanonicalMeasurementDefinitionV1(
  definition: CanonicalMeasurementDefinitionV1,
): CanonicalMeasurementDefinitionV1 {
  try {
    const expected = defineCanonicalMeasurementV1({
      organizationId: definition.organizationId,
      category: definition.category,
      name: definition.name,
      inputContracts: definition.inputContracts,
      outputSchemaVersion: definition.outputSchemaVersion,
    });
    if (canonicalJsonString(expected) !== canonicalJsonString(definition)) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:definitionIdentity");
  }
  return definition;
}

export function identifyCanonicalMeasurementValueV1(input: {
  organizationId: string;
  definition: CanonicalMeasurementDefinitionV1;
  outputContentDigest: string;
  inputs: readonly CanonicalMeasurementObservationLineageV1[];
}): CanonicalMeasurementValueLineageV1 {
  requireNonEmpty(input.organizationId, "organizationId");
  requireDigest(input.outputContentDigest, "outputContentDigest");
  if (input.definition.organizationId !== input.organizationId) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:definitionIdentity");
  }
  assertCanonicalMeasurementDefinitionV1(input.definition);
  if (input.inputs.length === 0) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:lineageInputs");
  }

  const inputs = [...input.inputs]
    .map((lineage) => {
      requireNonEmpty(lineage.observationId, "observationId");
      requireNonEmpty(lineage.sourceId, "sourceId");
      requireDigest(lineage.observationContentDigest, "observationContentDigest");
      if (
        !(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 as readonly string[]).includes(
          lineage.observationKind,
        ) ||
        lineage.observationSchemaVersion !== expectedObservationSchemaVersion(lineage.observationKind)
      ) {
        throw new Error("CANONICAL_MEASUREMENT_INVALID:observationSchemaVersion");
      }
      if (lineage.observationKind === "msv_envelope") {
        if (
          lineage.trustAsOfReceiptId !== null ||
          lineage.trustRevisionId !== null ||
          lineage.trustRevisionContentDigest !== null
        ) {
          throw new Error("CANONICAL_MEASUREMENT_INVALID:internalTrustLineage");
        }
        return {
          observationId: lineage.observationId,
          observationKind: lineage.observationKind,
          observationSchemaVersion: lineage.observationSchemaVersion,
          observationContentDigest: lineage.observationContentDigest,
          sourceId: lineage.sourceId,
          trustAsOfReceiptId: null,
          trustRevisionId: null,
          trustRevisionContentDigest: null,
        };
      }
      requireNonEmpty(lineage.trustRevisionId, "trustRevisionId");
      requireDigest(lineage.trustAsOfReceiptId, "trustAsOfReceiptId");
      requireDigest(lineage.trustRevisionContentDigest, "trustRevisionContentDigest");
      return {
        observationId: lineage.observationId,
        observationKind: lineage.observationKind,
        observationSchemaVersion: lineage.observationSchemaVersion,
        observationContentDigest: lineage.observationContentDigest,
        sourceId: lineage.sourceId,
        trustAsOfReceiptId: lineage.trustAsOfReceiptId,
        trustRevisionId: lineage.trustRevisionId,
        trustRevisionContentDigest: lineage.trustRevisionContentDigest,
      };
    })
    .sort((left, right) => canonicalLineageKey(left).localeCompare(canonicalLineageKey(right)));

  if (new Set(inputs.map(canonicalLineageKey)).size !== inputs.length) {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:duplicateLineageInput");
  }

  const contractKinds = new Set(input.definition.inputContracts.map(canonicalInputContractKey));
  if (
    inputs.some((entry) =>
      !contractKinds.has(
        canonicalInputContractKey({
          observationKind: entry.observationKind,
          observationSchemaVersion: entry.observationSchemaVersion,
        } as CanonicalMeasurementInputContractV1),
      ),
    )
  ) {
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

export function assertCanonicalMeasurementValueLineageV1(
  value: CanonicalMeasurementValueLineageV1,
  definition: CanonicalMeasurementDefinitionV1,
): CanonicalMeasurementValueLineageV1 {
  try {
    const expected = identifyCanonicalMeasurementValueV1({
      organizationId: value.organizationId,
      definition,
      outputContentDigest: value.outputContentDigest,
      inputs: value.inputs,
    });
    if (canonicalJsonString(expected) !== canonicalJsonString(value)) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error("CANONICAL_MEASUREMENT_INVALID:valueIdentity");
  }
  return value;
}
