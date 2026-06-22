import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderMiHypothesis, traderMiHypothesisLifecycle } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  MiHypothesis,
  MiHypothesisKind,
  MiHypothesisLifecycleEvent,
} from "@/lib/trader/mi/hypothesis.types";
import type { InsertHypothesisLifecycleRow, InsertHypothesisRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapHypothesis(row: typeof traderMiHypothesis.$inferSelect): MiHypothesis {
  return {
    id: row.id,
    organizationId: row.organizationId,
    hypothesisKind: row.hypothesisKind,
    hypothesisKey: row.hypothesisKey,
    name: row.name,
    schemaVersion: row.schemaVersion as MiHypothesis["schemaVersion"],
    definitionJson: row.definitionJson,
    definitionDigest: row.definitionDigest,
    supersedesJson: row.supersedesJson,
    versionSeq: row.versionSeq,
    revisionOf: row.revisionOf,
    authoredBy: row.authoredBy,
    createdAt: row.createdAt,
  };
}

function mapLifecycle(
  row: typeof traderMiHypothesisLifecycle.$inferSelect,
): MiHypothesisLifecycleEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    hypothesisId: row.hypothesisId,
    hypothesisKey: row.hypothesisKey,
    lifecycleState: row.lifecycleState,
    rationale: row.rationale,
    recordedBy: row.recordedBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export function getLatestHypothesisSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiHypothesis | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiHypothesis)
    .where(
      and(
        eq(traderMiHypothesis.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiHypothesis.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiHypothesis.versionSeq))
    .limit(1)
    .all()[0];

  return row ? mapHypothesis(row) : null;
}

export function listHypothesisHistorySqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiHypothesis[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiHypothesis)
    .where(
      and(
        eq(traderMiHypothesis.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiHypothesis.organizationId, scoped),
      ),
    )
    .orderBy(traderMiHypothesis.versionSeq)
    .all()
    .map(mapHypothesis);
}

export function listHypothesesSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKind?: MiHypothesisKind,
): MiHypothesis[] {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(traderMiHypothesis.organizationId, scoped)];
  if (hypothesisKind) {
    conditions.push(eq(traderMiHypothesis.hypothesisKind, hypothesisKind));
  }
  return db
    .select()
    .from(traderMiHypothesis)
    .where(and(...conditions))
    .orderBy(traderMiHypothesis.name, traderMiHypothesis.versionSeq)
    .all()
    .map(mapHypothesis);
}

export function findHypothesisByDigestSqlite(
  db: WaiaDb,
  context: OrgContext,
  definitionDigest: string,
): MiHypothesis | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiHypothesis)
    .where(
      and(
        eq(traderMiHypothesis.definitionDigest, definitionDigest),
        orgScopedWhere(traderMiHypothesis.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapHypothesis(row) : null;
}

export function findHypothesisByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisId: string,
): MiHypothesis | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiHypothesis)
    .where(
      and(
        eq(traderMiHypothesis.id, hypothesisId),
        orgScopedWhere(traderMiHypothesis.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapHypothesis(row) : null;
}

export function getLatestLifecycleEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiHypothesisLifecycleEvent | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiHypothesisLifecycle)
    .where(
      and(
        eq(traderMiHypothesisLifecycle.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiHypothesisLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiHypothesisLifecycle.seq))
    .limit(1)
    .all()[0];

  return row ? mapLifecycle(row) : null;
}

export function listLifecycleEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiHypothesisLifecycleEvent[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiHypothesisLifecycle)
    .where(
      and(
        eq(traderMiHypothesisLifecycle.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiHypothesisLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(traderMiHypothesisLifecycle.seq)
    .all()
    .map(mapLifecycle);
}

export function insertHypothesisVersionSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertHypothesisRow,
): MiHypothesis {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiHypothesis)
    .values({
      id: row.id,
      organizationId: scoped.organizationId,
      hypothesisKind: row.hypothesisKind,
      hypothesisKey: row.hypothesisKey,
      name: row.name,
      schemaVersion: row.schemaVersion,
      definitionJson: row.definitionJson,
      definitionDigest: row.definitionDigest,
      supersedesJson: row.supersedesJson,
      versionSeq: row.versionSeq,
      revisionOf: row.revisionOf,
      authoredBy: row.authoredBy,
      createdAt: row.createdAt,
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiHypothesis)
    .where(
      and(
        eq(traderMiHypothesis.id, row.id),
        orgScopedWhere(traderMiHypothesis.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi hypothesis insert failed");
  }
  return mapHypothesis(inserted);
}

export function insertLifecycleEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertHypothesisLifecycleRow,
): MiHypothesisLifecycleEvent {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiHypothesisLifecycle)
    .values({
      id: row.id,
      organizationId: scoped.organizationId,
      hypothesisId: row.hypothesisId,
      hypothesisKey: row.hypothesisKey,
      lifecycleState: row.lifecycleState,
      rationale: row.rationale,
      recordedBy: row.recordedBy,
      seq: row.seq,
      contentDigest: row.contentDigest,
      createdAt: row.createdAt,
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiHypothesisLifecycle)
    .where(
      and(
        eq(traderMiHypothesisLifecycle.id, row.id),
        orgScopedWhere(traderMiHypothesisLifecycle.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi hypothesis lifecycle insert failed");
  }
  return mapLifecycle(inserted);
}
