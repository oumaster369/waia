/**
 * DEE-415 / HTR-WP15 — shared Postgres integration helpers.
 */

import postgres from "postgres";

import { getPostgresDrizzle } from "@/db/postgres-client";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { insertKnowledgeEdgePostgres } from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { insertMarketEventPostgres } from "@/lib/trader/knowledge/market-event-repository-postgres";
import { insertMarketPredictionPostgres } from "@/lib/trader/knowledge/market-prediction-repository-postgres";
import { queryMarketKnowledgeReadModel } from "@/lib/trader/knowledge/market-memory";
import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import {
  buildWp14Bundle,
  buildWp14PersistenceAuthorization,
  cleanupWp14AllRows,
  seedWp14User,
  WP14_PG_USER_A,
} from "./wp14-forecast-decision-test-helpers";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";
import {
  buildWp15KnowledgeSeedArtifacts,
  buildWp15Snapshot,
  WP15_AS_OF,
} from "../unit/wp15-test-helpers";

export {
  WP14_PG_USER_A as WP15_PG_USER_A,
  seedWp14User as seedWp15User,
  cleanupWp14AllRows as cleanupWp15AllRows,
};

export async function seedWp15KnowledgeRows(
  organizationId: string,
  runId: string,
  cycleId: string,
): Promise<void> {
  const db = getPostgresDrizzle();
  const wp13 = buildWp13Bundle(organizationId, runId, cycleId);
  await persistIntelligenceCycleBundle({ organizationId }, wp13, db);
  const wp14 = buildWp14Bundle(organizationId, runId, cycleId);
  await persistForecastDecisionBundle(
    { organizationId },
    wp14,
    db,
    buildWp14PersistenceAuthorization(organizationId, wp14),
  );

  const knowledgeSeed = buildWp15KnowledgeSeedArtifacts(organizationId);

  for (const prediction of knowledgeSeed.marketPredictions) {
    await insertMarketPredictionPostgres(
      db,
      { organizationId },
      {
        id: prediction.id,
        subjectRef: prediction.subjectRef,
        predictionJson: prediction.predictionJson,
        predictedAt: prediction.predictedAt,
        contentDigest: prediction.contentDigest,
        createdAt: prediction.createdAt,
      },
    );
  }

  for (const event of knowledgeSeed.marketEvents) {
    await insertMarketEventPostgres(
      db,
      { organizationId },
      {
        id: event.id,
        eventKind: event.eventKind,
        subjectRef: event.subjectRef,
        payloadJson: event.payloadJson,
        eventTime: event.eventTime,
        confidence: event.confidence,
        contentDigest: event.contentDigest,
        createdAt: event.createdAt,
      },
    );
  }

  for (const edge of knowledgeSeed.knowledgeEdges) {
    await insertKnowledgeEdgePostgres(
      db,
      { organizationId },
      {
        id: edge.id,
        fromRef: edge.fromRef,
        toRef: edge.toRef,
        relationKind: edge.relationKind,
        confidence: edge.confidence,
        strength: edge.strength,
        regimeScope: edge.regimeScope,
        failureCasesJson: edge.failureCasesJson,
        verified: edge.verified,
        createdAt: edge.createdAt,
        updatedAt: edge.updatedAt,
      },
    );
  }
}

export async function queryWp15PostgresReadModel(organizationId: string, runId: string) {
  const db = getPostgresDrizzle();
  return queryMarketKnowledgeReadModel(
    db,
    { organizationId },
    { runId, symbol: "BTC/USDT" },
    WP15_AS_OF,
  );
}

export async function seedWp15FutureUpdatedKnowledgeEdge(organizationId: string): Promise<string> {
  const id = "wp15-future-updated-edge";
  await insertKnowledgeEdgePostgres(getPostgresDrizzle(), { organizationId }, {
    id,
    fromRef: "evidence:past",
    toRef: "hypothesis:past",
    relationKind: "supports",
    confidence: "high",
    strength: "strong",
    regimeScope: "trend",
    failureCasesJson: "[]",
    verified: true,
    createdAt: new Date(WP15_AS_OF.getTime() - 60_000),
    updatedAt: new Date(WP15_AS_OF.getTime() + 1),
  });
  return id;
}

export async function queryWp15InMemoryReadModel(
  organizationId: string,
  runId: string,
  cycleId: string,
) {
  const snapshot = buildWp15Snapshot(organizationId, runId, cycleId);
  const source = createInMemoryMkbReadModelSource({
    snapshotsByOrganizationId: {
      [organizationId]: snapshot,
    },
  });
  return queryMkbReadModel({ organizationId }, { runId, cycleId, symbol: "BTC/USDT" }, WP15_AS_OF, {
    source,
  });
}

export async function cleanupWp15KnowledgeRows(url: string, organizationId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`DELETE FROM trader_knowledge_edges WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_market_predictions WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_market_events WHERE organization_id = $1`, [
      organizationId,
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
