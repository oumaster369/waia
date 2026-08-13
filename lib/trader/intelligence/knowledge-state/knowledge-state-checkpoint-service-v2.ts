import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  computeKnowledgeCheckpointContentDigest,
  computeKnowledgeSemanticDigest,
  KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION,
  type KnowledgeCheckpointInput,
} from "./knowledge-state-checkpoint-v2";

/**
 * DEE-534 / WP-KNOWLEDGE-STATE — bounded knowledge checkpoint v2 persistence.
 *
 * Append-only, natural-idempotent on (organization_id, checkpoint_seq). Only the bounded
 * `KnowledgeCheckpointInput` fields are stored — no forecast history arrays. Restore
 * recomputes both digests from the persisted fields and fails closed on any mismatch
 * (corruption or identity tampering) rather than returning unverified state.
 */

export type KnowledgeCheckpointRecord = {
  id: string;
  organizationId: string;
  checkpointSeq: number;
  modelVersion: string;
  calibrationSnapshotDigest: string;
  knowledgeSemanticDigest: string;
  rejectedResearchStatesJson: string;
  promotedResearchStatesJson: string;
  forecastPackageGenerationDigest: string | null;
  contentDigest: string;
  schemaVersion: typeof KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION;
};

export function buildKnowledgeCheckpointRecord(
  input: KnowledgeCheckpointInput,
): KnowledgeCheckpointRecord {
  const knowledgeSemanticDigest = computeKnowledgeSemanticDigest(input);
  const contentDigest = computeKnowledgeCheckpointContentDigest(input);

  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    checkpointSeq: input.checkpointSeq,
    modelVersion: input.modelVersion,
    calibrationSnapshotDigest: input.calibrationSnapshotDigest,
    knowledgeSemanticDigest,
    rejectedResearchStatesJson: JSON.stringify([...input.rejectedResearchStates].sort()),
    promotedResearchStatesJson: JSON.stringify([...input.promotedResearchStates].sort()),
    forecastPackageGenerationDigest: input.forecastPackageGenerationDigest ?? null,
    contentDigest,
    schemaVersion: KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION,
  };
}

export class KnowledgeCheckpointPersistConflictError extends Error {
  readonly code = "KNOWLEDGE_CHECKPOINT_PERSIST_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeCheckpointPersistConflictError";
  }
}

export class KnowledgeCheckpointCorruptionError extends Error {
  readonly code = "KNOWLEDGE_CHECKPOINT_CORRUPTION" as const;

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeCheckpointCorruptionError";
  }
}

async function loadExistingCheckpoint(
  sql: postgres.Sql,
  organizationId: string,
  checkpointSeq: number,
): Promise<{ id: string; contentDigest: string } | null> {
  const rows = await sql<{ id: string; content_digest: string }[]>`
    SELECT id::text AS id, content_digest
    FROM trader_knowledge_state_checkpoint_v2
    WHERE ${orgScopedPostgresPredicate(sql, organizationId)}
      AND checkpoint_seq = ${checkpointSeq}
  `;
  const row = rows[0];
  return row ? { id: row.id, contentDigest: row.content_digest } : null;
}

export type WriteKnowledgeCheckpointResult = { id: string; insertedNew: boolean };

/**
 * Append-only checkpoint write, natural-idempotent on (organization_id, checkpoint_seq).
 * Fails closed on any conflicting content for the same natural identity
 * (`tksc_v2_org_checkpoint_seq_uq`).
 */
export async function writeKnowledgeCheckpointV2(
  sql: postgres.Sql,
  record: KnowledgeCheckpointRecord,
): Promise<WriteKnowledgeCheckpointResult> {
  const existing = await loadExistingCheckpoint(sql, record.organizationId, record.checkpointSeq);
  if (existing) {
    if (existing.contentDigest !== record.contentDigest) {
      throw new KnowledgeCheckpointPersistConflictError(
        "[knowledge-state-checkpoint-v2] natural-idempotent conflict: same checkpoint_seq, different content",
      );
    }
    return { id: existing.id, insertedNew: false };
  }

  try {
    await sql`
      INSERT INTO trader_knowledge_state_checkpoint_v2 (
        id,
        organization_id,
        checkpoint_seq,
        model_version,
        calibration_snapshot_digest,
        knowledge_semantic_digest,
        rejected_research_states_json,
        promoted_research_states_json,
        forecast_package_generation_digest,
        content_digest,
        schema_version
      ) VALUES (
        ${record.id}::uuid,
        ${record.organizationId}::uuid,
        ${record.checkpointSeq},
        ${record.modelVersion},
        ${record.calibrationSnapshotDigest},
        ${record.knowledgeSemanticDigest},
        ${record.rejectedResearchStatesJson},
        ${record.promotedResearchStatesJson},
        ${record.forecastPackageGenerationDigest},
        ${record.contentDigest},
        ${record.schemaVersion}
      )
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tksc_v2_org_checkpoint_seq_uq")) {
      const raced = await loadExistingCheckpoint(sql, record.organizationId, record.checkpointSeq);
      if (raced) {
        if (raced.contentDigest !== record.contentDigest) {
          throw new KnowledgeCheckpointPersistConflictError(
            "[knowledge-state-checkpoint-v2] natural-idempotent conflict: same checkpoint_seq, different content",
          );
        }
        return { id: raced.id, insertedNew: false };
      }
    }
    throw error;
  }

  return { id: record.id, insertedNew: true };
}

export async function readKnowledgeCheckpointV2(
  sql: postgres.Sql,
  input: { organizationId: string; checkpointSeq: number },
): Promise<KnowledgeCheckpointRecord | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      checkpoint_seq: string | number;
      model_version: string;
      calibration_snapshot_digest: string;
      knowledge_semantic_digest: string;
      rejected_research_states_json: string;
      promoted_research_states_json: string;
      forecast_package_generation_digest: string | null;
      content_digest: string;
      schema_version: string;
    }[]
  >`
    SELECT
      id::text AS id,
      organization_id::text AS organization_id,
      checkpoint_seq,
      model_version,
      calibration_snapshot_digest,
      knowledge_semantic_digest,
      rejected_research_states_json,
      promoted_research_states_json,
      forecast_package_generation_digest,
      content_digest,
      schema_version
    FROM trader_knowledge_state_checkpoint_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND checkpoint_seq = ${input.checkpointSeq}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    checkpointSeq: Number(row.checkpoint_seq),
    modelVersion: row.model_version,
    calibrationSnapshotDigest: row.calibration_snapshot_digest,
    knowledgeSemanticDigest: row.knowledge_semantic_digest,
    rejectedResearchStatesJson: row.rejected_research_states_json,
    promotedResearchStatesJson: row.promoted_research_states_json,
    forecastPackageGenerationDigest: row.forecast_package_generation_digest,
    contentDigest: row.content_digest,
    schemaVersion: row.schema_version as typeof KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION,
  };
}

export type RestoredKnowledgeCheckpointV2 = {
  input: KnowledgeCheckpointInput;
  knowledgeSemanticDigest: string;
  contentDigest: string;
};

/**
 * Restore a checkpoint and recompute its semantic + content digests from the persisted
 * fields, asserting equality against the stored digests. Fails closed on any mismatch.
 */
export async function restoreKnowledgeCheckpointV2(
  sql: postgres.Sql,
  input: { organizationId: string; checkpointSeq: number },
): Promise<RestoredKnowledgeCheckpointV2> {
  const row = await readKnowledgeCheckpointV2(sql, input);
  if (!row) {
    throw new KnowledgeCheckpointCorruptionError(
      `[knowledge-state-checkpoint-v2] no checkpoint found for organization_id=${input.organizationId} checkpoint_seq=${input.checkpointSeq}`,
    );
  }

  const restoredInput: KnowledgeCheckpointInput = {
    organizationId: row.organizationId,
    checkpointSeq: row.checkpointSeq,
    modelVersion: row.modelVersion,
    calibrationSnapshotDigest: row.calibrationSnapshotDigest,
    rejectedResearchStates: JSON.parse(row.rejectedResearchStatesJson) as string[],
    promotedResearchStates: JSON.parse(row.promotedResearchStatesJson) as string[],
    forecastPackageGenerationDigest: row.forecastPackageGenerationDigest ?? undefined,
  };

  const recomputedSemanticDigest = computeKnowledgeSemanticDigest(restoredInput);
  if (recomputedSemanticDigest !== row.knowledgeSemanticDigest) {
    throw new KnowledgeCheckpointCorruptionError(
      `[knowledge-state-checkpoint-v2] semantic digest mismatch on restore (corruption/identity mismatch): stored=${row.knowledgeSemanticDigest} recomputed=${recomputedSemanticDigest}`,
    );
  }

  const recomputedContentDigest = computeKnowledgeCheckpointContentDigest(restoredInput);
  if (recomputedContentDigest !== row.contentDigest) {
    throw new KnowledgeCheckpointCorruptionError(
      `[knowledge-state-checkpoint-v2] content digest mismatch on restore (corruption/identity mismatch): stored=${row.contentDigest} recomputed=${recomputedContentDigest}`,
    );
  }

  return {
    input: restoredInput,
    knowledgeSemanticDigest: recomputedSemanticDigest,
    contentDigest: recomputedContentDigest,
  };
}
