import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertNoCapitalAuthority,
  classifyForecastKnowledgeState,
  classifyKnowledgeEdgeState,
  classifyLegacyPredictionKnowledgeState,
  classifyMarketEventState,
  isVerifiedKnowledgeState,
} from "@/lib/trader/knowledge/mkb-knowledge-state";
import {
  computeLineageDigest,
  queryForecastDecisionLineage,
  queryHypothesisFamiliesByRegime,
  queryNoTradeObservations,
  queryPatternDiscoveryCandidates,
} from "@/lib/trader/knowledge/mkb-read-model-queries";
import type { MkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import type {
  MkbReadModelEntry,
  MkbReadModelQuery,
  MkbReadModelResult,
  MkbReadModelSnapshot,
  OutcomeResolutionReadPort,
  OutcomeResolutionRow,
} from "@/lib/trader/knowledge/mkb-read-model.types";
import { MKB_READ_MODEL_SCHEMA_VERSION } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type QueryMkbReadModelDeps = Readonly<{
  source: MkbReadModelSource;
  outcomePort?: OutcomeResolutionReadPort;
}>;

export async function queryMkbReadModel(
  context: OrgContext,
  query: MkbReadModelQuery,
  asOf: Date,
  deps: QueryMkbReadModelDeps,
): Promise<MkbReadModelResult> {
  const snapshot = await deps.source.loadSnapshot(context, query, asOf);
  const outcomeRows = deps.outcomePort
    ? await deps.outcomePort.listResolvedOutcomes(context, asOf, query)
    : [];
  const outcomeByForecastId = indexOutcomeRows(outcomeRows, context.organizationId);

  const entries = buildEntries(snapshot, asOf, outcomeByForecastId);
  for (const entry of entries) {
    assertNoCapitalAuthority(entry);
    if (entry.metadata) {
      assertNoCapitalAuthority(entry.metadata);
    }
  }

  const verifiedKnowledge = entries.filter((entry) =>
    isVerifiedKnowledgeState(entry.knowledgeState),
  );

  const lineage = queryForecastDecisionLineage(snapshot, query);
  const semanticPayload = {
    asOf: asOf.toISOString(),
    entries,
    lineageDigest: computeLineageDigest(lineage),
    patternDiscoveryCandidates: queryPatternDiscoveryCandidates(snapshot, asOf, query),
    noTradeObservations: queryNoTradeObservations(snapshot, asOf, query),
    hypothesisFamiliesByRegime: queryHypothesisFamiliesByRegime(snapshot, query),
  };

  return {
    schemaVersion: MKB_READ_MODEL_SCHEMA_VERSION,
    asOf: asOf.toISOString(),
    entries,
    verifiedKnowledge,
    semanticDigest: computeSemanticSha256Hex(semanticPayload),
  };
}

function indexOutcomeRows(
  rows: readonly OutcomeResolutionRow[],
  organizationId: string,
): Map<string, OutcomeResolutionRow> {
  const map = new Map<string, OutcomeResolutionRow>();
  for (const row of rows) {
    if (row.organizationId !== organizationId) {
      continue;
    }
    map.set(row.forecastRecordId, row);
  }
  return map;
}

function buildEntries(
  snapshot: MkbReadModelSnapshot,
  asOf: Date,
  outcomeByForecastId: Map<string, OutcomeResolutionRow>,
): readonly MkbReadModelEntry[] {
  const entries: MkbReadModelEntry[] = [];

  for (const forecast of snapshot.forecasts) {
    const decision =
      snapshot.decisions.find(
        (row) =>
          row.runId === forecast.runId &&
          row.cycleId === forecast.cycleId &&
          row.symbol === forecast.symbol,
      ) ?? null;
    const envelope =
      snapshot.cycleEnvelopes.find(
        (row) =>
          row.runId === forecast.runId &&
          row.cycleId === forecast.cycleId &&
          row.symbol === forecast.symbol,
      ) ?? null;
    const links = decision
      ? snapshot.links.filter((row) => row.decisionRecordId === decision.id)
      : [];
    const entryPurpose = decision
      ? (snapshot.entryPurposes.find((row) => row.decisionRecordId === decision.id) ?? null)
      : null;

    entries.push({
      subjectKind: "forecast",
      subjectId: forecast.id,
      knowledgeState: classifyForecastKnowledgeState({
        forecast,
        decision,
        envelope,
        links,
        entryPurpose,
        asOf,
        outcome: outcomeByForecastId.get(forecast.id),
      }),
      asOf: asOf.toISOString(),
      organizationId: forecast.organizationId,
      runId: forecast.runId,
      cycleId: forecast.cycleId,
      symbol: forecast.symbol,
      strategyId: decision?.strategyId ?? null,
      strategyVersion: decision?.strategyVersion ?? null,
      lineageDigest: computeLineageDigest(
        queryForecastDecisionLineage(snapshot, {
          runId: forecast.runId,
          cycleId: forecast.cycleId,
          symbol: forecast.symbol,
        }),
      ),
      metadata: {
        forecastKeyDigest: forecast.forecastKeyDigest,
        contentDigest: forecast.contentDigest,
      },
    });
  }

  for (const edge of snapshot.knowledgeEdges) {
    entries.push({
      subjectKind: "knowledge_edge",
      subjectId: edge.id,
      knowledgeState: classifyKnowledgeEdgeState(edge, asOf),
      asOf: asOf.toISOString(),
      organizationId: edge.organizationId,
      regimeScope: edge.regimeScope,
      metadata: {
        relationKind: edge.relationKind,
        fromRef: edge.fromRef,
        toRef: edge.toRef,
      },
    });
  }

  for (const prediction of snapshot.marketPredictions) {
    entries.push({
      subjectKind: "market_prediction",
      subjectId: prediction.id,
      knowledgeState: classifyLegacyPredictionKnowledgeState(prediction, asOf),
      asOf: asOf.toISOString(),
      organizationId: prediction.organizationId,
      metadata: {
        subjectRef: prediction.subjectRef,
        contentDigest: prediction.contentDigest,
      },
    });
  }

  for (const event of snapshot.marketEvents) {
    entries.push({
      subjectKind: "market_event",
      subjectId: event.id,
      knowledgeState: classifyMarketEventState(event.eventTime, asOf),
      asOf: asOf.toISOString(),
      organizationId: event.organizationId,
      metadata: {
        eventKind: event.eventKind,
        subjectRef: event.subjectRef,
      },
    });
  }

  for (const observation of queryNoTradeObservations(snapshot, asOf)) {
    entries.push({
      subjectKind: "no_trade_observation",
      subjectId: observation.decisionRecordId,
      knowledgeState: observation.knowledgeState,
      asOf: asOf.toISOString(),
      organizationId:
        snapshot.decisions.find((row) => row.id === observation.decisionRecordId)?.organizationId ??
        "",
      runId: observation.runId,
      cycleId: observation.cycleId,
      symbol: observation.symbol,
      metadata: {
        universalTerminalReasonCode: observation.universalTerminalReasonCode,
      },
    });
  }

  return sortEntries(entries);
}

function sortEntries(entries: readonly MkbReadModelEntry[]): readonly MkbReadModelEntry[] {
  return [...entries].sort((a, b) => {
    const kindCompare = compareCodePoint(a.subjectKind, b.subjectKind);
    if (kindCompare !== 0) {
      return kindCompare;
    }
    return compareCodePoint(a.subjectId, b.subjectId);
  });
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export {
  assertNoCapitalAuthority,
  queryForecastDecisionLineage,
  queryHypothesisFamiliesByRegime,
  queryNoTradeObservations,
  queryPatternDiscoveryCandidates,
};
