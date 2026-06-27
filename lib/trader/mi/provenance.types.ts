/** Point-in-time timestamps (UTC). */
export type PitTimestamps = {
  eventTime: Date;
  ingestTime: Date;
};

/** Revision chain reference within an append-only history. */
export type RevisionRef = {
  revisionOf: string | null;
  revisionSeq: number;
};

/** Provenance stamp carried by trust revisions (and inherited by LD-2b observations). */
export type ProvenanceStamp = {
  sourceId: string;
  contentDigest: string;
} & PitTimestamps &
  RevisionRef;

/** Data-quality flags representable in LD-2a (full DQ-event emission deferred to LD-2b). */
export type DataQualityFlag = "INGEST_BEFORE_EVENT";
