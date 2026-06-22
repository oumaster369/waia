import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { traderMiSource, traderMiSourceTrust } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { MiSourceIdentity, MiSourceStatus } from "@/lib/trader/mi/mi-source.types";
import type { TrustRevision } from "@/lib/trader/mi/source-trust.types";
import type { InsertTrustRevisionRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapSource(row: typeof traderMiSource.$inferSelect): MiSourceIdentity {
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

function mapTrust(row: typeof traderMiSourceTrust.$inferSelect): TrustRevision {
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
    ? isNull(traderMiSource.symbol)
    : eq(traderMiSource.symbol, symbol);
}

export function findSourceByLogicalKeySqlite(
  db: WaiaDb,
  context: OrgContext,
  venue: string,
  feedKind: string,
  symbol: string | null,
): MiSourceIdentity | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiSource)
    .where(
      and(
        orgScopedWhere(traderMiSource.organizationId, scoped),
        eq(traderMiSource.venue, venue),
        eq(traderMiSource.feedKind, feedKind),
        symbolCondition(symbol),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSource(row) : null;
}

export function getSourceByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  sourceId: string,
): MiSourceIdentity | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiSource)
    .where(
      and(eq(traderMiSource.id, sourceId), orgScopedWhere(traderMiSource.organizationId, scoped)),
    )
    .limit(1)
    .all()[0];

  return row ? mapSource(row) : null;
}

export function insertSourceSqlite(
  db: WaiaDb,
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
): MiSourceIdentity {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiSource)
    .values({
      id,
      organizationId: scoped.organizationId,
      venue: input.venue,
      feedKind: input.feedKind,
      symbol: input.symbol,
      description: input.description,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = getSourceByIdSqlite(db, scoped, id);
  if (!row) {
    throw new Error("[trader] mi source insert failed");
  }
  return row;
}

export function updateSourceStatusSqlite(
  db: WaiaDb,
  context: OrgContext,
  sourceId: string,
  status: MiSourceStatus,
  now: Date,
): MiSourceIdentity | null {
  const scoped = requireOrgContext(context.organizationId);
  const existing = getSourceByIdSqlite(db, scoped, sourceId);
  if (!existing) {
    return null;
  }

  db.update(traderMiSource)
    .set({ status, updatedAt: now })
    .where(
      and(eq(traderMiSource.id, sourceId), orgScopedWhere(traderMiSource.organizationId, scoped)),
    )
    .run();

  return getSourceByIdSqlite(db, scoped, sourceId);
}

export function listSourcesSqlite(db: WaiaDb, context: OrgContext): MiSourceIdentity[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiSource)
    .where(orgScopedWhere(traderMiSource.organizationId, scoped))
    .all()
    .map(mapSource);
}

export function getLatestTrustRevisionSqlite(
  db: WaiaDb,
  context: OrgContext,
  sourceId: string,
): TrustRevision | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiSourceTrust)
    .where(
      and(
        eq(traderMiSourceTrust.sourceId, sourceId),
        orgScopedWhere(traderMiSourceTrust.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiSourceTrust.revisionSeq))
    .limit(1)
    .all()[0];

  return row ? mapTrust(row) : null;
}

export function listTrustHistorySqlite(
  db: WaiaDb,
  context: OrgContext,
  sourceId: string,
): TrustRevision[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiSourceTrust)
    .where(
      and(
        eq(traderMiSourceTrust.sourceId, sourceId),
        orgScopedWhere(traderMiSourceTrust.organizationId, scoped),
      ),
    )
    .orderBy(traderMiSourceTrust.revisionSeq)
    .all()
    .map(mapTrust);
}

export function insertTrustRevisionSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertTrustRevisionRow,
): TrustRevision {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiSourceTrust)
    .values({
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
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiSourceTrust)
    .where(
      and(
        eq(traderMiSourceTrust.id, row.id),
        orgScopedWhere(traderMiSourceTrust.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi source trust insert failed");
  }
  return mapTrust(inserted);
}
