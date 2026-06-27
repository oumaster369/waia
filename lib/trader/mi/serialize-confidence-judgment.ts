import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION,
  type MiConfidenceJudgmentCitation,
  type MiConfidenceJudgmentKind,
  type MiConfidenceJudgmentSchemaVersion,
  type MiConfidenceLevelV1,
  type MiConfidenceScaleVersion,
} from "@/lib/trader/mi/confidence-judgment.types";

export type ConfidenceJudgmentContentDigestInput = {
  organizationId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  confidenceScaleVersion: MiConfidenceScaleVersion | null;
  level: MiConfidenceLevelV1 | null;
  bandLow: MiConfidenceLevelV1 | null;
  bandHigh: MiConfidenceLevelV1 | null;
  judgmentKind: MiConfidenceJudgmentKind;
  reviewHorizonAt: Date | null;
  forCitations: readonly MiConfidenceJudgmentCitation[];
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

function sortForCitations(
  citations: readonly MiConfidenceJudgmentCitation[],
): MiConfidenceJudgmentCitation[] {
  return [...citations].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

export function serializeForCitationsJson(
  citations: readonly MiConfidenceJudgmentCitation[],
): string {
  return JSON.stringify(sortForCitations(citations));
}

export function parseForCitationsJson(raw: string): MiConfidenceJudgmentCitation[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("[trader] invalid confidence judgment for_citations_json");
  }
  return parsed.map((entry) => {
    const record = entry as Record<string, unknown>;
    if (typeof record.evidenceId !== "string" || typeof record.evidenceContentDigest !== "string") {
      throw new Error("[trader] invalid confidence judgment citation entry");
    }
    return {
      evidenceId: record.evidenceId,
      evidenceContentDigest: record.evidenceContentDigest,
    };
  });
}

export function canonicalizeConfidenceJudgmentContentDigestInput(
  input: ConfidenceJudgmentContentDigestInput,
): Record<string, unknown> {
  return sortKeysDeep({
    schemaVersion:
      MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION satisfies MiConfidenceJudgmentSchemaVersion,
    organizationId: input.organizationId,
    hypothesisKey: input.hypothesisKey,
    hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
    confidenceScaleVersion: input.confidenceScaleVersion,
    level: input.level,
    bandLow: input.bandLow,
    bandHigh: input.bandHigh,
    judgmentKind: input.judgmentKind,
    reviewHorizonAt: input.reviewHorizonAt?.toISOString() ?? null,
    forCitations: sortForCitations(input.forCitations).map((citation) => ({
      evidenceContentDigest: citation.evidenceContentDigest,
      evidenceId: citation.evidenceId,
    })),
    eventTime: input.eventTime.toISOString(),
    ingestTime: input.ingestTime.toISOString(),
    recordedBy: input.recordedBy,
  }) as Record<string, unknown>;
}

/** Pure fact fingerprint — `seq` and derived state are intentionally excluded. */
export function buildConfidenceJudgmentContentDigest(
  input: ConfidenceJudgmentContentDigestInput,
): string {
  const canonical = canonicalizeConfidenceJudgmentContentDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}
