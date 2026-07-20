import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  MkbReadModelQuery,
  MkbReadModelSnapshot,
} from "@/lib/trader/knowledge/mkb-read-model.types";

export type MkbReadModelSource = Readonly<{
  loadSnapshot: (
    context: OrgContext,
    query: MkbReadModelQuery,
    asOf: Date,
  ) => Promise<MkbReadModelSnapshot>;
}>;

export type InMemoryMkbReadModelSourceInput = Readonly<{
  snapshotsByOrganizationId?: Readonly<Record<string, MkbReadModelSnapshot>>;
}>;

export function createInMemoryMkbReadModelSource(
  input: InMemoryMkbReadModelSourceInput = {},
): MkbReadModelSource {
  return {
    async loadSnapshot(context, query, asOf) {
      const snapshot = input.snapshotsByOrganizationId?.[context.organizationId] ?? emptySnapshot();
      return filterSnapshot(snapshot, query, asOf);
    },
  };
}

function emptySnapshot(): MkbReadModelSnapshot {
  return {
    cycleEnvelopes: [],
    hypotheses: [],
    convictions: [],
    forecasts: [],
    decisions: [],
    links: [],
    entryPurposes: [],
    knowledgeEdges: [],
    marketPredictions: [],
    marketEvents: [],
  };
}

function filterSnapshot(
  snapshot: MkbReadModelSnapshot,
  query: MkbReadModelQuery,
  asOf: Date,
): MkbReadModelSnapshot {
  const asOfMs = asOf.getTime();
  const limit = query.limit ?? Number.POSITIVE_INFINITY;

  const cycleEnvelopes = snapshot.cycleEnvelopes
    .filter((row) => matchesRunCycleSymbol(row, query))
    .filter((row) => Date.parse(row.evaluatedAt) <= asOfMs)
    .slice(0, limit);

  const envelopeIds = new Set(cycleEnvelopes.map((row) => row.id));

  const forecasts = snapshot.forecasts
    .filter((row) => matchesRunCycleSymbol(row, query))
    .filter((row) => Date.parse(row.issuedAt) <= asOfMs)
    .slice(0, limit);

  const decisions = snapshot.decisions
    .filter((row) => matchesRunCycleSymbol(row, query))
    .filter((row) => Date.parse(row.issuedAt) <= asOfMs)
    .slice(0, limit);

  const decisionIds = new Set(decisions.map((row) => row.id));

  const links = snapshot.links
    .filter((row) => decisionIds.has(row.decisionRecordId))
    .slice(0, limit);

  const entryPurposes = snapshot.entryPurposes
    .filter((row) => decisionIds.has(row.decisionRecordId))
    .slice(0, limit);

  const hypotheses = snapshot.hypotheses
    .filter((row) => envelopeIds.has(row.cycleEnvelopeId))
    .filter((row) => matchesRunCycleSymbol(row, query))
    .filter((row) => Date.parse(row.evaluatedAt) <= asOfMs)
    .slice(0, limit);

  const convictions = snapshot.convictions
    .filter((row) => envelopeIds.has(row.cycleEnvelopeId))
    .filter((row) => matchesRunCycleSymbol(row, query))
    .filter((row) => Date.parse(row.evaluatedAt) <= asOfMs)
    .slice(0, limit);

  const knowledgeEdges = snapshot.knowledgeEdges
    .filter((row) => (query.regimeScope ? row.regimeScope === query.regimeScope : true))
    .filter((row) => row.createdAt.getTime() <= asOfMs)
    .slice(0, limit);

  const marketPredictions = snapshot.marketPredictions
    .filter((row) => row.predictedAt.getTime() <= asOfMs)
    .slice(0, limit);

  const marketEvents = snapshot.marketEvents
    .filter((row) => row.eventTime.getTime() <= asOfMs)
    .slice(0, limit);

  return {
    cycleEnvelopes,
    hypotheses,
    convictions,
    forecasts,
    decisions,
    links,
    entryPurposes,
    knowledgeEdges,
    marketPredictions,
    marketEvents,
  };
}

function matchesRunCycleSymbol(
  row: { runId: string; cycleId: string; symbol: string },
  query: MkbReadModelQuery,
): boolean {
  if (query.runId && row.runId !== query.runId) {
    return false;
  }
  if (query.cycleId && row.cycleId !== query.cycleId) {
    return false;
  }
  if (query.symbol && row.symbol !== query.symbol) {
    return false;
  }
  return true;
}
