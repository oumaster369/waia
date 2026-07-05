/** Operator batch fixture ingest — no runtime adapter implementations in M7 v1. */

export const EXTERNAL_EVENT_INGEST_FACT_KIND = "external_event_ingest_v1" as const;
export const EXTERNAL_EVENT_INGEST_SCHEMA_VERSION = "waia.trader.external-event-ingest.v1" as const;

/** Future slot — no implementations in this milestone. */
export type ExternalEventAdapter = {
  readonly adapterId: string;
  ingestBatch: (input: { fixturePath: string }) => Promise<readonly ExternalEventFixture[]>;
};

export type ExternalEventFixture = {
  eventKey: string;
  sourceRef: string;
  eventTime: string;
  symbolScope: string;
  metadata?: Record<string, string | number | boolean>;
};

export type OperatorEventIngestConfig = {
  enabled: boolean;
  fixturePaths?: readonly string[];
};

export const DEFAULT_OPERATOR_EVENT_INGEST_CONFIG: OperatorEventIngestConfig = {
  enabled: false,
};
