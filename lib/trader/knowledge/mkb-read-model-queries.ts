import {
  computeSemanticSha256Hex,
  sortCodePointStrings,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { patternKnowledgeRelationKinds } from "@/lib/trader/knowledge/pattern-knowledge-relation-kinds";
import {
  classifyKnowledgeEdgeState,
  classifyNoTradeObservationState,
  isForecastDecisionChainComplete,
} from "@/lib/trader/knowledge/mkb-knowledge-state";
import type {
  ForecastDecisionLineageRow,
  HypothesisFamilyByRegime,
  MkbReadModelQuery,
  MkbReadModelSnapshot,
  NoTradeObservation,
  PatternDiscoveryCandidate,
} from "@/lib/trader/knowledge/mkb-read-model.types";

const PATTERN_RELATION_KINDS = new Set<string>(Object.values(patternKnowledgeRelationKinds));

function envelopeKey(runId: string, cycleId: string, symbol: string): string {
  return `${runId}|${cycleId}|${symbol}`;
}

function findEnvelope(
  snapshot: MkbReadModelSnapshot,
  runId: string,
  cycleId: string,
  symbol: string,
) {
  return (
    snapshot.cycleEnvelopes.find(
      (row) => row.runId === runId && row.cycleId === cycleId && row.symbol === symbol,
    ) ?? null
  );
}

function findDecision(
  snapshot: MkbReadModelSnapshot,
  runId: string,
  cycleId: string,
  symbol: string,
) {
  return (
    snapshot.decisions.find(
      (row) => row.runId === runId && row.cycleId === cycleId && row.symbol === symbol,
    ) ?? null
  );
}

export function queryForecastDecisionLineage(
  snapshot: MkbReadModelSnapshot,
  query: MkbReadModelQuery = {},
): readonly ForecastDecisionLineageRow[] {
  const keys = new Set<string>();

  for (const envelope of snapshot.cycleEnvelopes) {
    if (!matchesQuery(envelope, query)) {
      continue;
    }
    keys.add(envelopeKey(envelope.runId, envelope.cycleId, envelope.symbol));
  }

  for (const decision of snapshot.decisions) {
    if (!matchesQuery(decision, query)) {
      continue;
    }
    keys.add(envelopeKey(decision.runId, decision.cycleId, decision.symbol));
  }

  const rows: ForecastDecisionLineageRow[] = [];

  for (const key of sortCodePointStrings([...keys])) {
    const [runId, cycleId, symbol] = key.split("|");
    const envelope = findEnvelope(snapshot, runId!, cycleId!, symbol!);
    const decision = findDecision(snapshot, runId!, cycleId!, symbol!);
    const links = decision
      ? snapshot.links.filter((row) => row.decisionRecordId === decision.id)
      : [];
    const entryPurpose = decision
      ? (snapshot.entryPurposes.find((row) => row.decisionRecordId === decision.id) ?? null)
      : null;
    const forecastRecordIds = sortCodePointStrings(links.map((row) => row.forecastRecordId));
    const hypothesisRecordIds = sortCodePointStrings(
      snapshot.hypotheses
        .filter((row) => row.runId === runId && row.cycleId === cycleId && row.symbol === symbol)
        .map((row) => row.id),
    );
    const convictionRecordId =
      snapshot.convictions.find(
        (row) => row.runId === runId && row.cycleId === cycleId && row.symbol === symbol,
      )?.id ?? null;

    rows.push({
      organizationId: envelope?.organizationId ?? decision?.organizationId ?? "",
      runId: runId!,
      cycleId: cycleId!,
      symbol: symbol!,
      cycleEnvelopeId: envelope?.id ?? decision?.cycleEnvelopeId ?? "",
      forecastRecordIds,
      decisionRecordId: decision?.id ?? null,
      entryPurposeRecordId: entryPurpose?.id ?? null,
      hypothesisRecordIds,
      convictionRecordId,
      chainComplete: isForecastDecisionChainComplete({
        envelope,
        decision,
        links,
        entryPurpose,
      }),
    });
  }

  return rows;
}

export function queryPatternDiscoveryCandidates(
  snapshot: MkbReadModelSnapshot,
  asOf: Date,
  query: MkbReadModelQuery = {},
): readonly PatternDiscoveryCandidate[] {
  return snapshot.knowledgeEdges
    .filter((edge) => PATTERN_RELATION_KINDS.has(edge.relationKind))
    .filter((edge) => (query.regimeScope ? edge.regimeScope === query.regimeScope : true))
    .map((edge) => ({
      edgeId: edge.id,
      fromRef: edge.fromRef,
      toRef: edge.toRef,
      relationKind: edge.relationKind,
      regimeScope: edge.regimeScope,
      confidence: edge.confidence,
      verified: edge.verified,
      knowledgeState: classifyKnowledgeEdgeState(edge, asOf),
    }));
}

export function queryNoTradeObservations(
  snapshot: MkbReadModelSnapshot,
  asOf: Date,
  query: MkbReadModelQuery = {},
): readonly NoTradeObservation[] {
  void asOf;

  return snapshot.decisions
    .filter((decision) => decision.decisionClass === "NO_TRADE")
    .filter((decision) => matchesQuery(decision, query))
    .map((decision) => {
      const envelope = findEnvelope(snapshot, decision.runId, decision.cycleId, decision.symbol);
      const links = snapshot.links.filter((row) => row.decisionRecordId === decision.id);
      const entryPurpose =
        snapshot.entryPurposes.find((row) => row.decisionRecordId === decision.id) ?? null;

      return {
        decisionRecordId: decision.id,
        runId: decision.runId,
        cycleId: decision.cycleId,
        symbol: decision.symbol,
        evaluatedAt: decision.evaluatedAt,
        universalTerminalReasonCode: decision.universalTerminalReasonCode,
        whyCashOrAbstainJson: decision.whyCashOrAbstainJson,
        knowledgeState: classifyNoTradeObservationState({
          envelope,
          decision,
          links,
          entryPurpose,
        }),
      };
    });
}

export function queryHypothesisFamiliesByRegime(
  snapshot: MkbReadModelSnapshot,
  query: MkbReadModelQuery = {},
): readonly HypothesisFamilyByRegime[] {
  type MutableFamily = {
    regimeScope: string;
    hypothesisTypes: string[];
    hypothesisRecordIds: string[];
    edgeIds: string[];
  };

  const byRegime = new Map<string, MutableFamily>();

  for (const hypothesis of snapshot.hypotheses) {
    if (!matchesQuery(hypothesis, query)) {
      continue;
    }

    const relatedEdges = snapshot.knowledgeEdges.filter(
      (edge) => edge.hypothesisId === hypothesis.miHypothesisId,
    );
    const regimeScopes =
      relatedEdges.length > 0 ? relatedEdges.map((edge) => edge.regimeScope) : ["global"];

    for (const regimeScope of regimeScopes) {
      if (query.regimeScope && regimeScope !== query.regimeScope) {
        continue;
      }

      const existing: MutableFamily = byRegime.get(regimeScope) ?? {
        regimeScope,
        hypothesisTypes: [],
        hypothesisRecordIds: [],
        edgeIds: [],
      };

      if (!existing.hypothesisTypes.includes(hypothesis.hypothesisType)) {
        existing.hypothesisTypes.push(hypothesis.hypothesisType);
      }
      if (!existing.hypothesisRecordIds.includes(hypothesis.id)) {
        existing.hypothesisRecordIds.push(hypothesis.id);
      }

      for (const edge of relatedEdges) {
        if (!existing.edgeIds.includes(edge.id)) {
          existing.edgeIds.push(edge.id);
        }
      }

      byRegime.set(regimeScope, existing);
    }
  }

  return [...byRegime.values()]
    .map((row) => ({
      ...row,
      hypothesisTypes: sortCodePointStrings(row.hypothesisTypes),
      hypothesisRecordIds: sortCodePointStrings(row.hypothesisRecordIds),
      edgeIds: sortCodePointStrings(row.edgeIds),
    }))
    .sort((a, b) => (a.regimeScope < b.regimeScope ? -1 : a.regimeScope > b.regimeScope ? 1 : 0));
}

export function computeLineageDigest(rows: readonly ForecastDecisionLineageRow[]): string {
  return computeSemanticSha256Hex(rows);
}

function matchesQuery(
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
