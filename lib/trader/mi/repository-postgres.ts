import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, isNull } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiSourceIdentity, MiSourceStatus } from "@/lib/trader/mi/mi-source.types";
import type { TrustRevision } from "@/lib/trader/mi/source-trust.types";
import type { InsertTrustRevisionRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapSource(row: typeof pgSchema.traderMiSource.$inferSelect): MiSourceIdentity {
  return {
    id: row.id,
    organizationId: row.organizationId,
    venue: row.venue,
    feedKind: row.feedKind,
    symbol: row.symbol,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTrust(row: typeof pgSchema.traderMiSourceTrust.$inferSelect): TrustRevision {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceId: row.sourceId,
    trustScore: row.trustScore,
    rationale: row.rationale,
    recordedBy: row.recordedBy,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    revisionOf: row.revisionOf,
    revisionSeq: row.revisionSeq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

function symbolCondition(symbol: string | null) {
  return symbol === null || symbol === ""
    ? isNull(pgSchema.traderMiSource.symbol)
    : eq(pgSchema.traderMiSource.symbol, symbol);
}

export async function findSourceByLogicalKeyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  venue: string,
  feedKind: string,
  symbol: string | null,
): Promise<MiSourceIdentity | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiSource)
    .where(
      and(
        orgScopedWhere(pgSchema.traderMiSource.organizationId, scoped),
        eq(pgSchema.traderMiSource.venue, venue),
        eq(pgSchema.traderMiSource.feedKind, feedKind),
        symbolCondition(symbol),
      ),
    )
    .limit(1);

  return rows[0] ? mapSource(rows[0]) : null;
}

export async function getSourceByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  sourceId: string,
): Promise<MiSourceIdentity | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiSource)
    .where(
      and(
        eq(pgSchema.traderMiSource.id, sourceId),
        orgScopedWhere(pgSchema.traderMiSource.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapSource(rows[0]) : null;
}

export async function insertSourcePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: {
    venue: string;
    feedKind: string;
    symbol: string | null;
    description: string | null;
    status: MiSourceStatus;
  },
  id: string,
  now: Date,
): Promise<MiSourceIdentity> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiSource).values({
    id,
    organizationId: scoped.organizationId,
    venue: input.venue,
    feedKind: input.feedKind,
    symbol: input.symbol,
    description: input.description,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getSourceByIdPostgres(ex, scoped, id);
  if (!row) {
    throw new Error("[trader] mi source insert failed");
  }
  return row;
}

export async function updateSourceStatusPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  sourceId: string,
  status: MiSourceStatus,
  now: Date,
): Promise<MiSourceIdentity | null> {
  const scoped = requireOrgContext(context.organizationId);
  const existing = await getSourceByIdPostgres(ex, scoped, sourceId);
  if (!existing) {
    return null;
  }

  await ex
    .update(pgSchema.traderMiSource)
    .set({ status, updatedAt: now })
    .where(
      and(
        eq(pgSchema.traderMiSource.id, sourceId),
        orgScopedWhere(pgSchema.traderMiSource.organizationId, scoped),
      ),
    );

  return getSourceByIdPostgres(ex, scoped, sourceId);
}

export async function listSourcesPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
): Promise<MiSourceIdentity[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiSource)
    .where(orgScopedWhere(pgSchema.traderMiSource.organizationId, scoped));

  return rows.map(mapSource);
}

export async function getLatestTrustRevisionPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  sourceId: string,
): Promise<TrustRevision | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiSourceTrust)
    .where(
      and(
        eq(pgSchema.traderMiSourceTrust.sourceId, sourceId),
        orgScopedWhere(pgSchema.traderMiSourceTrust.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiSourceTrust.revisionSeq))
    .limit(1);

  return rows[0] ? mapTrust(rows[0]) : null;
}

export async function listTrustHistoryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  sourceId: string,
): Promise<TrustRevision[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiSourceTrust)
    .where(
      and(
        eq(pgSchema.traderMiSourceTrust.sourceId, sourceId),
        orgScopedWhere(pgSchema.traderMiSourceTrust.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiSourceTrust.revisionSeq);

  return rows.map(mapTrust);
}

export async function insertTrustRevisionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertTrustRevisionRow,
): Promise<TrustRevision> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiSourceTrust).values({
    id: row.id,
    organizationId: scoped.organizationId,
    sourceId: row.sourceId,
    trustScore: row.trustScore,
    rationale: row.rationale,
    recordedBy: row.recordedBy,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    revisionOf: row.revisionOf,
    revisionSeq: row.revisionSeq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiSourceTrust)
    .where(
      and(
        eq(pgSchema.traderMiSourceTrust.id, row.id),
        orgScopedWhere(pgSchema.traderMiSourceTrust.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi source trust insert failed");
  }
  return mapTrust(rows[0]);
}
