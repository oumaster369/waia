import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_SOURCE_TRUST_SCHEMA_VERSION,
  type MiSourceTrustSchemaVersion,
} from "@/lib/trader/mi/source-trust.types";

export type SourceTrustDigestInput = {
  schemaVersion: MiSourceTrustSchemaVersion;
  organizationId: string;
  sourceId: string;
  trustScore: string;
  rationale: string;
  recordedBy: string;
  eventTime: Date;
  ingestTime: Date;
  revisionOf: string | null;
  revisionSeq: number;
};

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

export function canonicalizeSourceTrustDigestInput(
  input: SourceTrustDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: input.schemaVersion,
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    trustScore: input.trustScore,
    rationale: input.rationale,
    recordedBy: input.recordedBy,
    eventTime: toUtcIsoMs(input.eventTime),
    ingestTime: toUtcIsoMs(input.ingestTime),
    revisionOf: input.revisionOf,
    revisionSeq: input.revisionSeq,
  }) as Record<string, unknown>;
}

export function computeSourceTrustDigest(input: SourceTrustDigestInput): string {
  const canonical = canonicalizeSourceTrustDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildSourceTrustDigestInput(
  input: Omit<SourceTrustDigestInput, "schemaVersion">,
): SourceTrustDigestInput {
  return {
    ...input,
    schemaVersion: MI_SOURCE_TRUST_SCHEMA_VERSION,
  };
}
