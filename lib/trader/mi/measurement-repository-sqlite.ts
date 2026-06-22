import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderMiMeasurement } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { MiMeasurement, MiMeasurementKind } from "@/lib/trader/mi/measurement.types";
import type { InsertMeasurementRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapMeasurement(row: typeof traderMiMeasurement.$inferSelect): MiMeasurement {
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

export function getLatestMeasurementSqlite(
  db: WaiaDb,
  context: OrgContext,
  measurementKey: string,
): MiMeasurement | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiMeasurement)
    .where(
      and(
        eq(traderMiMeasurement.measurementKey, measurementKey),
        orgScopedWhere(traderMiMeasurement.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiMeasurement.versionSeq))
    .limit(1)
    .all()[0];

  return row ? mapMeasurement(row) : null;
}

export function listMeasurementHistorySqlite(
  db: WaiaDb,
  context: OrgContext,
  measurementKey: string,
): MiMeasurement[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiMeasurement)
    .where(
      and(
        eq(traderMiMeasurement.measurementKey, measurementKey),
        orgScopedWhere(traderMiMeasurement.organizationId, scoped),
      ),
    )
    .orderBy(traderMiMeasurement.versionSeq)
    .all()
    .map(mapMeasurement);
}

export function listMeasurementsSqlite(
  db: WaiaDb,
  context: OrgContext,
  measurementKind?: MiMeasurementKind,
): MiMeasurement[] {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(traderMiMeasurement.organizationId, scoped)];
  if (measurementKind) {
    conditions.push(eq(traderMiMeasurement.measurementKind, measurementKind));
  }
  return db
    .select()
    .from(traderMiMeasurement)
    .where(and(...conditions))
    .orderBy(traderMiMeasurement.name, traderMiMeasurement.versionSeq)
    .all()
    .map(mapMeasurement);
}

export function findMeasurementByDigestSqlite(
  db: WaiaDb,
  context: OrgContext,
  definitionDigest: string,
): MiMeasurement | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiMeasurement)
    .where(
      and(
        eq(traderMiMeasurement.definitionDigest, definitionDigest),
        orgScopedWhere(traderMiMeasurement.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapMeasurement(row) : null;
}

export function insertMeasurementVersionSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertMeasurementRow,
): MiMeasurement {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiMeasurement)
    .values({
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
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiMeasurement)
    .where(
      and(
        eq(traderMiMeasurement.id, row.id),
        orgScopedWhere(traderMiMeasurement.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi measurement insert failed");
  }
  return mapMeasurement(inserted);
}
