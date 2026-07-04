import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiPattern } from "@/lib/trader/mi/pattern.types";
import {
  readHalfLifeBarsFromParams,
  computePatternRelevanceScore,
  resolveAgeBars,
} from "@/lib/trader/mi/pattern-catalog-aging";
import {
  createInitialPatternConfidenceState,
  updatePatternConfidenceState,
  type PatternConfidenceState,
} from "@/lib/trader/mi/pattern-catalog-confidence";
import { buildPatternCatalogExplanationPayload } from "@/lib/trader/mi/pattern-catalog-explanations";
import {
  computePatternMatchScore,
  meetsPatternMatchThreshold,
  parsePatternDefinitionJson,
} from "@/lib/trader/mi/pattern-catalog-scoring";
import {
  PATTERN_CATALOG_SCHEMA_VERSION,
  type PatternCatalogFeatureSnapshot,
  type PatternCatalogPassResult,
  type PatternCatalogSubject,
} from "@/lib/trader/mi/pattern-catalog.types";
import { recordPatternKnowledgePostgres } from "@/lib/trader/knowledge/record-pattern-knowledge";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type RunPatternCatalogPassInput = {
  context: OrgContext;
  ex: PgWriteExecutor;
  patterns: readonly MiPattern[];
  cycleResults: readonly PaperCycleResult[];
  closedTrades: readonly PaperClosedTrade[];
  evaluatedAt?: Date;
  newId?: () => string;
};

function featuresFromCycle(cycle: PaperCycleResult): PatternCatalogFeatureSnapshot {
  return {
    close: cycle.evaluation.features.features.close,
    zscoreVsSma20: cycle.evaluation.msv.physics.zscoreVsSma20,
    realizedVol20: cycle.evaluation.msv.physics.realizedVol20,
    eventRiskScore: cycle.evaluation.msv.futureContext.eventRiskScore,
  };
}

function resolveCycleForTimestamp(
  cycleResults: readonly PaperCycleResult[],
  timestamp: Date,
): PaperCycleResult | null {
  if (cycleResults.length === 0) {
    return null;
  }
  const target = timestamp.getTime();
  let best = cycleResults[0]!;
  let bestDelta = Math.abs(new Date(best.evaluation.msv.evaluatedAt).getTime() - target);
  for (const cycle of cycleResults) {
    const delta = Math.abs(new Date(cycle.evaluation.msv.evaluatedAt).getTime() - target);
    if (delta <= bestDelta) {
      best = cycle;
      bestDelta = delta;
    }
  }
  return best;
}

function closeOutcomeTag(tradePnl: string): PatternCatalogSubject["outcomeTag"] {
  if (compareDecimal(tradePnl, "0") > 0) {
    return "supporting";
  }
  if (compareDecimal(tradePnl, "0") < 0) {
    return "contradicting";
  }
  return "neutral";
}

export function extractPatternCatalogSubjects(input: {
  cycleResults: readonly PaperCycleResult[];
  closedTrades: readonly PaperClosedTrade[];
}): PatternCatalogSubject[] {
  const subjects: PatternCatalogSubject[] = [];

  for (const trade of input.closedTrades) {
    const cycle = resolveCycleForTimestamp(input.cycleResults, trade.executedAt);
    subjects.push({
      kind: "close",
      subjectRef: `close:order:${trade.orderId}`,
      symbol: trade.symbol,
      evaluatedAt: trade.executedAt.toISOString(),
      regime: cycle?.evaluation.msv.derived.regime ?? "RANGE",
      priceMoveUsdt: trade.tradePnl,
      outcomeTag: closeOutcomeTag(trade.tradePnl),
    });
  }

  for (const cycle of input.cycleResults) {
    for (const entry of cycle.strategyExecutions) {
      const rejected =
        entry.execution?.status === "risk_rejected" ||
        (entry.submitBlocked && entry.skipReason === "no_submit");
      if (!rejected) {
        continue;
      }
      subjects.push({
        kind: "rejection",
        subjectRef: `signal:${entry.signal.strategySignalId}:rejected`,
        symbol: entry.signal.symbol,
        evaluatedAt: cycle.evaluation.msv.evaluatedAt,
        regime: cycle.evaluation.msv.derived.regime,
        priceMoveUsdt: null,
        outcomeTag: "neutral",
      });
    }
  }

  return subjects;
}

/**
 * Post-hoc pattern catalog pass — READ inputs, ANALYZE, STORE append-only artifacts.
 * Does not mutate cycle outputs, metrics, or execution semantics.
 */
export async function runPatternCatalogPass(
  input: RunPatternCatalogPassInput,
): Promise<PatternCatalogPassResult> {
  const subjects = extractPatternCatalogSubjects({
    cycleResults: input.cycleResults,
    closedTrades: input.closedTrades,
  });

  const confidenceByPatternKey = new Map<string, PatternConfidenceState>();
  const lastMatchAtMsByPatternKey = new Map<string, number>();

  let scoreRowsWritten = 0;
  let explanationRowsWritten = 0;
  let edgeRowsWritten = 0;

  for (const subject of subjects) {
    const cycle = resolveCycleForTimestamp(input.cycleResults, new Date(subject.evaluatedAt));
    if (!cycle) {
      continue;
    }
    const features = featuresFromCycle(cycle);
    const subjectEvaluatedMs = new Date(subject.evaluatedAt).getTime();

    for (const pattern of input.patterns) {
      const definition = parsePatternDefinitionJson(pattern.definitionJson);
      const breakdown = computePatternMatchScore({ definition, features });
      if (!meetsPatternMatchThreshold(breakdown.matchScore)) {
        continue;
      }

      const priorState =
        confidenceByPatternKey.get(pattern.patternKey) ?? createInitialPatternConfidenceState();
      const confidence = updatePatternConfidenceState({
        state: priorState,
        outcomeTag: subject.outcomeTag,
      });
      confidenceByPatternKey.set(pattern.patternKey, confidence.state);

      const lastMatchAtMs = lastMatchAtMsByPatternKey.get(pattern.patternKey) ?? null;
      const ageBars = resolveAgeBars({
        evaluatedAtMs: subjectEvaluatedMs,
        lastMatchAtMs,
      });
      const halfLifeBars = readHalfLifeBarsFromParams(definition.recurrence.params);
      const relevanceScore = computePatternRelevanceScore({
        matchScore: breakdown.matchScore,
        ageBars,
        halfLifeBars,
      });
      lastMatchAtMsByPatternKey.set(pattern.patternKey, subjectEvaluatedMs);

      const match = {
        pattern,
        breakdown,
        scores: {
          matchScore: breakdown.matchScore,
          relevanceScore,
          confidenceMean: confidence.confidenceMean,
          confidenceBandLow: confidence.confidenceBandLow,
          confidenceBandHigh: confidence.confidenceBandHigh,
          priorHits: confidence.state.priorHits,
          priorMisses: confidence.state.priorMisses,
          rationale: confidence.rationale,
        },
      };

      const explanation = buildPatternCatalogExplanationPayload({ subject, match });
      await recordPatternKnowledgePostgres(input.ex, input.context, {
        explanation,
        recordedAt: new Date(subject.evaluatedAt),
        newId: input.newId,
      });

      scoreRowsWritten += 1;
      explanationRowsWritten += 1;
      edgeRowsWritten += 1;
    }
  }

  return {
    schemaVersion: PATTERN_CATALOG_SCHEMA_VERSION,
    subjectsProcessed: subjects.length,
    scoreRowsWritten,
    explanationRowsWritten,
    edgeRowsWritten,
  };
}
