import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiMeasurement, MiMeasurementKind } from "@/lib/trader/mi/measurement.types";
import type { InsertMeasurementRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapMeasurement(row: typeof pgSchema.traderMiMeasurement.$inferSelect): MiMeasurement {
  return {
    id: row.id,
    organizationId: row.organizationId,
    measurementKind: row.measurementKind,
    measurementKey: row.measurementKey,
    name: row.name,
    schemaVersion: row.schemaVersion as MiMeasurement["schemaVersion"],
    definitionJson: row.definitionJson,
    definitionDigest: row.definitionDigest,
    versionSeq: row.versionSeq,
    revisionOf: row.revisionOf,
    authoredBy: row.authoredBy,
    createdAt: row.createdAt,
  };
}

export async function getLatestMeasurementPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  measurementKey: string,
): Promise<MiMeasurement | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiMeasurement)
    .where(
      and(
        eq(pgSchema.traderMiMeasurement.measurementKey, measurementKey),
        orgScopedWhere(pgSchema.traderMiMeasurement.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiMeasurement.versionSeq))
    .limit(1);

  return rows[0] ? mapMeasurement(rows[0]) : null;
}

export async function listMeasurementHistoryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  measurementKey: string,
): Promise<MiMeasurement[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiMeasurement)
    .where(
      and(
        eq(pgSchema.traderMiMeasurement.measurementKey, measurementKey),
        orgScopedWhere(pgSchema.traderMiMeasurement.organizationId, scoped),
      ),
    )
    .orderBy(asc(pgSchema.traderMiMeasurement.versionSeq));

  return rows.map(mapMeasurement);
}

export async function listMeasurementsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  measurementKind?: MiMeasurementKind,
): Promise<MiMeasurement[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderMiMeasurement.organizationId, scoped)];
  if (measurementKind) {
    conditions.push(eq(pgSchema.traderMiMeasurement.measurementKind, measurementKind));
  }
  const rows = await ex
    .select()
    .from(pgSchema.traderMiMeasurement)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.traderMiMeasurement.name), asc(pgSchema.traderMiMeasurement.versionSeq));

  return rows.map(mapMeasurement);
}

export async function findMeasurementByDigestPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  definitionDigest: string,
): Promise<MiMeasurement | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiMeasurement)
    .where(
      and(
        eq(pgSchema.traderMiMeasurement.definitionDigest, definitionDigest),
        orgScopedWhere(pgSchema.traderMiMeasurement.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapMeasurement(rows[0]) : null;
}

export async function insertMeasurementVersionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertMeasurementRow,
): Promise<MiMeasurement> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiMeasurement).values({
    id: row.id,
    organizationId: scoped.organizationId,
    measurementKind: row.measurementKind,
    measurementKey: row.measurementKey,
    name: row.name,
    schemaVersion: row.schemaVersion,
    definitionJson: row.definitionJson,
    definitionDigest: row.definitionDigest,
    versionSeq: row.versionSeq,
    revisionOf: row.revisionOf,
    authoredBy: row.authoredBy,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiMeasurement)
    .where(
      and(
        eq(pgSchema.traderMiMeasurement.id, row.id),
        orgScopedWhere(pgSchema.traderMiMeasurement.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi measurement insert failed");
  }
  return mapMeasurement(rows[0]);
}
