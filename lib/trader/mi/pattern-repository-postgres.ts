import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapPattern(row: typeof pgSchema.traderMiPattern.$inferSelect): MiPattern {
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

function mapLifecycle(
  row: typeof pgSchema.traderMiPatternLifecycle.$inferSelect,
): MiPatternLifecycleEvent {
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

export async function getLatestPatternPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  patternKey: string,
): Promise<MiPattern | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiPattern)
    .where(
      and(
        eq(pgSchema.traderMiPattern.patternKey, patternKey),
        orgScopedWhere(pgSchema.traderMiPattern.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiPattern.versionSeq))
    .limit(1);

  return rows[0] ? mapPattern(rows[0]) : null;
}

export async function listPatternHistoryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  patternKey: string,
): Promise<MiPattern[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiPattern)
    .where(
      and(
        eq(pgSchema.traderMiPattern.patternKey, patternKey),
        orgScopedWhere(pgSchema.traderMiPattern.organizationId, scoped),
      ),
    )
    .orderBy(asc(pgSchema.traderMiPattern.versionSeq));

  return rows.map(mapPattern);
}

export async function listPatternsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  patternKind?: MiPatternKind,
): Promise<MiPattern[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderMiPattern.organizationId, scoped)];
  if (patternKind) {
    conditions.push(eq(pgSchema.traderMiPattern.patternKind, patternKind));
  }
  const rows = await ex
    .select()
    .from(pgSchema.traderMiPattern)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.traderMiPattern.name), asc(pgSchema.traderMiPattern.versionSeq));

  return rows.map(mapPattern);
}

export async function findPatternByDigestPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  definitionDigest: string,
): Promise<MiPattern | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiPattern)
    .where(
      and(
        eq(pgSchema.traderMiPattern.definitionDigest, definitionDigest),
        orgScopedWhere(pgSchema.traderMiPattern.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapPattern(rows[0]) : null;
}

export async function getLatestLifecycleEventPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  patternKey: string,
): Promise<MiPatternLifecycleEvent | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiPatternLifecycle)
    .where(
      and(
        eq(pgSchema.traderMiPatternLifecycle.patternKey, patternKey),
        orgScopedWhere(pgSchema.traderMiPatternLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiPatternLifecycle.seq))
    .limit(1);

  return rows[0] ? mapLifecycle(rows[0]) : null;
}

export async function listLifecycleEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  patternKey: string,
): Promise<MiPatternLifecycleEvent[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiPatternLifecycle)
    .where(
      and(
        eq(pgSchema.traderMiPatternLifecycle.patternKey, patternKey),
        orgScopedWhere(pgSchema.traderMiPatternLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(asc(pgSchema.traderMiPatternLifecycle.seq));

  return rows.map(mapLifecycle);
}

export async function findActivePatternByStructuralSignaturePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  structuralSignature: string,
): Promise<MiPattern | null> {
  const scoped = requireOrgContext(context.organizationId);
  const candidates = (
    await ex
      .select()
      .from(pgSchema.traderMiPattern)
      .where(
        and(
          eq(pgSchema.traderMiPattern.structuralSignature, structuralSignature),
          orgScopedWhere(pgSchema.traderMiPattern.organizationId, scoped),
        ),
      )
      .orderBy(desc(pgSchema.traderMiPattern.versionSeq))
  ).map(mapPattern);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.patternKey)) continue;
    seen.add(candidate.patternKey);

    const latest = await getLatestPatternPostgres(ex, scoped, candidate.patternKey);
    if (!latest || latest.structuralSignature !== structuralSignature) continue;

    const lifecycle = await getLatestLifecycleEventPostgres(ex, scoped, candidate.patternKey);
    if (lifecycle?.lifecycleState === "ACTIVE") {
      return latest;
    }
  }
  return null;
}

export async function insertPatternVersionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertPatternRow,
): Promise<MiPattern> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiPattern).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiPattern)
    .where(
      and(
        eq(pgSchema.traderMiPattern.id, row.id),
        orgScopedWhere(pgSchema.traderMiPattern.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi pattern insert failed");
  }
  return mapPattern(rows[0]);
}

export async function insertLifecycleEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertPatternLifecycleRow,
): Promise<MiPatternLifecycleEvent> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiPatternLifecycle).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiPatternLifecycle)
    .where(
      and(
        eq(pgSchema.traderMiPatternLifecycle.id, row.id),
        orgScopedWhere(pgSchema.traderMiPatternLifecycle.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi pattern lifecycle insert failed");
  }
  return mapLifecycle(rows[0]);
}
