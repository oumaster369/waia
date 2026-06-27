import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_TRIAL_INTEGRITY_SCHEMA_VERSION,
  type MiTrialIntegrityEventType,
  type MiTrialIntegrityReasonCode,
  type MiTrialIntegritySchemaVersion,
} from "@/lib/trader/mi/trial-integrity.types";

export type TrialIntegrityContentDigestInput = {
  organizationId: string;
  trialId: string;
  eventType: MiTrialIntegrityEventType;
  reasonCode: MiTrialIntegrityReasonCode | null;
  rationale: string;
  causeRef: string | null;
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
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

export function canonicalizeTrialIntegrityContentDigestInput(
  input: TrialIntegrityContentDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: MI_TRIAL_INTEGRITY_SCHEMA_VERSION satisfies MiTrialIntegritySchemaVersion,
    organizationId: input.organizationId,
    trialId: input.trialId,
    eventType: input.eventType,
    reasonCode: input.reasonCode,
    rationale: input.rationale,
    causeRef: input.causeRef,
    eventTime: input.eventTime.toISOString(),
    ingestTime: input.ingestTime.toISOString(),
    recordedBy: input.recordedBy,
  }) as Record<string, unknown>;
}

/**
 * Pure fact fingerprint (LD-5a.2c).
 *
 * Binds the invalidation fact only. `seq` and derived integrity state are excluded.
 */
export function buildTrialIntegrityContentDigest(input: TrialIntegrityContentDigestInput): string {
  const canonical = canonicalizeTrialIntegrityContentDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}
