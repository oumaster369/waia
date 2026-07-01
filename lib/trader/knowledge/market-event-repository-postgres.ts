import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { InsertMarketEventRow, MarketEvent } from "@/lib/trader/knowledge/knowledge.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapMarketEvent(row: typeof pgSchema.traderMarketEvents.$inferSelect): MarketEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventKind: row.eventKind,
    subjectRef: row.subjectRef,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    confidence: row.confidence,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function insertMarketEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertMarketEventRow,
): Promise<MarketEvent> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMarketEvents).values({
    id: row.id,
    organizationId: scoped.organizationId,
    eventKind: row.eventKind,
    subjectRef: row.subjectRef,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    confidence: row.confidence,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMarketEvents)
    .where(
      and(
        eq(pgSchema.traderMarketEvents.id, row.id),
        orgScopedWhere(pgSchema.traderMarketEvents.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] market event insert failed");
  }
  return mapMarketEvent(rows[0]);
}

export async function findMarketEventByDigestPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  contentDigest: string,
): Promise<MarketEvent | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMarketEvents)
    .where(
      and(
        eq(pgSchema.traderMarketEvents.contentDigest, contentDigest),
        orgScopedWhere(pgSchema.traderMarketEvents.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapMarketEvent(rows[0]) : null;
}
