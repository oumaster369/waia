import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  EventAttributionConfidenceRow,
  EventAttributionRow,
  EventClassificationRow,
  EventExplanationRow,
  EventRecordRow,
  InsertEventAttributionConfidenceRow,
  InsertEventAttributionRow,
  InsertEventClassificationRow,
  InsertEventExplanationRow,
  InsertEventRecordRow,
} from "@/lib/trader/events/event-record.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapEventRecord(row: typeof pgSchema.traderEventRecord.$inferSelect): EventRecordRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventKey: row.eventKey,
    sourceRef: row.sourceRef,
    symbolScope: row.symbolScope,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function insertEventRecordPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEventRecordRow,
): Promise<EventRecordRow> {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderEventRecord).values({
    id: row.id,
    organizationId: scoped.organizationId,
    eventKey: row.eventKey,
    sourceRef: row.sourceRef,
    symbolScope: row.symbolScope,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  const rows = await ex
    .select()
    .from(pgSchema.traderEventRecord)
    .where(
      and(
        eq(pgSchema.traderEventRecord.id, row.id),
        orgScopedWhere(pgSchema.traderEventRecord.organizationId, scoped),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("[trader] event record insert failed");
  }
  return mapEventRecord(rows[0]);
}

export async function insertEventClassificationPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEventClassificationRow,
): Promise<EventClassificationRow> {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderEventClassification).values({
    id: row.id,
    organizationId: scoped.organizationId,
    eventRecordId: row.eventRecordId,
    classificationKind: row.classificationKind,
    ruleId: row.ruleId,
    confidence: row.confidence,
    rationaleJson: row.rationaleJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  const rows = await ex
    .select()
    .from(pgSchema.traderEventClassification)
    .where(
      and(
        eq(pgSchema.traderEventClassification.id, row.id),
        orgScopedWhere(pgSchema.traderEventClassification.organizationId, scoped),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("[trader] event classification insert failed");
  }
  return {
    id: rows[0].id,
    organizationId: rows[0].organizationId,
    eventRecordId: rows[0].eventRecordId,
    classificationKind: rows[0].classificationKind,
    ruleId: rows[0].ruleId,
    confidence: rows[0].confidence,
    rationaleJson: rows[0].rationaleJson,
    contentDigest: rows[0].contentDigest,
    createdAt: rows[0].createdAt,
  };
}

export async function insertEventAttributionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEventAttributionRow,
): Promise<EventAttributionRow> {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderEventAttribution).values({
    id: row.id,
    organizationId: scoped.organizationId,
    eventRecordId: row.eventRecordId,
    subjectRef: row.subjectRef,
    subjectKind: row.subjectKind,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    attributionStrength: row.attributionStrength,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  const rows = await ex
    .select()
    .from(pgSchema.traderEventAttribution)
    .where(
      and(
        eq(pgSchema.traderEventAttribution.id, row.id),
        orgScopedWhere(pgSchema.traderEventAttribution.organizationId, scoped),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("[trader] event attribution insert failed");
  }
  return {
    id: rows[0].id,
    organizationId: rows[0].organizationId,
    eventRecordId: rows[0].eventRecordId,
    subjectRef: rows[0].subjectRef,
    subjectKind: rows[0].subjectKind,
    windowStart: rows[0].windowStart,
    windowEnd: rows[0].windowEnd,
    attributionStrength: rows[0].attributionStrength,
    contentDigest: rows[0].contentDigest,
    createdAt: rows[0].createdAt,
  };
}

export async function insertEventAttributionConfidencePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEventAttributionConfidenceRow,
): Promise<EventAttributionConfidenceRow> {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderEventAttributionConfidence).values({
    id: row.id,
    organizationId: scoped.organizationId,
    eventRecordId: row.eventRecordId,
    subjectRef: row.subjectRef,
    confidenceMean: row.confidenceMean,
    confidenceBandLow: row.confidenceBandLow,
    confidenceBandHigh: row.confidenceBandHigh,
    priorSupporting: row.priorSupporting,
    priorContradicting: row.priorContradicting,
    rationaleJson: row.rationaleJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  const rows = await ex
    .select()
    .from(pgSchema.traderEventAttributionConfidence)
    .where(
      and(
        eq(pgSchema.traderEventAttributionConfidence.id, row.id),
        orgScopedWhere(pgSchema.traderEventAttributionConfidence.organizationId, scoped),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("[trader] event attribution confidence insert failed");
  }
  return {
    id: rows[0].id,
    organizationId: rows[0].organizationId,
    eventRecordId: rows[0].eventRecordId,
    subjectRef: rows[0].subjectRef,
    confidenceMean: rows[0].confidenceMean,
    confidenceBandLow: rows[0].confidenceBandLow,
    confidenceBandHigh: rows[0].confidenceBandHigh,
    priorSupporting: rows[0].priorSupporting,
    priorContradicting: rows[0].priorContradicting,
    rationaleJson: rows[0].rationaleJson,
    contentDigest: rows[0].contentDigest,
    createdAt: rows[0].createdAt,
  };
}

export async function insertEventExplanationPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEventExplanationRow,
): Promise<EventExplanationRow> {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderEventExplanation).values({
    id: row.id,
    organizationId: scoped.organizationId,
    subjectRef: row.subjectRef,
    priceMoveJson: row.priceMoveJson,
    eventRefsJson: row.eventRefsJson,
    patternRefsJson: row.patternRefsJson,
    scoreBreakdownJson: row.scoreBreakdownJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  const rows = await ex
    .select()
    .from(pgSchema.traderEventExplanation)
    .where(
      and(
        eq(pgSchema.traderEventExplanation.id, row.id),
        orgScopedWhere(pgSchema.traderEventExplanation.organizationId, scoped),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new Error("[trader] event explanation insert failed");
  }
  return {
    id: rows[0].id,
    organizationId: rows[0].organizationId,
    subjectRef: rows[0].subjectRef,
    priceMoveJson: rows[0].priceMoveJson,
    eventRefsJson: rows[0].eventRefsJson,
    patternRefsJson: rows[0].patternRefsJson,
    scoreBreakdownJson: rows[0].scoreBreakdownJson,
    contentDigest: rows[0].contentDigest,
    createdAt: rows[0].createdAt,
  };
}

export async function insertExternalEventFactPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: {
    id: string;
    subjectRef: string;
    payloadJson: string;
    eventTime: Date;
    contentDigest: string;
    createdAt: Date;
  },
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderMarketFacts).values({
    id: row.id,
    organizationId: scoped.organizationId,
    factKind: "external_event_ingest_v1",
    subjectRef: row.subjectRef,
    schemaVersion: "waia.trader.external-event-ingest.v1",
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
}
