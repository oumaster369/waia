import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertPriceMoveExplanationRow,
  PriceMoveExplanation,
} from "@/lib/trader/knowledge/price-move-explanation.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapPriceMoveExplanation(
  row: typeof pgSchema.traderPriceMoveExplanation.$inferSelect,
): PriceMoveExplanation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectRef: row.subjectRef,
    priceMoveJson: row.priceMoveJson,
    patternRefsJson: row.patternRefsJson,
    scoreBreakdownJson: row.scoreBreakdownJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function insertPriceMoveExplanationPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertPriceMoveExplanationRow,
): Promise<PriceMoveExplanation> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderPriceMoveExplanation).values({
    id: row.id,
    organizationId: scoped.organizationId,
    subjectRef: row.subjectRef,
    priceMoveJson: row.priceMoveJson,
    patternRefsJson: row.patternRefsJson,
    scoreBreakdownJson: row.scoreBreakdownJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderPriceMoveExplanation)
    .where(
      and(
        eq(pgSchema.traderPriceMoveExplanation.id, row.id),
        orgScopedWhere(pgSchema.traderPriceMoveExplanation.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] price move explanation insert failed");
  }

  return mapPriceMoveExplanation(rows[0]);
}
