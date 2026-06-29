import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  isMiConfidenceJudgmentKind,
  isMiConfidenceLevelV1,
  MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION,
  MI_CONFIDENCE_SCALE_V1,
  type MiConfidenceJudgment,
} from "@/lib/trader/mi/confidence-judgment.types";
import { parseForCitationsJson } from "@/lib/trader/mi/serialize-confidence-judgment";
import type { InsertConfidenceJudgmentRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapJudgment(
  row: typeof pgSchema.traderMiConfidenceJudgment.$inferSelect,
): MiConfidenceJudgment {
  if (!isMiConfidenceJudgmentKind(row.judgmentKind)) {
    throw new Error(`[trader] unknown mi confidence judgment_kind: ${row.judgmentKind}`);
  }
  if (row.level !== null && !isMiConfidenceLevelV1(row.level)) {
    throw new Error(`[trader] unknown mi confidence level: ${row.level}`);
  }
  if (row.bandLow !== null && !isMiConfidenceLevelV1(row.bandLow)) {
    throw new Error(`[trader] unknown mi confidence band_low: ${row.bandLow}`);
  }
  if (row.bandHigh !== null && !isMiConfidenceLevelV1(row.bandHigh)) {
    throw new Error(`[trader] unknown mi confidence band_high: ${row.bandHigh}`);
  }
  if (
    row.confidenceScaleVersion !== null &&
    row.confidenceScaleVersion !== MI_CONFIDENCE_SCALE_V1
  ) {
    throw new Error(`[trader] unknown mi confidence scale version: ${row.confidenceScaleVersion}`);
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    hypothesisId: row.hypothesisId,
    hypothesisKey: row.hypothesisKey,
    hypothesisDefinitionDigest: row.hypothesisDefinitionDigest,
    level: row.level,
    bandLow: row.bandLow,
    bandHigh: row.bandHigh,
    confidenceScaleVersion:
      row.confidenceScaleVersion === MI_CONFIDENCE_SCALE_V1 ? MI_CONFIDENCE_SCALE_V1 : null,
    judgmentKind: row.judgmentKind,
    reviewHorizonAt: row.reviewHorizonAt,
    forCitations: parseForCitationsJson(row.forCitationsJson),
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    recordedBy: row.recordedBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    schemaVersion: MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION,
    createdAt: row.createdAt,
  };
}

export async function getLatestConfidenceJudgmentByKeyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiConfidenceJudgment | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiConfidenceJudgment)
    .where(
      and(
        eq(pgSchema.traderMiConfidenceJudgment.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiConfidenceJudgment.seq))
    .limit(1);

  return rows[0] ? mapJudgment(rows[0]) : null;
}

export async function listConfidenceJudgmentsForHypothesisIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisId: string,
): Promise<MiConfidenceJudgment[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiConfidenceJudgment)
    .where(
      and(
        eq(pgSchema.traderMiConfidenceJudgment.hypothesisId, hypothesisId),
        orgScopedWhere(pgSchema.traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiConfidenceJudgment.seq);

  return rows.map(mapJudgment);
}

export async function listConfidenceJudgmentsForHypothesisKeyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiConfidenceJudgment[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiConfidenceJudgment)
    .where(
      and(
        eq(pgSchema.traderMiConfidenceJudgment.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiConfidenceJudgment.seq);

  return rows.map(mapJudgment);
}

export async function insertConfidenceJudgmentPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertConfidenceJudgmentRow,
): Promise<MiConfidenceJudgment> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiConfidenceJudgment).values({
    id: row.id,
    organizationId: scoped.organizationId,
    hypothesisId: row.hypothesisId,
    hypothesisKey: row.hypothesisKey,
    hypothesisDefinitionDigest: row.hypothesisDefinitionDigest,
    level: row.level,
    bandLow: row.bandLow,
    bandHigh: row.bandHigh,
    confidenceScaleVersion: row.confidenceScaleVersion,
    judgmentKind: row.judgmentKind,
    reviewHorizonAt: row.reviewHorizonAt,
    forCitationsJson: row.forCitationsJson,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    recordedBy: row.recordedBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiConfidenceJudgment)
    .where(
      and(
        eq(pgSchema.traderMiConfidenceJudgment.id, row.id),
        orgScopedWhere(pgSchema.traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi confidence judgment insert failed");
  }
  return mapJudgment(rows[0]);
}
