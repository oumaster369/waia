import { loadPaperFillEvents, type PaperPnLFillEvent } from "@/lib/trader/paper/derive-paper-pnl";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import { orderMatchesStrategyEvidenceScope } from "@/lib/trader/paper/strategy-evidence-scope";
import { BacktestEvaluationExportError } from "@/lib/trader/backtest/backtest-evaluation-export.errors";
import {
  BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION,
  type BacktestEvaluationExportBundle,
  type BacktestEvaluationExportDocument,
  type BacktestEvaluationExportInput,
} from "@/lib/trader/backtest/backtest-evaluation-export.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import { toBacktestEvaluationExportDocument } from "@/lib/trader/backtest/serialize-backtest-evaluation-export";

function sortStrategySignalIds(strategySignalIds: readonly string[]): string[] {
  return [...strategySignalIds].sort((a, b) => a.localeCompare(b));
}

function assertNonEmptyStrategySignalIds(strategySignalIds: readonly string[]): void {
  if (strategySignalIds.length === 0) {
    throw new BacktestEvaluationExportError("strategySignalIds must be non-empty");
  }
}

function strategyHasInWindowFills(
  fillEvents: readonly PaperPnLFillEvent[],
  strategySignalId: string,
  window: PaperPnLWindow,
): boolean {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  return fillEvents.some((event) => {
    if (!orderMatchesStrategyEvidenceScope(event.order, strategySignalId)) {
      return false;
    }
    const executedMs = event.fill.executedAt.getTime();
    return executedMs >= startMs && executedMs < endMs;
  });
}

function mergeValuationGaps(...gapLists: readonly string[][]): string[] {
  return [...new Set(gapLists.flat())].sort((a, b) => a.localeCompare(b));
}

/**
 * Compose org period rollup + strategy evaluations into a backtest export bundle.
 *
 * Operational read model — not billing, promotion authorization, or persistence.
 */
export async function buildBacktestEvaluationExport(
  input: BacktestEvaluationExportInput,
): Promise<BacktestEvaluationExportBundle> {
  assertNonEmptyStrategySignalIds(input.strategySignalIds);

  const executionMode = input.executionMode ?? "mock";
  const sortedStrategySignalIds = sortStrategySignalIds(input.strategySignalIds);
  const derivedAt = input.exportedAt;

  const { fillEvents, filledOrders } = await loadPaperFillEvents({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode,
  });

  const [orgPeriodRollup, strategyEvaluations] = await Promise.all([
    derivePaperPnLPeriod({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
      window: input.window,
      markPrices: input.markPrices,
      fillEvents,
      derivedAt,
    }),
    derivePaperStrategyEvaluations({
      context: input.context,
      orderRepository: input.orderRepository,
      strategySignalIds: sortedStrategySignalIds,
      window: input.window,
      executionMode,
      markPrices: input.markPrices,
      fillEvents,
      derivedAt,
    }),
  ]);

  const strategiesWithNoFills = sortedStrategySignalIds.filter(
    (strategySignalId) => !strategyHasInWindowFills(fillEvents, strategySignalId, input.window),
  );

  const valuationGaps = mergeValuationGaps(
    orgPeriodRollup.periodValuationGaps,
    ...strategyEvaluations.map((evaluation) => evaluation.periodValuationGaps),
  );

  return {
    schemaVersion: BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION,
    organizationId: input.context.organizationId,
    executionMode,
    costModel: input.costModel,
    window: input.window,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    regimeLabel: input.regimeLabel,
    datasetId: input.datasetId,
    runId: input.runId,
    split: input.split,
    cycleCount: input.cycleCount,
    orgPeriodRollup,
    strategyEvaluations,
    dataQuality: {
      reconciliationStatus: "clean",
      valuationGapCount: valuationGaps.length,
      valuationGaps,
      unrealizedAvailable: input.markPrices !== undefined,
      strategiesWithNoFills,
    },
    provenance: {
      source: "backtest_run",
      runId: input.runId,
      datasetId: input.datasetId,
      split: input.split,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      regimeLabel: input.regimeLabel,
      costModelVersion: input.costModel.version,
      cycleCount: input.cycleCount,
      fillEventCount: fillEvents.length,
      filledOrderCount: filledOrders.length,
      strategySignalIds: sortedStrategySignalIds,
      readModelSlices: [
        "paper-pnl.v1",
        "paper-pnl-period.v1",
        "paper-strategy-eval.v1",
        "backtest-cost-model.v1",
      ],
    },
    exportedAt: input.exportedAt,
  };
}

export async function buildBacktestEvaluationExportDocument(
  input: BacktestEvaluationExportInput,
): Promise<BacktestEvaluationExportDocument> {
  const bundle = await buildBacktestEvaluationExport(input);
  return toBacktestEvaluationExportDocument(bundle);
}
