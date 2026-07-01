import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertMarketPredictionRow,
  MarketPrediction,
  MarketPredictionVerificationResult,
} from "@/lib/trader/knowledge/knowledge.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapMarketPrediction(
  row: typeof pgSchema.traderMarketPredictions.$inferSelect,
): MarketPrediction {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectRef: row.subjectRef,
    predictionJson: row.predictionJson,
    predictedAt: row.predictedAt,
    outcomeJson: row.outcomeJson,
    verifiedAt: row.verifiedAt,
    verificationResult: row.verificationResult as MarketPredictionVerificationResult | null,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function insertMarketPredictionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertMarketPredictionRow,
): Promise<MarketPrediction> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMarketPredictions).values({
    id: row.id,
    organizationId: scoped.organizationId,
    subjectRef: row.subjectRef,
    predictionJson: row.predictionJson,
    predictedAt: row.predictedAt,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMarketPredictions)
    .where(
      and(
        eq(pgSchema.traderMarketPredictions.id, row.id),
        orgScopedWhere(pgSchema.traderMarketPredictions.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] market prediction insert failed");
  }
  return mapMarketPrediction(rows[0]);
}

export async function getMarketPredictionByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  predictionId: string,
): Promise<MarketPrediction | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMarketPredictions)
    .where(
      and(
        eq(pgSchema.traderMarketPredictions.id, predictionId),
        orgScopedWhere(pgSchema.traderMarketPredictions.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapMarketPrediction(rows[0]) : null;
}

export async function listMarketPredictionsForSubjectPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  subjectRef: string,
  limit = 50,
): Promise<MarketPrediction[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMarketPredictions)
    .where(
      and(
        eq(pgSchema.traderMarketPredictions.subjectRef, subjectRef),
        orgScopedWhere(pgSchema.traderMarketPredictions.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMarketPredictions.predictedAt))
    .limit(limit);

  return rows.map(mapMarketPrediction);
}

export async function verifyMarketPredictionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  predictionId: string,
  input: {
    outcomeJson: string;
    verificationResult: MarketPredictionVerificationResult;
    verifiedAt: Date;
  },
): Promise<MarketPrediction> {
  const scoped = requireOrgContext(context.organizationId);

  await ex
    .update(pgSchema.traderMarketPredictions)
    .set({
      outcomeJson: input.outcomeJson,
      verificationResult: input.verificationResult,
      verifiedAt: input.verifiedAt,
    })
    .where(
      and(
        eq(pgSchema.traderMarketPredictions.id, predictionId),
        orgScopedWhere(pgSchema.traderMarketPredictions.organizationId, scoped),
      ),
    );

  const prediction = await getMarketPredictionByIdPostgres(ex, context, predictionId);
  if (!prediction) {
    throw new Error("[trader] market prediction verify failed");
  }
  return prediction;
}
