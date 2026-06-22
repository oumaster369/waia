export const MI_SOURCE_TRUST_SCHEMA_VERSION = "mi-source-trust-v1" as const;

export type MiSourceTrustSchemaVersion = typeof MI_SOURCE_TRUST_SCHEMA_VERSION;

export type TrustRevision = {
  id: string;
  organizationId: string;
  sourceId: string;
  trustScore: string;
  rationale: string;
  recordedBy: string;
  eventTime: Date;
  ingestTime: Date;
  revisionOf: string | null;
  revisionSeq: number;
  contentDigest: string;
  createdAt: Date;
};

export type AppendTrustRevisionInput = {
  sourceId: string;
  trustScore: string;
  rationale: string;
  recordedBy: string;
  eventTime: Date;
  ingestTime: Date;
};
