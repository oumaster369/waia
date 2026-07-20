import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertMiPatternScoreEventRow,
  MiPatternScoreEvent,
} from "@/lib/trader/knowledge/price-move-explanation.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapPatternScoreEvent(
  row: typeof pgSchema.traderMiPatternScore.$inferSelect,
): MiPatternScoreEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    patternKey: row.patternKey,
    definitionDigest: row.definitionDigest,
    subjectRef: row.subjectRef,
    matchScore: row.matchScore,
    relevanceScore: row.relevanceScore,
    confidenceMean: row.confidenceMean,
    confidenceBandLow: row.confidenceBandLow,
    confidenceBandHigh: row.confidenceBandHigh,
    priorHits: row.priorHits,
    priorMisses: row.priorMisses,
    regime: row.regime,
    evaluatedAt: row.evaluatedAt,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function insertMiPatternScoreEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertMiPatternScoreEventRow,
): Promise<MiPatternScoreEvent> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiPatternScore).values({
    id: row.id,
    organizationId: scoped.organizationId,
    patternKey: row.patternKey,
    definitionDigest: row.definitionDigest,
    subjectRef: row.subjectRef,
    matchScore: row.matchScore,
    relevanceScore: row.relevanceScore,
    confidenceMean: row.confidenceMean,
    confidenceBandLow: row.confidenceBandLow,
    confidenceBandHigh: row.confidenceBandHigh,
    priorHits: row.priorHits,
    priorMisses: row.priorMisses,
    regime: row.regime,
    evaluatedAt: row.evaluatedAt,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiPatternScore)
    .where(
      and(
        eq(pgSchema.traderMiPatternScore.id, row.id),
        orgScopedWhere(pgSchema.traderMiPatternScore.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] pattern score event insert failed");
  }

  return mapPatternScoreEvent(rows[0]);
}
