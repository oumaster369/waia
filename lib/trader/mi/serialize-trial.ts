import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { MI_TRIAL_SCHEMA_VERSION, type MiTrialSchemaVersion } from "@/lib/trader/mi/trial.types";

export type TrialContentDigestInput = {
  organizationId: string;
  hypothesisKey: string;
  hypothesisId: string;
  hypothesisDefinitionDigest: string;
  researchProgram: string | null;
  eventTime: Date;
  ingestTime: Date;
  registeredBy: string;
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

export function canonicalizeTrialContentDigestInput(
  input: TrialContentDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion: MI_TRIAL_SCHEMA_VERSION satisfies MiTrialSchemaVersion,
    organizationId: input.organizationId,
    hypothesisKey: input.hypothesisKey,
    hypothesisId: input.hypothesisId,
    hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
    researchProgram: input.researchProgram,
    eventTime: input.eventTime.toISOString(),
    ingestTime: input.ingestTime.toISOString(),
    registeredBy: input.registeredBy,
  }) as Record<string, unknown>;
}

/**
 * Pure fact fingerprint (LD-5a.2b / R1+R2).
 *
 * Binds only the hypothesis pin (id + key + definition digest) — nulls/falsification are
 * already sealed transitively in `hypothesisDefinitionDigest`, so they are NOT snapshotted.
 * `seq` and derived integrity are intentionally excluded.
 */
export function buildTrialContentDigest(input: TrialContentDigestInput): string {
  const canonical = canonicalizeTrialContentDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}
