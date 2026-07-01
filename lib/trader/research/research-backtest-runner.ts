import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { Bar, Regime } from "@/lib/trader/intelligence/types";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { addDecimal, divideDecimal } from "@/lib/trader/risk/numeric";
import { buildResearchRegimeCoverage } from "@/lib/trader/research/regime-taxonomy";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type RunResearchValidationBacktestInput = {
  context: OrgContext;
  bars: readonly Bar[];
  strategyId: string;
  strategyVersion: string;
  datasetId: string;
  runId: string;
  split: "train" | "validation" | "blind";
  costModel: CostModelV1;
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  accountKey: string;
  defaultQuantity: string;
  accountState?: AccountRiskState;
  exportedAt?: Date;
  newId?: () => string;
};

const EMPTY_ACCOUNT_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

type RegimeAccumulator = {
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
};

function parseWindowFromBars(bars: readonly Bar[]): { start: Date; end: Date } {
  const start = new Date(bars[0]!.barOpenTime);
  const end = new Date(bars.at(-1)!.barCloseTime);
  return { start, end };
}

/**
 * Runs a cost-aware backtest over a bar window and derives {@link ResearchValidationMetrics}
 * with per-CDE-regime slices from cycle MSV envelopes.
 */
export async function runResearchValidationBacktest(
  input: RunResearchValidationBacktestInput,
): Promise<ResearchValidationMetrics> {
  if (input.bars.length < 20) {
    throw new Error("[research] validation backtest requires at least 20 bars");
  }

  const barSource = new HistoricalBarReplaySource({ bars: input.bars });
  const window = parseWindowFromBars(input.bars);
  const exportedAt = input.exportedAt ?? new Date(window.end);

  const backtest = await runBacktest({
    context: input.context,
    barSource,
    deps: input.deps,
    orderRepository: input.orderRepository,
    accountKey: input.accountKey,
    defaultQuantity: input.defaultQuantity,
    costModel: input.costModel,
    strategySignalIds: [input.strategyId],
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    regimeLabel: "AGGREGATE",
    datasetId: input.datasetId,
    runId: input.runId,
    split: input.split,
    window,
    accountState: input.accountState ?? EMPTY_ACCOUNT_STATE,
    exportedAt,
    activeStrategyIds: [input.strategyId],
    refreshAccountStateBetweenStrategies: true,
    newId: input.newId,
  });

  const regimeAccumulators = new Map<Regime, RegimeAccumulator>();

  for (const cycle of backtest.cycleResults) {
    const regime = cycle.evaluation.msv.derived.regime;
    const submitted = cycle.strategyExecutions.filter(
      (entry) => entry.execution?.status === "submitted",
    );
    if (submitted.length === 0) {
      continue;
    }

    const current = regimeAccumulators.get(regime) ?? {
      tradeCount: 0,
      periodRealizedPnl: "0",
      periodTotalFees: "0",
    };
    current.tradeCount += submitted.length;
    regimeAccumulators.set(regime, current);
  }

  const evaluations = await derivePaperStrategyEvaluations({
    context: input.context,
    orderRepository: input.orderRepository,
    strategySignalIds: [input.strategyId],
    window,
    executionMode: "mock",
    derivedAt: exportedAt,
  });

  const aggregate = evaluations[0];
  const periodRealizedPnl = aggregate?.periodRealizedPnl ?? "0";
  const periodTotalFees = aggregate?.periodTotalFees ?? "0";
  const closedTradeCount = aggregate?.closedTradeCount ?? 0;

  if (closedTradeCount > 0 && regimeAccumulators.size === 0) {
    const fallbackRegime = backtest.cycleResults.at(-1)?.evaluation.msv.derived.regime ?? "RANGE";
    regimeAccumulators.set(fallbackRegime, {
      tradeCount: closedTradeCount,
      periodRealizedPnl,
      periodTotalFees,
    });
  } else if (closedTradeCount > 0 && regimeAccumulators.size > 0) {
    const perRegimePnl = divideEvenly(periodRealizedPnl, regimeAccumulators.size);
    const perRegimeFees = divideEvenly(periodTotalFees, regimeAccumulators.size);
    let index = 0;
    for (const [regime, acc] of regimeAccumulators) {
      acc.periodRealizedPnl = perRegimePnl[index] ?? "0";
      acc.periodTotalFees = perRegimeFees[index] ?? "0";
      regimeAccumulators.set(regime, acc);
      index += 1;
    }
  }

  const byRegime = [...regimeAccumulators.entries()]
    .filter(([, acc]) => acc.tradeCount > 0)
    .map(([regimeLabel, acc]) => ({
      regimeLabel,
      tradeCount: acc.tradeCount,
      periodRealizedPnl: acc.periodRealizedPnl,
      periodTotalFees: acc.periodTotalFees,
    }))
    .sort((a, b) => a.regimeLabel.localeCompare(b.regimeLabel));

  return {
    schemaVersion: "1.0.0",
    tradeCount: closedTradeCount,
    periodRealizedPnl,
    periodTotalFees,
    byRegime,
  };
}

function divideEvenly(total: string, parts: number): string[] {
  if (parts <= 0) {
    return [];
  }
  const share = divideDecimal(total, String(parts));
  return Array.from({ length: parts }, () => share);
}

export function collectRegimeCoverageFromValidationMetrics(
  metrics: readonly ResearchValidationMetrics[],
) {
  const labels = new Set<string>();
  for (const entry of metrics) {
    for (const slice of entry.byRegime) {
      if (slice.tradeCount > 0) {
        labels.add(slice.regimeLabel);
      }
    }
  }
  return buildResearchRegimeCoverage([...labels]);
}

// Re-export for orchestrator convenience
export { buildResearchRegimeCoverage };
