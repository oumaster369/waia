import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  assertNoForbiddenPatternSignal,
  assertPatternResearchOnlyAuthority,
  computePatternDefinitionDigest,
  computePatternOccurrenceDigest,
  PATTERN_DEFINITION_SCHEMA_VERSION,
  PATTERN_RESEARCH_AUTHORITY,
  type PatternAblationLevel,
  type PatternDefinitionInput,
  type PatternOccurrenceInput,
} from "./pattern-research-v1";

/**
 * DEE-533 / WP-PATTERN-RESEARCH — pattern definition/occurrence persistence.
 *
 * Both tables are append-only, RESEARCH_ONLY substrate. Patterns never authorize capital
 * on their own (`assertPatternNotCapitalAuthority`). Occurrences enforce point-in-time
 * correctness: an anchor closed bar in the future relative to the caller's `asOfEpochMs`
 * is rejected before it ever reaches Postgres.
 */

export const PATTERN_OCCURRENCE_CONTENT_VERSION = "pattern-occurrence-content/v1" as const;

function computeDefinitionContentDigest(definitionDigest: string): string {
  return createHash("sha256")
    .update(`${PATTERN_DEFINITION_SCHEMA_VERSION}\n${definitionDigest}\n`, "utf8")
    .digest("hex");
}

export type PatternDefinitionRecord = {
  id: string;
  organizationId: string;
  patternKey: string;
  schemaVersion: typeof PATTERN_DEFINITION_SCHEMA_VERSION;
  quantizerVersion: string;
  stateVectorVersion: string;
  ablationLevel: PatternAblationLevel;
  authorityStatus: typeof PATTERN_RESEARCH_AUTHORITY;
  definitionJson: string;
  definitionDigest: string;
  contentDigest: string;
  authoredBy: string;
};

export function buildPatternDefinitionRecord(
  input: PatternDefinitionInput & { authoredBy: string },
): PatternDefinitionRecord {
  assertNoForbiddenPatternSignal(input.patternKey);

  const definitionDigest = computePatternDefinitionDigest(input);
  const definitionJson = JSON.stringify({
    organizationId: input.organizationId,
    patternKey: input.patternKey,
    quantizerVersion: input.quantizerVersion,
    stateVectorVersion: input.stateVectorVersion,
    ablationLevel: input.ablationLevel,
    vTilde: input.vTilde,
    aTilde: input.aTilde ?? null,
  });

  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    patternKey: input.patternKey,
    schemaVersion: PATTERN_DEFINITION_SCHEMA_VERSION,
    quantizerVersion: input.quantizerVersion,
    stateVectorVersion: input.stateVectorVersion,
    ablationLevel: input.ablationLevel,
    authorityStatus: PATTERN_RESEARCH_AUTHORITY,
    definitionJson,
    definitionDigest,
    contentDigest: computeDefinitionContentDigest(definitionDigest),
    authoredBy: input.authoredBy,
  };
}

export class PatternDefinitionConflictError extends Error {
  readonly code = "PATTERN_DEFINITION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "PatternDefinitionConflictError";
  }
}

async function loadExistingDefinition(
  sql: postgres.Sql,
  organizationId: string,
  patternKey: string,
  definitionDigest: string,
): Promise<{ id: string; contentDigest: string } | null> {
  const rows = await sql<{ id: string; content_digest: string }[]>`
    SELECT id::text AS id, content_digest
    FROM trader_pattern_definition_v1
    WHERE ${orgScopedPostgresPredicate(sql, organizationId)}
      AND pattern_key = ${patternKey}
      AND definition_digest = ${definitionDigest}
  `;
  const row = rows[0];
  return row ? { id: row.id, contentDigest: row.content_digest } : null;
}

export type PersistPatternDefinitionResult = { id: string; insertedNew: boolean };

/**
 * Append-only persist, natural-idempotent on (organization_id, pattern_key, definition_digest).
 * Fails closed on any conflicting content for the same natural identity
 * (`tpd_v1_org_pattern_key_digest_uq`).
 */
export async function persistPatternDefinitionV1(
  sql: postgres.Sql,
  record: PatternDefinitionRecord,
): Promise<PersistPatternDefinitionResult> {
  const existing = await loadExistingDefinition(
    sql,
    record.organizationId,
    record.patternKey,
    record.definitionDigest,
  );
  if (existing) {
    if (existing.contentDigest !== record.contentDigest) {
      throw new PatternDefinitionConflictError(
        "[pattern-research] natural-idempotent conflict: same pattern_key+definition_digest, different content",
      );
    }
    return { id: existing.id, insertedNew: false };
  }

  try {
    await sql`
      INSERT INTO trader_pattern_definition_v1 (
        id,
        organization_id,
        pattern_key,
        schema_version,
        quantizer_version,
        state_vector_version,
        ablation_level,
        authority_status,
        definition_json,
        definition_digest,
        content_digest,
        authored_by
      ) VALUES (
        ${record.id}::uuid,
        ${record.organizationId}::uuid,
        ${record.patternKey},
        ${record.schemaVersion},
        ${record.quantizerVersion},
        ${record.stateVectorVersion},
        ${record.ablationLevel},
        ${record.authorityStatus},
        ${record.definitionJson},
        ${record.definitionDigest},
        ${record.contentDigest},
        ${record.authoredBy}
      )
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tpd_v1_org_pattern_key_digest_uq")) {
      const raced = await loadExistingDefinition(
        sql,
        record.organizationId,
        record.patternKey,
        record.definitionDigest,
      );
      if (raced) {
        if (raced.contentDigest !== record.contentDigest) {
          throw new PatternDefinitionConflictError(
            "[pattern-research] natural-idempotent conflict: same pattern_key+definition_digest, different content",
          );
        }
        return { id: raced.id, insertedNew: false };
      }
    }
    throw error;
  }

  return { id: record.id, insertedNew: true };
}

export async function readPatternDefinitionV1(
  sql: postgres.Sql,
  input: { organizationId: string; patternKey: string; definitionDigest: string },
): Promise<PatternDefinitionRecord | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      pattern_key: string;
      schema_version: string;
      quantizer_version: string;
      state_vector_version: string;
      ablation_level: PatternAblationLevel;
      authority_status: string;
      definition_json: string;
      definition_digest: string;
      content_digest: string;
      authored_by: string;
    }[]
  >`
    SELECT
      id::text AS id,
      organization_id::text AS organization_id,
      pattern_key,
      schema_version,
      quantizer_version,
      state_vector_version,
      ablation_level,
      authority_status,
      definition_json,
      definition_digest,
      content_digest,
      authored_by
    FROM trader_pattern_definition_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND pattern_key = ${input.patternKey}
      AND definition_digest = ${input.definitionDigest}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    patternKey: row.pattern_key,
    schemaVersion: row.schema_version as typeof PATTERN_DEFINITION_SCHEMA_VERSION,
    quantizerVersion: row.quantizer_version,
    stateVectorVersion: row.state_vector_version,
    ablationLevel: row.ablation_level,
    authorityStatus: row.authority_status as typeof PATTERN_RESEARCH_AUTHORITY,
    definitionJson: row.definition_json,
    definitionDigest: row.definition_digest,
    contentDigest: row.content_digest,
    authoredBy: row.authored_by,
  };
}

export type PatternOccurrenceRecord = {
  id: string;
  organizationId: string;
  patternDefinitionId: string;
  patternKey: string;
  symbol: string;
  anchorClosedBarEpochMs: number;
  occurrenceDigest: string;
  recurrenceStatsJson: string;
  contentDigest: string;
};

export class PatternOccurrencePitViolationError extends Error {
  readonly code = "PATTERN_OCCURRENCE_PIT_VIOLATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "PatternOccurrencePitViolationError";
  }
}

function computeOccurrenceContentDigest(occurrenceDigest: string): string {
  return createHash("sha256")
    .update(`${PATTERN_OCCURRENCE_CONTENT_VERSION}\n${occurrenceDigest}\n`, "utf8")
    .digest("hex");
}

export type BuildPatternOccurrenceInput = PatternOccurrenceInput & {
  organizationId: string;
  patternDefinitionId: string;
  patternKey: string;
  /** PIT authority: occurrences with an anchor in the future vs this cutoff are rejected. */
  asOfEpochMs: number;
};

/** Fails closed (PIT violation) if `anchorClosedBarEpochMs` is in the future vs `asOfEpochMs`. */
export function buildPatternOccurrenceRecord(
  input: BuildPatternOccurrenceInput,
): PatternOccurrenceRecord {
  if (input.anchorClosedBarEpochMs > input.asOfEpochMs) {
    throw new PatternOccurrencePitViolationError(
      `[pattern-research] PIT violation: anchor_closed_bar_epoch_ms=${input.anchorClosedBarEpochMs} is in the future vs asOfEpochMs=${input.asOfEpochMs}`,
    );
  }

  const occurrenceDigest = computePatternOccurrenceDigest(input);
  const recurrenceStatsJson = JSON.stringify({
    recurrenceCount: input.recurrenceCount,
    transitionRowSums: input.transitionRowSums,
  });

  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    patternDefinitionId: input.patternDefinitionId,
    patternKey: input.patternKey,
    symbol: input.symbol,
    anchorClosedBarEpochMs: input.anchorClosedBarEpochMs,
    occurrenceDigest,
    recurrenceStatsJson,
    contentDigest: computeOccurrenceContentDigest(occurrenceDigest),
  };
}

export class PatternOccurrenceConflictError extends Error {
  readonly code = "PATTERN_OCCURRENCE_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "PatternOccurrenceConflictError";
  }
}

export class PatternOccurrenceTenantIsolationError extends Error {
  readonly code = "PATTERN_OCCURRENCE_TENANT_ISOLATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "PatternOccurrenceTenantIsolationError";
  }
}

async function loadExistingOccurrence(
  sql: postgres.Sql,
  organizationId: string,
  patternDefinitionId: string,
  anchorClosedBarEpochMs: number,
): Promise<{ id: string; contentDigest: string } | null> {
  const rows = await sql<{ id: string; content_digest: string }[]>`
    SELECT id::text AS id, content_digest
    FROM trader_pattern_occurrence_v1
    WHERE ${orgScopedPostgresPredicate(sql, organizationId)}
      AND pattern_definition_id = ${patternDefinitionId}::uuid
      AND anchor_closed_bar_epoch_ms = ${anchorClosedBarEpochMs}
  `;
  const row = rows[0];
  return row ? { id: row.id, contentDigest: row.content_digest } : null;
}

export type PersistPatternOccurrenceResult = { id: string; insertedNew: boolean };

/**
 * Append-only persist, natural-idempotent on (organization_id, pattern_definition_id, anchor).
 * Fails closed on any conflicting content for the same natural identity
 * (`tpo_v1_org_pattern_anchor_uq`).
 */
export async function persistPatternOccurrenceV1(
  sql: postgres.Sql,
  record: PatternOccurrenceRecord,
): Promise<PersistPatternOccurrenceResult> {
  // App-layer tenant binding: child occurrence must resolve parent definition in the same org.
  const parent = await sql<{ id: string }[]>`
    SELECT id::text AS id
    FROM trader_pattern_definition_v1
    WHERE id = ${record.patternDefinitionId}::uuid
      AND ${orgScopedPostgresPredicate(sql, record.organizationId)}
    LIMIT 1
  `;
  if (!parent[0]) {
    throw new PatternOccurrenceTenantIsolationError(
      `[pattern-research] pattern definition ${record.patternDefinitionId} is not visible to organization ${record.organizationId}`,
    );
  }

  const existing = await loadExistingOccurrence(
    sql,
    record.organizationId,
    record.patternDefinitionId,
    record.anchorClosedBarEpochMs,
  );
  if (existing) {
    if (existing.contentDigest !== record.contentDigest) {
      throw new PatternOccurrenceConflictError(
        "[pattern-research] natural-idempotent conflict: same pattern_definition_id+anchor, different content",
      );
    }
    return { id: existing.id, insertedNew: false };
  }

  try {
    await sql`
      INSERT INTO trader_pattern_occurrence_v1 (
        id,
        organization_id,
        pattern_definition_id,
        pattern_key,
        symbol,
        anchor_closed_bar_epoch_ms,
        occurrence_digest,
        recurrence_stats_json,
        content_digest
      ) VALUES (
        ${record.id}::uuid,
        ${record.organizationId}::uuid,
        ${record.patternDefinitionId}::uuid,
        ${record.patternKey},
        ${record.symbol},
        ${record.anchorClosedBarEpochMs},
        ${record.occurrenceDigest},
        ${record.recurrenceStatsJson},
        ${record.contentDigest}
      )
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tpo_v1_org_pattern_anchor_uq")) {
      const raced = await loadExistingOccurrence(
        sql,
        record.organizationId,
        record.patternDefinitionId,
        record.anchorClosedBarEpochMs,
      );
      if (raced) {
        if (raced.contentDigest !== record.contentDigest) {
          throw new PatternOccurrenceConflictError(
            "[pattern-research] natural-idempotent conflict: same pattern_definition_id+anchor, different content",
          );
        }
        return { id: raced.id, insertedNew: false };
      }
    }
    throw error;
  }

  return { id: record.id, insertedNew: true };
}

export async function readPatternOccurrenceV1(
  sql: postgres.Sql,
  input: { organizationId: string; patternDefinitionId: string; anchorClosedBarEpochMs: number },
): Promise<PatternOccurrenceRecord | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      pattern_definition_id: string;
      pattern_key: string;
      symbol: string;
      anchor_closed_bar_epoch_ms: string | number;
      occurrence_digest: string;
      recurrence_stats_json: string;
      content_digest: string;
    }[]
  >`
    SELECT
      id::text AS id,
      organization_id::text AS organization_id,
      pattern_definition_id::text AS pattern_definition_id,
      pattern_key,
      symbol,
      anchor_closed_bar_epoch_ms,
      occurrence_digest,
      recurrence_stats_json,
      content_digest
    FROM trader_pattern_occurrence_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND pattern_definition_id = ${input.patternDefinitionId}::uuid
      AND anchor_closed_bar_epoch_ms = ${input.anchorClosedBarEpochMs}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    patternDefinitionId: row.pattern_definition_id,
    patternKey: row.pattern_key,
    symbol: row.symbol,
    anchorClosedBarEpochMs: Number(row.anchor_closed_bar_epoch_ms),
    occurrenceDigest: row.occurrence_digest,
    recurrenceStatsJson: row.recurrence_stats_json,
    contentDigest: row.content_digest,
  };
}

/** Pattern definitions and occurrences are RESEARCH_ONLY; they never authorize capital. */
export function assertPatternNotCapitalAuthority(input: {
  authorityStatus: string;
  claimsCapitalAuthority?: boolean;
}): void {
  assertPatternResearchOnlyAuthority(input.authorityStatus);
  if (input.claimsCapitalAuthority) {
    throw new Error(
      "[pattern-research] pattern definitions/occurrences cannot claim capital authority",
    );
  }
}
