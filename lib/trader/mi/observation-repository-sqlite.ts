import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderMiObservation } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { MiObservationKind, PitObservation } from "@/lib/trader/mi/observation.types";
import type { InsertObservationRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapObservation(row: typeof traderMiObservation.$inferSelect): PitObservation {
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

export function getLatestObservationSqlite(
  db: WaiaDb,
  context: OrgContext,
  observationKey: string,
): PitObservation | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiObservation)
    .where(
      and(
        eq(traderMiObservation.observationKey, observationKey),
        orgScopedWhere(traderMiObservation.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiObservation.revisionSeq))
    .limit(1)
    .all()[0];

  return row ? mapObservation(row) : null;
}

export function listObservationHistorySqlite(
  db: WaiaDb,
  context: OrgContext,
  observationKey: string,
): PitObservation[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiObservation)
    .where(
      and(
        eq(traderMiObservation.observationKey, observationKey),
        orgScopedWhere(traderMiObservation.organizationId, scoped),
      ),
    )
    .orderBy(traderMiObservation.revisionSeq)
    .all()
    .map(mapObservation);
}

export function listObservationsSqlite(
  db: WaiaDb,
  context: OrgContext,
  observationKind?: MiObservationKind,
): PitObservation[] {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(traderMiObservation.organizationId, scoped)];
  if (observationKind) {
    conditions.push(eq(traderMiObservation.observationKind, observationKind));
  }
  return db
    .select()
    .from(traderMiObservation)
    .where(and(...conditions))
    .orderBy(desc(traderMiObservation.eventTime))
    .all()
    .map(mapObservation);
}

export function insertObservationSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertObservationRow,
): PitObservation {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiObservation)
    .values({
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
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiObservation)
    .where(
      and(
        eq(traderMiObservation.id, row.id),
        orgScopedWhere(traderMiObservation.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi observation insert failed");
  }
  return mapObservation(inserted);
}
