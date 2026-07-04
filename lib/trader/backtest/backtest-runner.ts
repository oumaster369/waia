import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { applyCostToFill, type CostModelV1 } from "@/lib/trader/execution/cost-model";
import type {
  OrderRepository,
  RecordFillInput,
} from "@/lib/trader/execution/order-repository.types";
import {
  buildBacktestEvaluationExport,
  buildBacktestEvaluationExportDocument,
} from "@/lib/trader/backtest/build-backtest-evaluation-export";
import type {
  BacktestEvaluationExportBundle,
  BacktestEvaluationExportDocument,
  BacktestRegimeMetrics,
} from "@/lib/trader/backtest/backtest-evaluation-export.types";
import type { BarReplaySource } from "@/lib/trader/market-data/types";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import type { PaperCycleDeps, PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import { derivePortfolioAccountState, toAccountRiskState } from "@/lib/trader/portfolio";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type RunBacktestInput = {
  context: OrgContext;
  barSource: BarReplaySource;
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  accountKey: string;
  defaultQuantity: string;
  costModel: CostModelV1;
  strategySignalIds: string[];
  strategyId: string;
  strategyVersion: string;
  regimeLabel: string;
  datasetId: string;
  runId: string;
  split: "train" | "validation" | "blind";
  window: PaperPnLWindow;
  accountState: AccountRiskState;
  exportedAt: Date;
  activeStrategyIds?: readonly string[];
  markPrices?: PaperPnLMarkPrices;
  refreshAccountStateBetweenStrategies?: boolean;
  portfolio?: PortfolioCycleContext;
  telemetrySink?: WaiaTraderTelemetrySink;
  newId?: () => string;
  maxCycles?: number;
};

export type RunBacktestResult = {
  cycleCount: number;
  cycleResults: PaperCycleResult[];
  exportBundle: BacktestEvaluationExportBundle;
  exportDocument: BacktestEvaluationExportDocument;
  evidenceDigest: string;
  regimeMetrics: BacktestRegimeMetrics[];
};

function wrapOrderRepositoryWithCostModel(
  inner: OrderRepository,
  costModel: CostModelV1,
): OrderRepository {
  return {
    ...inner,
    async recordFill(context, input: RecordFillInput) {
      const order = await inner.getOrderById(context, input.orderId);
      if (!order) {
        return inner.recordFill(context, input);
      }

      const adjusted = applyCostToFill(input.price, input.quantity, order.side, costModel);
      return inner.recordFill(context, {
        ...input,
        price: adjusted.adjustedPrice,
        fee: adjusted.fee,
        feeAsset: "USDT",
      });
    },
  };
}

function buildRegimeMetrics(
  bundle: BacktestEvaluationExportBundle,
  document: BacktestEvaluationExportDocument,
): BacktestRegimeMetrics[] {
  return bundle.strategyEvaluations.map((evaluation) => ({
    regimeLabel: bundle.regimeLabel,
    strategySignalId: evaluation.strategySignalId,
    periodRealizedPnl: evaluation.periodRealizedPnl,
    periodTotalFees: evaluation.periodTotalFees,
    closedTradeCount: evaluation.closedTradeCount,
    winRate: evaluation.winRate,
    profitFactor: evaluation.profitFactor,
    expectancy: evaluation.expectancy,
    maxRealizedDrawdown: evaluation.maxRealizedDrawdown,
    recoveryFactor: evaluation.recoveryFactor,
    evidenceContentDigest: document.envelope.contentDigest,
  }));
}

/**
 * Replays historical bars through `runPaperCycleOnce` (mock mode), applies the
 * versioned cost model on fills, and derives strategy metrics for export.
 */
export async function runBacktest(input: RunBacktestInput): Promise<RunBacktestResult> {
  const costAwareRepository = wrapOrderRepositoryWithCostModel(
    input.orderRepository,
    input.costModel,
  );

  const cycleResults: PaperCycleResult[] = [];
  let accountState = input.accountState;
  const maxCycles = input.maxCycles ?? Number.POSITIVE_INFINITY;

  while (cycleResults.length < maxCycles) {
    const next = input.barSource.next();
    if (next.done) {
      break;
    }

    const snapshot =
      input.activeStrategyIds === undefined
        ? next.snapshot
        : { ...next.snapshot, activeStrategyIds: input.activeStrategyIds };

    const result = await runPaperCycleOnce(input.deps, {
      context: input.context,
      snapshot,
      accountKey: input.accountKey,
      defaultQuantity: input.defaultQuantity,
      executionMode: "mock",
      accountState,
      orderRepository: costAwareRepository,
      refreshAccountStateBetweenStrategies: input.refreshAccountStateBetweenStrategies,
      telemetrySink: input.telemetrySink,
      newId: input.newId,
      portfolio: input.portfolio,
    });

    cycleResults.push(result);

    if (input.refreshAccountStateBetweenStrategies) {
      if (input.portfolio) {
        const portfolio = await derivePortfolioAccountState({
          context: input.context,
          orderRepository: costAwareRepository,
          runConfig: input.portfolio.runConfig,
          limits: input.portfolio.limits,
          stopDistanceProvider: input.portfolio.stopDistanceProvider,
          executionMode: "mock",
          markPrices: input.markPrices,
        });
        const openOrders = await costAwareRepository.listOpenOrders(input.context, {
          executionMode: "mock",
        });
        accountState = toAccountRiskState({
          portfolio,
          openOrderCount: openOrders.length,
        });
      } else {
        accountState = await deriveAccountRiskStateFromMockOrders({
          context: input.context,
          orderRepository: costAwareRepository,
          executionMode: "mock",
        });
      }
    }
  }

  const exportInput = {
    context: input.context,
    orderRepository: costAwareRepository,
    window: input.window,
    strategySignalIds: input.strategySignalIds,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    costModel: input.costModel,
    regimeLabel: input.regimeLabel,
    datasetId: input.datasetId,
    runId: input.runId,
    split: input.split,
    cycleCount: cycleResults.length,
    executionMode: "mock" as const,
    markPrices: input.markPrices,
    exportedAt: input.exportedAt,
  };

  const [exportBundle, exportDocument] = await Promise.all([
    buildBacktestEvaluationExport(exportInput),
    buildBacktestEvaluationExportDocument(exportInput),
  ]);

  return {
    cycleCount: cycleResults.length,
    cycleResults,
    exportBundle,
    exportDocument,
    evidenceDigest: exportDocument.envelope.contentDigest,
    regimeMetrics: buildRegimeMetrics(exportBundle, exportDocument),
  };
}
