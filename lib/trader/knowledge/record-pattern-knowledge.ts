import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { insertKnowledgeEdgePostgres } from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { insertMarketEventPostgres } from "@/lib/trader/knowledge/market-event-repository-postgres";
import {
  buildCloseKnowledgeToRef,
  buildPatternKnowledgeFromRef,
  buildRejectionKnowledgeToRef,
  patternKnowledgeRelationKinds,
  type PatternKnowledgeRelationKind,
} from "@/lib/trader/knowledge/pattern-knowledge-relation-kinds";
import type { PatternCatalogExplanationPayload } from "@/lib/trader/mi/pattern-catalog.types";
import { insertMiPatternScoreEventPostgres } from "@/lib/trader/mi/pattern-score-repository-postgres";
import {
  buildPatternScoreContentDigest,
  buildPriceMoveExplanationContentDigest,
} from "@/lib/trader/mi/serialize-pattern-catalog";
import { insertPriceMoveExplanationPostgres } from "@/lib/trader/knowledge/price-move-explanation-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type RecordPatternKnowledgeInput = {
  explanation: PatternCatalogExplanationPayload;
  recordedAt?: Date;
  newId?: () => string;
};

export type RecordPatternKnowledgeResult = {
  marketEventId: string;
  knowledgeEdgeId: string;
  scoreEventId: string;
  explanationId: string;
};

function resolveRelationKind(
  subjectKind: PatternCatalogExplanationPayload["subjectKind"],
): PatternKnowledgeRelationKind {
  return subjectKind === "close"
    ? patternKnowledgeRelationKinds.patternAssociatedWithClose
    : patternKnowledgeRelationKinds.patternAssociatedWithRejection;
}

function resolveToRef(explanation: PatternCatalogExplanationPayload): string {
  if (explanation.subjectKind === "close") {
    const orderId = explanation.subjectRef.replace(/^close:order:/, "");
    return buildCloseKnowledgeToRef({ orderId });
  }
  const signalId = explanation.subjectRef.replace(/^signal:/, "").replace(/:rejected$/, "");
  return buildRejectionKnowledgeToRef({ strategySignalId: signalId });
}

/**
 * Append-only pattern knowledge writer — inserts score, explanation, market event, and edge.
 * Does not update existing edges (M6 insert-only constraint).
 */
export async function recordPatternKnowledgePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: RecordPatternKnowledgeInput,
): Promise<RecordPatternKnowledgeResult> {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const recordedAt = input.recordedAt ?? new Date();
  const explanation = input.explanation;
  const scoreEventId = newId();
  const explanationId = newId();
  const marketEventId = newId();
  const knowledgeEdgeId = newId();

  const scoreDigest = buildPatternScoreContentDigest({
    organizationId: context.organizationId,
    patternKey: explanation.patternKey,
    definitionDigest: explanation.definitionDigest,
    subjectRef: explanation.subjectRef,
    evaluatedAt: recordedAt.toISOString(),
    matchScore: explanation.scores.matchScore,
    relevanceScore: explanation.scores.relevanceScore,
    confidenceMean: explanation.scores.confidenceMean,
  });

  await insertMiPatternScoreEventPostgres(ex, context, {
    id: scoreEventId,
    patternKey: explanation.patternKey,
    definitionDigest: explanation.definitionDigest,
    subjectRef: explanation.subjectRef,
    matchScore: explanation.scores.matchScore,
    relevanceScore: explanation.scores.relevanceScore,
    confidenceMean: explanation.scores.confidenceMean,
    confidenceBandLow: explanation.scores.confidenceBandLow,
    confidenceBandHigh: explanation.scores.confidenceBandHigh,
    priorHits: explanation.scores.priorHits,
    priorMisses: explanation.scores.priorMisses,
    regime: explanation.regime,
    evaluatedAt: recordedAt,
    contentDigest: scoreDigest,
    createdAt: recordedAt,
  });

  const explanationDigest = buildPriceMoveExplanationContentDigest({
    organizationId: context.organizationId,
    subjectRef: explanation.subjectRef,
    payload: explanation,
  });

  await insertPriceMoveExplanationPostgres(ex, context, {
    id: explanationId,
    subjectRef: explanation.subjectRef,
    priceMoveJson: JSON.stringify({
      priceMoveUsdt: explanation.priceMoveUsdt,
      symbol: explanation.symbol,
      regime: explanation.regime,
      outcomeTag: explanation.outcomeTag,
    }),
    patternRefsJson: JSON.stringify([
      {
        patternKey: explanation.patternKey,
        definitionDigest: explanation.definitionDigest,
      },
    ]),
    scoreBreakdownJson: JSON.stringify({
      breakdown: explanation.breakdown,
      scores: explanation.scores,
    }),
    contentDigest: explanationDigest,
    createdAt: recordedAt,
  });

  const eventPayload = {
    schemaVersion: "pattern_catalog_observation_v1",
    subjectRef: explanation.subjectRef,
    subjectKind: explanation.subjectKind,
    patternKey: explanation.patternKey,
    definitionDigest: explanation.definitionDigest,
    matchScore: explanation.scores.matchScore,
    explanationDigest,
  };

  await insertMarketEventPostgres(ex, context, {
    id: marketEventId,
    eventKind: "pattern_catalog_observation",
    subjectRef: explanation.subjectRef,
    payloadJson: JSON.stringify(eventPayload),
    eventTime: recordedAt,
    confidence: explanation.scores.confidenceMean,
    contentDigest: explanationDigest,
    createdAt: recordedAt,
  });

  const fromRef = buildPatternKnowledgeFromRef({
    patternKey: explanation.patternKey,
    definitionDigest: explanation.definitionDigest,
  });
  const toRef = resolveToRef(explanation);

  await insertKnowledgeEdgePostgres(ex, context, {
    id: knowledgeEdgeId,
    fromRef,
    toRef,
    relationKind: resolveRelationKind(explanation.subjectKind),
    confidence: explanation.scores.confidenceMean,
    strength: explanation.scores.relevanceScore,
    regimeScope: explanation.regime,
    failureCasesJson: "[]",
    verified: false,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });

  return {
    marketEventId,
    knowledgeEdgeId,
    scoreEventId,
    explanationId,
  };
}
