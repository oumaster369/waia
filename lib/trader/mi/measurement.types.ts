import type { MiObservationKind } from "@/lib/trader/mi/observation.types";

export const MI_MEASUREMENT_SCHEMA_VERSION = "mi-measurement-v1" as const;

export type MiMeasurementSchemaVersion = typeof MI_MEASUREMENT_SCHEMA_VERSION;

export const miMeasurementKindValues = ["feature_transform"] as const;

export type MiMeasurementKind = (typeof miMeasurementKindValues)[number];

/**
 * Declarative transform-definition descriptor (DEE-282 / M7).
 * Inert metadata only — there is no evaluator and no runtime binding.
 * `inputs.observationKinds` declares the observation kinds this measurement
 * transforms (M6 declarative lineage); `params` are definitional parameters.
 */
export type MeasurementDefinition = {
  inputs: {
    observationKinds: readonly MiObservationKind[];
    measurementNames?: readonly string[];
  };
  outputType: string;
  params?: Record<string, number | string | boolean>;
  description?: string;
};

export type MiMeasurement = {
  id: string;
  organizationId: string;
  measurementKind: MiMeasurementKind;
  measurementKey: string;
  name: string;
  schemaVersion: MiMeasurementSchemaVersion;
  definitionJson: string;
  definitionDigest: string;
  versionSeq: number;
  revisionOf: string | null;
  authoredBy: string;
  createdAt: Date;
};

export type RegisterMeasurementInput = {
  measurementKind: MiMeasurementKind;
  name: string;
  definition: MeasurementDefinition;
  authoredBy: string;
};

export type AppendMeasurementVersionInput = {
  measurementKey: string;
  measurementKind: MiMeasurementKind;
  name: string;
  definition: MeasurementDefinition;
  authoredBy: string;
};
