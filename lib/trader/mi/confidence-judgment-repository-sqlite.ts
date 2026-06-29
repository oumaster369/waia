import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import { traderMiConfidenceJudgment } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
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

function mapJudgment(row: typeof traderMiConfidenceJudgment.$inferSelect): MiConfidenceJudgment {
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

export function getLatestConfidenceJudgmentByKeySqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiConfidenceJudgment | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiConfidenceJudgment)
    .where(
      and(
        eq(traderMiConfidenceJudgment.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiConfidenceJudgment.seq))
    .limit(1)
    .all()[0];

  return row ? mapJudgment(row) : null;
}

export function listConfidenceJudgmentsForHypothesisIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisId: string,
): MiConfidenceJudgment[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiConfidenceJudgment)
    .where(
      and(
        eq(traderMiConfidenceJudgment.hypothesisId, hypothesisId),
        orgScopedWhere(traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .orderBy(traderMiConfidenceJudgment.seq)
    .all()
    .map(mapJudgment);
}

export function listConfidenceJudgmentsForHypothesisKeySqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiConfidenceJudgment[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiConfidenceJudgment)
    .where(
      and(
        eq(traderMiConfidenceJudgment.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .orderBy(traderMiConfidenceJudgment.seq)
    .all()
    .map(mapJudgment);
}

export function insertConfidenceJudgmentSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertConfidenceJudgmentRow,
): MiConfidenceJudgment {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiConfidenceJudgment)
    .values({
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
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiConfidenceJudgment)
    .where(
      and(
        eq(traderMiConfidenceJudgment.id, row.id),
        orgScopedWhere(traderMiConfidenceJudgment.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi confidence judgment insert failed");
  }
  return mapJudgment(inserted);
}
