import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import { traderMiEvidence } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { MiEvidence, MiEvidenceDirection } from "@/lib/trader/mi/evidence.types";
import type { InsertEvidenceRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapEvidence(row: typeof traderMiEvidence.$inferSelect): MiEvidence {
  return {
    id: row.id,
    organizationId: row.organizationId,
    evidenceKind: row.evidenceKind,
    direction: row.direction,
    hypothesisId: row.hypothesisId,
    hypothesisKey: row.hypothesisKey,
    hypothesisDefinitionDigest: row.hypothesisDefinitionDigest,
    measurementRefsJson: row.measurementRefsJson,
    observationRefsJson: row.observationRefsJson,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    recordedBy: row.recordedBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    nullComparatorRef: row.nullComparatorRef,
    regimeContextRef: row.regimeContextRef,
    trialRegistrationRef: row.trialRegistrationRef,
    createdAt: row.createdAt,
  };
}

export function getLatestEvidenceSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiEvidence | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiEvidence)
    .where(
      and(
        eq(traderMiEvidence.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiEvidence.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiEvidence.seq))
    .limit(1)
    .all()[0];

  return row ? mapEvidence(row) : null;
}

export function listEvidenceSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiEvidence[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiEvidence)
    .where(
      and(
        eq(traderMiEvidence.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiEvidence.organizationId, scoped),
      ),
    )
    .orderBy(traderMiEvidence.seq)
    .all()
    .map(mapEvidence);
}

export function listEvidenceByDirectionSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
  direction: MiEvidenceDirection,
): MiEvidence[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiEvidence)
    .where(
      and(
        eq(traderMiEvidence.hypothesisKey, hypothesisKey),
        eq(traderMiEvidence.direction, direction),
        orgScopedWhere(traderMiEvidence.organizationId, scoped),
      ),
    )
    .orderBy(traderMiEvidence.seq)
    .all()
    .map(mapEvidence);
}

export function findEvidenceByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  evidenceId: string,
): MiEvidence | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiEvidence)
    .where(
      and(
        eq(traderMiEvidence.id, evidenceId),
        orgScopedWhere(traderMiEvidence.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapEvidence(row) : null;
}

export function insertEvidenceSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertEvidenceRow,
): MiEvidence {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiEvidence)
    .values({
      id: row.id,
      organizationId: scoped.organizationId,
      evidenceKind: row.evidenceKind,
      direction: row.direction,
      hypothesisId: row.hypothesisId,
      hypothesisKey: row.hypothesisKey,
      hypothesisDefinitionDigest: row.hypothesisDefinitionDigest,
      measurementRefsJson: row.measurementRefsJson,
      observationRefsJson: row.observationRefsJson,
      eventTime: row.eventTime,
      ingestTime: row.ingestTime,
      recordedBy: row.recordedBy,
      seq: row.seq,
      contentDigest: row.contentDigest,
      nullComparatorRef: row.nullComparatorRef,
      regimeContextRef: row.regimeContextRef,
      trialRegistrationRef: row.trialRegistrationRef,
      createdAt: row.createdAt,
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiEvidence)
    .where(
      and(eq(traderMiEvidence.id, row.id), orgScopedWhere(traderMiEvidence.organizationId, scoped)),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi evidence insert failed");
  }
  return mapEvidence(inserted);
}
