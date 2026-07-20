import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getKnowledgeEdgeByIdPostgres,
  updateKnowledgeEdgePostgres,
} from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import type {
  KnowledgeEdge,
  MarketPrediction,
  MarketPredictionVerificationResult,
} from "@/lib/trader/knowledge/knowledge.types";
import { createMkbReadModelSourcePostgres } from "@/lib/trader/knowledge/mkb-read-model-postgres";
import {
  queryMkbReadModel,
  type QueryMkbReadModelDeps,
} from "@/lib/trader/knowledge/mkb-read-model";
import type {
  MkbReadModelQuery,
  MkbReadModelResult,
  OutcomeResolutionReadPort,
} from "@/lib/trader/knowledge/mkb-read-model.types";
import {
  getMarketPredictionByIdPostgres,
  insertMarketPredictionPostgres,
  verifyMarketPredictionPostgres,
} from "@/lib/trader/knowledge/market-prediction-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export class MarketMemoryError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "MarketMemoryError";
    this.code = code;
  }
}

export type RecordMarketPredictionInput = {
  subjectRef: string;
  prediction: Record<string, unknown>;
  predictedAt: Date;
  id?: string;
  createdAt?: Date;
};

export type VerifyMarketPredictionOutcomeInput = {
  predictionId: string;
  outcome: Record<string, unknown>;
  verificationResult: MarketPredictionVerificationResult;
  verifiedAt?: Date;
};

export type UpdateEdgeConfidenceInput = {
  edgeId: string;
  verificationResult: MarketPredictionVerificationResult;
  updatedAt?: Date;
};

function canonicalJsonString(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

export function computeMarketPredictionDigest(input: {
  subjectRef: string;
  predictionJson: string;
  predictedAt: Date;
}): string {
  const payload = {
    subjectRef: input.subjectRef,
    predictionJson: input.predictionJson,
    predictedAt: input.predictedAt.toISOString(),
  };
  return createHash("sha256").update(canonicalJsonString(payload), "utf8").digest("hex");
}

function parseConfidence(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, parsed));
}

function formatConfidence(value: number): string {
  return value.toFixed(4);
}

export function adjustEdgeConfidenceFromVerification(
  currentConfidence: string,
  verificationResult: MarketPredictionVerificationResult,
): { confidence: string; verified: boolean } {
  const current = parseConfidence(currentConfidence);
  let next = current;

  switch (verificationResult) {
    case "confirmed":
      next = current + (1 - current) * 0.1;
      return { confidence: formatConfidence(next), verified: next >= 0.7 };
    case "rejected":
      next = current * 0.85;
      return { confidence: formatConfidence(next), verified: false };
    case "inconclusive":
      next = current * 0.95;
      return { confidence: formatConfidence(next), verified: false };
    default:
      return { confidence: currentConfidence, verified: false };
  }
}

export async function recordMarketPrediction(
  ex: PgExecutor,
  context: OrgContext,
  input: RecordMarketPredictionInput,
): Promise<MarketPrediction> {
  if (input.subjectRef.trim().length === 0) {
    throw new MarketMemoryError("MARKET_MEMORY_SUBJECT_REQUIRED");
  }

  const predictionJson = JSON.stringify(input.prediction);
  const predictedAt = input.predictedAt;
  const contentDigest = computeMarketPredictionDigest({
    subjectRef: input.subjectRef,
    predictionJson,
    predictedAt,
  });

  return insertMarketPredictionPostgres(ex, context, {
    id: input.id ?? crypto.randomUUID(),
    subjectRef: input.subjectRef,
    predictionJson,
    predictedAt,
    contentDigest,
    createdAt: input.createdAt ?? new Date(),
  });
}

export async function verifyMarketPredictionOutcome(
  ex: PgExecutor,
  context: OrgContext,
  input: VerifyMarketPredictionOutcomeInput,
): Promise<MarketPrediction> {
  const existing = await getMarketPredictionByIdPostgres(ex, context, input.predictionId);
  if (!existing) {
    throw new MarketMemoryError("MARKET_MEMORY_PREDICTION_NOT_FOUND");
  }
  if (existing.verifiedAt !== null) {
    throw new MarketMemoryError("MARKET_MEMORY_PREDICTION_ALREADY_VERIFIED");
  }

  return verifyMarketPredictionPostgres(ex, context, input.predictionId, {
    outcomeJson: JSON.stringify(input.outcome),
    verificationResult: input.verificationResult,
    verifiedAt: input.verifiedAt ?? new Date(),
  });
}

export async function updateEdgeConfidenceFromVerification(
  ex: PgExecutor,
  context: OrgContext,
  input: UpdateEdgeConfidenceInput,
): Promise<KnowledgeEdge> {
  const edge = await getKnowledgeEdgeByIdPostgres(ex, context, input.edgeId);
  if (!edge) {
    throw new MarketMemoryError("MARKET_MEMORY_EDGE_NOT_FOUND");
  }

  const adjusted = adjustEdgeConfidenceFromVerification(edge.confidence, input.verificationResult);
  return updateKnowledgeEdgePostgres(ex, context, input.edgeId, {
    confidence: adjusted.confidence,
    verified: adjusted.verified,
    updatedAt: input.updatedAt ?? new Date(),
  });
}

export async function queryMarketKnowledgeReadModel(
  ex: Pick<WaiaPostgresDb, "select">,
  context: OrgContext,
  query: MkbReadModelQuery,
  asOf: Date,
  outcomePort?: OutcomeResolutionReadPort,
): Promise<MkbReadModelResult> {
  const deps: QueryMkbReadModelDeps = {
    source: createMkbReadModelSourcePostgres(ex),
    outcomePort,
  };
  return queryMkbReadModel(context, query, asOf, deps);
}
