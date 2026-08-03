import { loadPaperFillEvents, type PaperPnLFillEvent } from "@/lib/trader/paper/derive-paper-pnl";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import { orderMatchesStrategyEvidenceScope } from "@/lib/trader/paper/strategy-evidence-scope";
import { buildHtrPnlReportV1 } from "@/lib/trader/accounting/build-htr-pnl-report-v1";
import { BacktestEvaluationExportError } from "@/lib/trader/backtest/backtest-evaluation-export.errors";
import {
  BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION,
  type BacktestEvaluationExportBundle,
  type BacktestEvaluationExportDocument,
  type BacktestEvaluationExportInput,
  type HistoricalExecutionCostProvenance,
} from "@/lib/trader/backtest/backtest-evaluation-export.types";

type HistoricalExecutionCostProvenanceWithDigest = HistoricalExecutionCostProvenance & {
  costModelDigest: string;
};
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import { toBacktestEvaluationExportDocument } from "@/lib/trader/backtest/serialize-backtest-evaluation-export";
import {
  computeHistoricalExecutionAggregateDigest,
  parseHistoricalFillEconomicsExportPayload,
} from "@/lib/trader/execution/fill-economics";
import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/htr-historical-cost-model-authority";
import {
  EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
  HISTORICAL_EXECUTION_MODEL_ID,
  HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
} from "@/lib/trader/execution/historical-execution-model.types";
import { withIdhpsOfflineRebuild } from "@/lib/trader/execution/idhps-hot-path-counters";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";

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

async function buildHistoricalExecutionCostProvenance(
  context: OrgContext,
  orderRepository: OrderRepository,
  executionMode: NonNullable<BacktestEvaluationExportInput["executionMode"]>,
): Promise<HistoricalExecutionCostProvenanceWithDigest | undefined> {
  const orders = await orderRepository.listOrders(context, { executionMode });
  const fills: HistoricalExecutionCostProvenanceWithDigest["fills"] = [];

  for (const order of orders) {
    const events = await orderRepository.listEvents(context, order.id);
    for (const event of events) {
      if (event.eventType !== "fill_recorded") {
        continue;
      }
      const parsed = parseHistoricalFillEconomicsExportPayload(event.payload);
      if (parsed) {
        fills.push(parsed);
      }
    }
  }

  if (fills.length === 0) {
    return undefined;
  }

  fills.sort(
    (a, b) =>
      a.fillSequence - b.fillSequence ||
      a.economicsContentDigest.localeCompare(b.economicsContentDigest),
  );

  return {
    executionModelId: HISTORICAL_EXECUTION_MODEL_ID,
    executionModelSchemaVersion: HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
    executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
    costModelDigest: createHtrHistoricalCostModelAuthorityV1().costModelDigest,
    fillCount: fills.length,
    aggregateEconomicsDigest: computeHistoricalExecutionAggregateDigest(
      fills.map((fill) => fill.economicsContentDigest),
    ),
    fills,
  };
}

/**
 * Compose org period rollup + strategy evaluations into a backtest export bundle.
 *
 * Operational read model — not billing, promotion authorization, or persistence.
 */
export async function buildBacktestEvaluationExport(
  input: BacktestEvaluationExportInput,
): Promise<BacktestEvaluationExportBundle> {
  return withIdhpsOfflineRebuild(async () => {
    assertNonEmptyStrategySignalIds(input.strategySignalIds);

    const executionMode = input.executionMode ?? "mock";
    const sortedStrategySignalIds = sortStrategySignalIds(input.strategySignalIds);
    const derivedAt = input.exportedAt;

    const { fillEvents, filledOrders } = await loadPaperFillEvents({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
      allowOfflineRebuild: true,
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

    const historicalExecutionCost = input.historicalExecutionModel
      ? await buildHistoricalExecutionCostProvenance(
          input.context,
          input.orderRepository,
          executionMode,
        )
      : undefined;

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
          ...(historicalExecutionCost ? (["historical-execution-cost.v1"] as const) : []),
          ...(input.accountingState ? (["htr-pnl-report.v1"] as const) : []),
        ],
      },
      historicalExecutionCost,
      ...(input.accountingState
        ? {
            htrPnlReportV1: buildHtrPnlReportV1({
              state: input.accountingState,
              semanticDigest: input.htrPnlReportSemanticDigest ?? "0".repeat(64),
            }),
          }
        : {}),
      exportedAt: input.exportedAt,
    };
  });
}

export async function buildBacktestEvaluationExportDocument(
  input: BacktestEvaluationExportInput,
): Promise<BacktestEvaluationExportDocument> {
  const bundle = await buildBacktestEvaluationExport(input);
  return toBacktestEvaluationExportDocument(bundle);
}
