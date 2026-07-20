import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapHypothesis(row: typeof pgSchema.traderMiHypothesis.$inferSelect): MiHypothesis {
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
  row: typeof pgSchema.traderMiHypothesisLifecycle.$inferSelect,
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

export async function getLatestHypothesisPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiHypothesis | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesis)
    .where(
      and(
        eq(pgSchema.traderMiHypothesis.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiHypothesis.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiHypothesis.versionSeq))
    .limit(1);

  return rows[0] ? mapHypothesis(rows[0]) : null;
}

export async function listHypothesisHistoryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiHypothesis[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesis)
    .where(
      and(
        eq(pgSchema.traderMiHypothesis.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiHypothesis.organizationId, scoped),
      ),
    )
    .orderBy(asc(pgSchema.traderMiHypothesis.versionSeq));

  return rows.map(mapHypothesis);
}

export async function listHypothesesPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKind?: MiHypothesisKind,
): Promise<MiHypothesis[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderMiHypothesis.organizationId, scoped)];
  if (hypothesisKind) {
    conditions.push(eq(pgSchema.traderMiHypothesis.hypothesisKind, hypothesisKind));
  }
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesis)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.traderMiHypothesis.name), asc(pgSchema.traderMiHypothesis.versionSeq));

  return rows.map(mapHypothesis);
}

export async function findHypothesisByDigestPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  definitionDigest: string,
): Promise<MiHypothesis | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesis)
    .where(
      and(
        eq(pgSchema.traderMiHypothesis.definitionDigest, definitionDigest),
        orgScopedWhere(pgSchema.traderMiHypothesis.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapHypothesis(rows[0]) : null;
}

export async function findHypothesisByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisId: string,
): Promise<MiHypothesis | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesis)
    .where(
      and(
        eq(pgSchema.traderMiHypothesis.id, hypothesisId),
        orgScopedWhere(pgSchema.traderMiHypothesis.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapHypothesis(rows[0]) : null;
}

export async function getLatestLifecycleEventPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiHypothesisLifecycleEvent | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesisLifecycle)
    .where(
      and(
        eq(pgSchema.traderMiHypothesisLifecycle.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiHypothesisLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiHypothesisLifecycle.seq))
    .limit(1);

  return rows[0] ? mapLifecycle(rows[0]) : null;
}

export async function listLifecycleEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiHypothesisLifecycleEvent[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesisLifecycle)
    .where(
      and(
        eq(pgSchema.traderMiHypothesisLifecycle.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiHypothesisLifecycle.organizationId, scoped),
      ),
    )
    .orderBy(asc(pgSchema.traderMiHypothesisLifecycle.seq));

  return rows.map(mapLifecycle);
}

export async function insertHypothesisVersionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertHypothesisRow,
): Promise<MiHypothesis> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiHypothesis).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesis)
    .where(
      and(
        eq(pgSchema.traderMiHypothesis.id, row.id),
        orgScopedWhere(pgSchema.traderMiHypothesis.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi hypothesis insert failed");
  }
  return mapHypothesis(rows[0]);
}

export async function insertLifecycleEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertHypothesisLifecycleRow,
): Promise<MiHypothesisLifecycleEvent> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiHypothesisLifecycle).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiHypothesisLifecycle)
    .where(
      and(
        eq(pgSchema.traderMiHypothesisLifecycle.id, row.id),
        orgScopedWhere(pgSchema.traderMiHypothesisLifecycle.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi hypothesis lifecycle insert failed");
  }
  return mapLifecycle(rows[0]);
}
