export const FHV_SEMANTIC_EVENT_SCHEMA_VERSION = "fhv-semantic-event/v1" as const;

export type FhvSemanticEventV1 = Readonly<{
  schemaVersion: typeof FHV_SEMANTIC_EVENT_SCHEMA_VERSION;
  runId: string;
  cycleId: string;
  moduleName: string;
  moduleVersion: string;
  eventType: string;
  inputDigest: string;
  outputDigest: string;
  stateDigest: string;
  seq: number;
  timestampUtc: string;
  correlationId: string;
}>;

export const FHV_SEMANTIC_EVENT_REQUIRED_KEYS = [
  "schemaVersion",
  "runId",
  "cycleId",
  "moduleName",
  "moduleVersion",
  "eventType",
  "inputDigest",
  "outputDigest",
  "stateDigest",
  "seq",
  "timestampUtc",
  "correlationId",
] as const;

export function assertFhvSemanticEventV1(value: unknown): asserts value is FhvSemanticEventV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_SEMANTIC_EVENT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  for (const key of FHV_SEMANTIC_EVENT_REQUIRED_KEYS) {
    if (!(key in record)) {
      throw new Error(`FHV_SEMANTIC_EVENT:MISSING_KEY:${key}`);
    }
  }
  if (record.schemaVersion !== FHV_SEMANTIC_EVENT_SCHEMA_VERSION) {
    throw new Error("FHV_SEMANTIC_EVENT:SCHEMA_VERSION_MISMATCH");
  }
  if (typeof record.seq !== "number" || !Number.isInteger(record.seq) || record.seq < 0) {
    throw new Error("FHV_SEMANTIC_EVENT:SEQ_INVALID");
  }
}
