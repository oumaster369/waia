import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiPattern } from "@/lib/trader/mi/pattern.types";
import {
  computePatternMatchScore,
  meetsPatternMatchThreshold,
  parsePatternDefinitionJson,
} from "@/lib/trader/mi/pattern-catalog-scoring";
import {
  PATTERN_CATALOG_HYPOTHESIS_STATUS,
  PATTERN_CATALOG_SCHEMA_VERSION,
  type PatternCatalogDescriptiveHypothesis,
  type PatternCatalogFeatureSnapshot,
  type PatternCatalogPassResult,
  type PatternCatalogSubject,
} from "@/lib/trader/mi/pattern-catalog.types";
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
    priceDispersion20: cycle.evaluation.msv.physics.priceDispersion20,
    eventRiskScore: cycle.evaluation.msv.futureContext.eventRiskScore,
  };
}

/**
 * Latest cycle whose evaluatedAt is at or before the subject time.
 * A later cycle is never attached, even when it is closer on the clock.
 */
export function resolvePointInTimeCycle(
  cycleResults: readonly PaperCycleResult[],
  timestamp: Date,
): PaperCycleResult | null {
  const target = timestamp.getTime();
  let best: PaperCycleResult | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const cycle of cycleResults) {
    const evaluatedMs = new Date(cycle.evaluation.msv.evaluatedAt).getTime();
    if (!Number.isFinite(evaluatedMs) || evaluatedMs > target) {
      continue;
    }
    if (evaluatedMs >= bestTime) {
      best = cycle;
      bestTime = evaluatedMs;
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
    const cycle = resolvePointInTimeCycle(input.cycleResults, trade.executedAt);
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

export function buildDescriptiveUntestedPatternHypothesis(input: {
  pattern: MiPattern;
  subject: PatternCatalogSubject;
}): PatternCatalogDescriptiveHypothesis {
  return {
    status: PATTERN_CATALOG_HYPOTHESIS_STATUS,
    dataUse: "used_for_discovery",
    patternKey: input.pattern.patternKey,
    subjectRef: input.subject.subjectRef,
    symbol: input.subject.symbol,
    evaluatedAt: input.subject.evaluatedAt,
    statement: "Candidate hypothesis. Discovery data is used_for_discovery and is not IS evidence.",
  };
}

/**
 * Post-hoc pattern catalog pass. Matches use only cycles at or before the subject
 * time and emit candidate hypotheses. Discovery matches are used_for_discovery
 * and are not IS evidence. The pass does not write evidence edges.
 */
export async function runPatternCatalogPass(
  input: RunPatternCatalogPassInput,
): Promise<PatternCatalogPassResult> {
  const subjects = extractPatternCatalogSubjects({
    cycleResults: input.cycleResults,
    closedTrades: input.closedTrades,
  });
  const hypotheses: PatternCatalogDescriptiveHypothesis[] = [];

  for (const subject of subjects) {
    const cycle = resolvePointInTimeCycle(input.cycleResults, new Date(subject.evaluatedAt));
    if (!cycle) {
      continue;
    }
    const features = featuresFromCycle(cycle);

    for (const pattern of input.patterns) {
      const definition = parsePatternDefinitionJson(pattern.definitionJson);
      const breakdown = computePatternMatchScore({ definition, features });
      if (!meetsPatternMatchThreshold(breakdown.matchScore)) {
        continue;
      }
      hypotheses.push(buildDescriptiveUntestedPatternHypothesis({ pattern, subject }));
    }
  }

  return {
    schemaVersion: PATTERN_CATALOG_SCHEMA_VERSION,
    subjectsProcessed: subjects.length,
    scoreRowsWritten: 0,
    explanationRowsWritten: 0,
    edgeRowsWritten: 0,
    hypotheses,
  };
}
