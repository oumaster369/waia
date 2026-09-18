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
  KNOWLEDGE_AUTHORITY_REASON,
  KnowledgeAuthorityError,
} from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import {
  MARKET_PREDICTION_VERIFICATION_SCHEMA_V2,
  computeMarketPredictionVerificationDigestHex,
  marketPredictionVerificationRowId,
  requireProducingReceiptDigest,
} from "@/lib/trader/knowledge/market-prediction-verification-v2";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapMarketPrediction(
  row: typeof pgSchema.traderMarketPredictions.$inferSelect,
  verification?: {
    outcomeJson: string;
    verificationResult: MarketPredictionVerificationResult;
    verifiedAt: Date;
  } | null,
): MarketPrediction {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectRef: row.subjectRef,
    predictionJson: row.predictionJson,
    predictedAt: row.predictedAt,
    outcomeJson: verification?.outcomeJson ?? row.outcomeJson,
    verifiedAt: verification?.verifiedAt ?? row.verifiedAt,
    verificationResult:
      verification?.verificationResult ??
      (row.verificationResult as MarketPredictionVerificationResult | null),
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

async function latestVerification(
  ex: PgReadExecutor,
  context: OrgContext,
  predictionId: string,
): Promise<{
  outcomeJson: string;
  verificationResult: MarketPredictionVerificationResult;
  verifiedAt: Date;
} | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMarketPredictionVerificationV2)
    .where(
      and(
        eq(pgSchema.traderMarketPredictionVerificationV2.predictionId, predictionId),
        orgScopedWhere(pgSchema.traderMarketPredictionVerificationV2.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMarketPredictionVerificationV2.version))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    outcomeJson: row.outcomeJson,
    verificationResult: row.verificationResult as MarketPredictionVerificationResult,
    verifiedAt: row.verifiedAt,
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
  return mapMarketPrediction(rows[0], null);
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

  if (!rows[0]) return null;
  return mapMarketPrediction(rows[0], await latestVerification(ex, context, predictionId));
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

  const mapped: MarketPrediction[] = [];
  for (const row of rows) {
    mapped.push(mapMarketPrediction(row, await latestVerification(ex, context, row.id)));
  }
  return mapped;
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
  const existing = await getMarketPredictionByIdPostgres(ex, context, predictionId);
  if (!existing) {
    throw new Error("[trader] market prediction verify failed");
  }

  const digest = computeMarketPredictionVerificationDigestHex({
    outcomeJson: input.outcomeJson,
    verificationResult: input.verificationResult,
  });
  const receipt = requireProducingReceiptDigest(existing.contentDigest);
  const currentVersion = existing.verifiedAt ? 1 : 0;
  if (existing.verifiedAt && existing.outcomeJson === input.outcomeJson) {
    return existing;
  }
  if (existing.verifiedAt) {
    throw new KnowledgeAuthorityError(KNOWLEDGE_AUTHORITY_REASON.INITIAL_ASSERTION_ALREADY_EXISTS);
  }

  const id = marketPredictionVerificationRowId(
    [
      MARKET_PREDICTION_VERIFICATION_SCHEMA_V2,
      scoped.organizationId,
      predictionId,
      String(currentVersion + 1),
      digest,
    ].join("|"),
  );

  try {
    await ex.insert(pgSchema.traderMarketPredictionVerificationV2).values({
      id,
      organizationId: scoped.organizationId,
      predictionId,
      version: currentVersion + 1,
      outcomeJson: input.outcomeJson,
      verificationResult: input.verificationResult,
      verifiedAt: input.verifiedAt,
      recordedAt: input.verifiedAt,
      contentDigestHex: digest,
      producedByReceiptDigestHex: receipt,
      schemaVersion: MARKET_PREDICTION_VERIFICATION_SCHEMA_V2,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const replayed = await getMarketPredictionByIdPostgres(ex, context, predictionId);
      if (replayed?.verifiedAt) return replayed;
      throw new KnowledgeAuthorityError(KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION);
    }
    throw error;
  }

  const prediction = await getMarketPredictionByIdPostgres(ex, context, predictionId);
  if (!prediction) {
    throw new Error("[trader] market prediction verify failed");
  }
  return prediction;
}
