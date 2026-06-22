import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderMiPattern, traderMiPatternLifecycle } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  MiPattern,
  MiPatternKind,
  MiPatternLifecycleEvent,
} from "@/lib/trader/mi/pattern.types";
import type { InsertPatternLifecycleRow, InsertPatternRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapPattern(row: typeof traderMiPattern.$inferSelect): MiPattern {
  return {
    id: row.id,
    organizationId: row.organizationId,
    patternKind: row.patternKind,
    patternKey: row.patternKey,
    name: row.name,
    schemaVersion: row.schemaVersion as MiPattern["schemaVersion"],
    definitionJson: row.definitionJson,
    definitionDigest: row.definitionDigest,
    structuralSignature: row.structuralSignature,
    trialBudgetMax: row.trialBudgetMax,
    versionSeq: row.versionSeq,
    revisionOf: row.revisionOf,
    authoredBy: row.authoredBy,
    createdAt: row.createdAt,
  };
}

function mapLifecycle(row: typeof traderMiPatternLifecycle.$inferSelect): MiPatternLifecycleEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    patternId: row.patternId,
    patternKey: row.patternKey,
    lifecycleState: row.lifecycleState,
    rationale: row.rationale,
    recordedBy: row.recordedBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export function getLatestPatternSqlite(
  db: WaiaDb,
  context: OrgContext,
  patternKey: string,
): MiPattern | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiPattern)
    .where(
      and(
        eq(traderMiPattern.patternKey, patternKey),
        orgScopedWhere(traderMiPattern.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiPattern.versionSeq))
    .limit(1)
    .all()[0];

  return row ? mapPattern(row) : null;
}

export function listPatternHistorySqlite(
  db: WaiaDb,
  context: OrgContext,
  patternKey: string,
): MiPattern[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiPattern)
    .where(
      and(
        eq(traderMiPattern.patternKey, patternKey),
        orgScopedWhere(traderMiPattern.organizationId, scoped),
      ),
    )
    .orderBy(traderMiPattern.versionSeq)
    .all()
    .map(mapPattern);
}

export function listPatternsSqlite(
  db: WaiaDb,
  context: OrgContext,
  patternKind?: MiPatternKind,
): MiPattern[] {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(traderMiPattern.organizationId, scoped)];
  if (patternKind) {
    conditions.push(eq(traderMiPattern.patternKind, patternKind));
  }
  return db
    .select()
    .from(traderMiPattern)
    .where(and(...conditions))
    .orderBy(traderMiPattern.name, traderMiPattern.versionSeq)
    .all()
    .map(mapPattern);
}

export function findPatternByDigestSqlite(
  db: WaiaDb,
  context: OrgContext,
  definitionDigest: string,
): MiPattern | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiPattern)
    .where(
      and(
        eq(traderMiPattern.definitionDigest, definitionDigest),
        orgScopedWhere(traderMiPattern.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapPattern(row) : null;
}

export function getLatestLifecycleEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  patternKey: string,
): MiPatternLifecycleEvent | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiPatternLifecycle)
    .where(
      and(
        eq(traderMiPatternLifecycle.patternKey, patternKey),
        orgScopedWhere(traderMiPatternLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiPatternLifecycle.seq))
    .limit(1)
    .all()[0];

  return row ? mapLifecycle(row) : null;
}

export function listLifecycleEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
  patternKey: string,
): MiPatternLifecycleEvent[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiPatternLifecycle)
    .where(
      and(
        eq(traderMiPatternLifecycle.patternKey, patternKey),
        orgScopedWhere(traderMiPatternLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(traderMiPatternLifecycle.seq)
    .all()
    .map(mapLifecycle);
}

/**
 * Returns a currently-ACTIVE family whose latest version carries the given structural
 * signature, or null. Used to reject structural duplicates among ACTIVE patterns (RC-3).
 */
export function findActivePatternByStructuralSignatureSqlite(
  db: WaiaDb,
  context: OrgContext,
  structuralSignature: string,
): MiPattern | null {
  const scoped = requireOrgContext(context.organizationId);
  const candidates = db
    .select()
    .from(traderMiPattern)
    .where(
      and(
        eq(traderMiPattern.structuralSignature, structuralSignature),
        orgScopedWhere(traderMiPattern.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiPattern.versionSeq))
    .all()
    .map(mapPattern);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.patternKey)) continue;
    seen.add(candidate.patternKey);

    const latest = getLatestPatternSqlite(db, scoped, candidate.patternKey);
    if (!latest || latest.structuralSignature !== structuralSignature) continue;

    const lifecycle = getLatestLifecycleEventSqlite(db, scoped, candidate.patternKey);
    if (lifecycle?.lifecycleState === "ACTIVE") {
      return latest;
    }
  }
  return null;
}

export function insertPatternVersionSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertPatternRow,
): MiPattern {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiPattern)
    .values({
      id: row.id,
      organizationId: scoped.organizationId,
      patternKind: row.patternKind,
      patternKey: row.patternKey,
      name: row.name,
      schemaVersion: row.schemaVersion,
      definitionJson: row.definitionJson,
      definitionDigest: row.definitionDigest,
      structuralSignature: row.structuralSignature,
      trialBudgetMax: row.trialBudgetMax,
      versionSeq: row.versionSeq,
      revisionOf: row.revisionOf,
      authoredBy: row.authoredBy,
      createdAt: row.createdAt,
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiPattern)
    .where(
      and(eq(traderMiPattern.id, row.id), orgScopedWhere(traderMiPattern.organizationId, scoped)),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi pattern insert failed");
  }
  return mapPattern(inserted);
}

export function insertLifecycleEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertPatternLifecycleRow,
): MiPatternLifecycleEvent {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiPatternLifecycle)
    .values({
      id: row.id,
      organizationId: scoped.organizationId,
      patternId: row.patternId,
      patternKey: row.patternKey,
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
    .from(traderMiPatternLifecycle)
    .where(
      and(
        eq(traderMiPatternLifecycle.id, row.id),
        orgScopedWhere(traderMiPatternLifecycle.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi pattern lifecycle insert failed");
  }
  return mapLifecycle(inserted);
}
