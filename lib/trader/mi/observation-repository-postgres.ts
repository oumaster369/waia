import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiObservationKind, PitObservation } from "@/lib/trader/mi/observation.types";
import type { InsertObservationRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapObservation(row: typeof pgSchema.traderMiObservation.$inferSelect): PitObservation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceId: row.sourceId,
    observationKind: row.observationKind,
    observationKey: row.observationKey,
    subjectRef: row.subjectRef,
    schemaVersion: row.schemaVersion as PitObservation["schemaVersion"],
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    observedBy: row.observedBy,
    revisionOf: row.revisionOf,
    revisionSeq: row.revisionSeq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function getLatestObservationPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  observationKey: string,
): Promise<PitObservation | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(
      and(
        eq(pgSchema.traderMiObservation.observationKey, observationKey),
        orgScopedWhere(pgSchema.traderMiObservation.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiObservation.revisionSeq))
    .limit(1);

  return rows[0] ? mapObservation(rows[0]) : null;
}

export async function listObservationHistoryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  observationKey: string,
): Promise<PitObservation[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(
      and(
        eq(pgSchema.traderMiObservation.observationKey, observationKey),
        orgScopedWhere(pgSchema.traderMiObservation.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiObservation.revisionSeq);

  return rows.map(mapObservation);
}

export async function listObservationsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  observationKind?: MiObservationKind,
): Promise<PitObservation[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderMiObservation.organizationId, scoped)];
  if (observationKind) {
    conditions.push(eq(pgSchema.traderMiObservation.observationKind, observationKind));
  }
  const rows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.traderMiObservation.eventTime));

  return rows.map(mapObservation);
}

export async function findObservationByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  observationId: string,
): Promise<PitObservation | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(
      and(
        eq(pgSchema.traderMiObservation.id, observationId),
        orgScopedWhere(pgSchema.traderMiObservation.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapObservation(rows[0]) : null;
}

export async function insertObservationPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertObservationRow,
): Promise<PitObservation> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiObservation).values({
    id: row.id,
    organizationId: scoped.organizationId,
    sourceId: row.sourceId,
    observationKind: row.observationKind,
    observationKey: row.observationKey,
    subjectRef: row.subjectRef,
    schemaVersion: row.schemaVersion,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    observedBy: row.observedBy,
    revisionOf: row.revisionOf,
    revisionSeq: row.revisionSeq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiObservation)
    .where(
      and(
        eq(pgSchema.traderMiObservation.id, row.id),
        orgScopedWhere(pgSchema.traderMiObservation.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi observation insert failed");
  }
  return mapObservation(rows[0]);
}
