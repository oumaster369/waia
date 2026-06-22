export const MI_OBSERVATION_SCHEMA_VERSION = "mi-observation-v1" as const;

export type MiObservationSchemaVersion = typeof MI_OBSERVATION_SCHEMA_VERSION;

export const miObservationKindValues = ["msv_envelope"] as const;

export type MiObservationKind = (typeof miObservationKindValues)[number];

export type PitObservation = {
  id: string;
  organizationId: string;
  sourceId: string;
  observationKind: MiObservationKind;
  observationKey: string;
  subjectRef: string;
  schemaVersion: MiObservationSchemaVersion;
  payloadJson: string;
  eventTime: Date;
  ingestTime: Date;
  observedBy: string;
  revisionOf: string | null;
  revisionSeq: number;
  contentDigest: string;
  createdAt: Date;
};

export type RecordObservationInput = {
  sourceId: string;
  observationKind: MiObservationKind;
  subjectRef: string;
  payloadJson: string;
  eventTime: Date;
  ingestTime: Date;
  observedBy: string;
};

export type AppendObservationRevisionInput = {
  observationKey: string;
  sourceId: string;
  observationKind: MiObservationKind;
  subjectRef: string;
  payloadJson: string;
  eventTime: Date;
  ingestTime: Date;
  observedBy: string;
};

/** Dedicated internal MSV source identity (DEE-281 / R3). */
export const MI_MSV_INTERNAL_SOURCE = {
  venue: "internal",
  feedKind: "msv_envelope",
  symbol: null,
  description: "Internal MSV envelope observation source (Chief Decision Engine v0)",
} as const;
