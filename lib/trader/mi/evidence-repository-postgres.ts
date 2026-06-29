import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiEvidence, MiEvidenceDirection } from "@/lib/trader/mi/evidence.types";
import type { InsertEvidenceRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapEvidence(row: typeof pgSchema.traderMiEvidence.$inferSelect): MiEvidence {
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

export async function getLatestEvidencePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiEvidence | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiEvidence)
    .where(
      and(
        eq(pgSchema.traderMiEvidence.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiEvidence.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiEvidence.seq))
    .limit(1);

  return rows[0] ? mapEvidence(rows[0]) : null;
}

export async function listEvidencePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiEvidence[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiEvidence)
    .where(
      and(
        eq(pgSchema.traderMiEvidence.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiEvidence.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiEvidence.seq);

  return rows.map(mapEvidence);
}

export async function listEvidenceByDirectionPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
  direction: MiEvidenceDirection,
): Promise<MiEvidence[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiEvidence)
    .where(
      and(
        eq(pgSchema.traderMiEvidence.hypothesisKey, hypothesisKey),
        eq(pgSchema.traderMiEvidence.direction, direction),
        orgScopedWhere(pgSchema.traderMiEvidence.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiEvidence.seq);

  return rows.map(mapEvidence);
}

export async function findEvidenceByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  evidenceId: string,
): Promise<MiEvidence | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiEvidence)
    .where(
      and(
        eq(pgSchema.traderMiEvidence.id, evidenceId),
        orgScopedWhere(pgSchema.traderMiEvidence.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapEvidence(rows[0]) : null;
}

export async function insertEvidencePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEvidenceRow,
): Promise<MiEvidence> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiEvidence).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiEvidence)
    .where(
      and(
        eq(pgSchema.traderMiEvidence.id, row.id),
        orgScopedWhere(pgSchema.traderMiEvidence.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi evidence insert failed");
  }
  return mapEvidence(rows[0]);
}
