import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import {
  buildPaperPnLFromLedger,
  buildQuoteCurrencyBySymbol,
  computeUnrealizedFromLedgerForMarks,
  countOpenPositionsFromLedger,
  extractForcedFlatMarkToCloseTrades,
  extractInWindowClosedTrades,
  loadPaperFillEvents,
  resolvePaperPnLQuoteCurrency,
  walkFillsForPnL,
  type PaperMarkToCloseTrade,
  type PaperPnLFillEvent,
} from "@/lib/trader/paper/derive-paper-pnl";
import { orderMatchesStrategyEvidenceScope } from "@/lib/trader/paper/strategy-evidence-scope";
import { PaperPnLScopeError, PaperPnLWindowError } from "@/lib/trader/paper/paper-pnl.errors";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import type {
  PaperClosedTrade,
  PaperStrategyEvaluation,
} from "@/lib/trader/paper/paper-strategy-eval.types";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type DerivePaperStrategyEvaluationInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  strategySignalId: string;
  window: PaperPnLWindow;
  executionMode?: PaperBookExecutionMode;
  markPrices?: PaperPnLMarkPrices;
  /** Skip repository load when batching multiple strategies/windows. */
  fillEvents?: PaperPnLFillEvent[];
  forcedFlat?: ForcedFlatMarkToCloseInput;
};

export type ForcedFlatMarkToCloseInput = {
  boundaryClosePrice: string;
  boundaryTimestamp: Date;
  costModel: CostModelV1;
  newSyntheticId?: (symbol: string) => string;
};

export type DerivePaperStrategyEvaluationsInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  strategySignalIds: string[];
  window: PaperPnLWindow;
  executionMode?: PaperBookExecutionMode;
  markPrices?: PaperPnLMarkPrices;
  fillEvents?: PaperPnLFillEvent[];
  derivedAt?: Date;
  forcedFlat?: ForcedFlatMarkToCloseInput;
};

function assertValidWindow(window: PaperPnLWindow): void {
  if (window.start.getTime() >= window.end.getTime()) {
    throw new PaperPnLWindowError(
      `invalid window: start ${window.start.toISOString()} must be before end ${window.end.toISOString()}`,
    );
  }
}

function filterFillEventsByStrategy(
  fillEvents: readonly PaperPnLFillEvent[],
  registryStrategyId: string,
): PaperPnLFillEvent[] {
  return fillEvents.filter((event) =>
    orderMatchesStrategyEvidenceScope(event.order, registryStrategyId),
  );
}

function partitionFillEventsByWindow(
  fillEvents: readonly PaperPnLFillEvent[],
  window: PaperPnLWindow,
): {
  openingEvents: PaperPnLFillEvent[];
  inWindowEvents: PaperPnLFillEvent[];
} {
  const openingEvents: PaperPnLFillEvent[] = [];
  const inWindowEvents: PaperPnLFillEvent[] = [];
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  for (const event of fillEvents) {
    const executedMs = event.fill.executedAt.getTime();
    if (executedMs < startMs) {
      openingEvents.push(event);
    } else if (executedMs >= startMs && executedMs < endMs) {
      inWindowEvents.push(event);
    }
  }

  return { openingEvents, inWindowEvents };
}

function collectSymbols(fillEvents: readonly PaperPnLFillEvent[]): string[] {
  return [...new Set(fillEvents.map((event) => event.order.symbol))];
}

function sortClosedTrades(trades: readonly PaperClosedTrade[]): PaperClosedTrade[] {
  return [...trades].sort((a, b) => {
    const timeDelta = a.executedAt.getTime() - b.executedAt.getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return a.fillId.localeCompare(b.fillId);
  });
}

function computeTradeStatistics(
  closedTrades: readonly PaperClosedTrade[],
  periodRealizedPnl: string,
): Pick<
  PaperStrategyEvaluation,
  | "closedTrades"
  | "closedTradeCount"
  | "winCount"
  | "lossCount"
  | "breakevenCount"
  | "winRate"
  | "lossRate"
  | "averageWin"
  | "averageLoss"
  | "grossProfit"
  | "grossLoss"
  | "profitFactor"
  | "expectancy"
  | "maxRealizedDrawdown"
  | "recoveryFactor"
> {
  const sortedTrades = sortClosedTrades(closedTrades);
  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let grossProfit = "0";
  let grossLoss = "0";

  for (const trade of sortedTrades) {
    const comparison = compareDecimal(trade.tradePnl, "0");
    if (comparison > 0) {
      winCount += 1;
      grossProfit = addDecimal(grossProfit, trade.tradePnl);
    } else if (comparison < 0) {
      lossCount += 1;
      grossLoss = addDecimal(grossLoss, multiplyDecimal(trade.tradePnl, "-1"));
    } else {
      breakevenCount += 1;
    }
  }

  const decisiveCount = winCount + lossCount;
  let winRate: string | null = null;
  let lossRate: string | null = null;
  if (decisiveCount > 0) {
    winRate = divideDecimal(String(winCount), String(decisiveCount));
    lossRate = divideDecimal(String(lossCount), String(decisiveCount));
  }

  let averageWin: string | null = null;
  if (winCount > 0) {
    averageWin = divideDecimal(grossProfit, String(winCount));
  }

  let averageLoss: string | null = null;
  if (lossCount > 0) {
    averageLoss = divideDecimal(multiplyDecimal(grossLoss, "-1"), String(lossCount));
  }

  let profitFactor: string | null = null;
  if (compareDecimal(grossLoss, "0") > 0) {
    profitFactor = divideDecimal(grossProfit, grossLoss);
  }

  let expectancy: string | null = null;
  if (decisiveCount > 0) {
    let expected = "0";
    if (winCount > 0 && winRate !== null && averageWin !== null) {
      expected = addDecimal(expected, multiplyDecimal(winRate, averageWin));
    }
    if (lossCount > 0 && lossRate !== null && averageLoss !== null) {
      expected = addDecimal(expected, multiplyDecimal(lossRate, averageLoss));
    }
    expectancy = expected;
  }

  let peak = "0";
  let cumulative = "0";
  let maxRealizedDrawdown = "0";
  for (const trade of sortedTrades) {
    cumulative = addDecimal(cumulative, trade.tradePnl);
    if (compareDecimal(cumulative, peak) > 0) {
      peak = cumulative;
    }
    const drawdown = subtractDecimal(peak, cumulative);
    if (compareDecimal(drawdown, maxRealizedDrawdown) > 0) {
      maxRealizedDrawdown = drawdown;
    }
  }

  let recoveryFactor: string | null = null;
  if (compareDecimal(maxRealizedDrawdown, "0") > 0) {
    recoveryFactor = divideDecimal(periodRealizedPnl, maxRealizedDrawdown);
  }

  return {
    closedTrades: sortedTrades,
    closedTradeCount: sortedTrades.length,
    winCount,
    lossCount,
    breakevenCount,
    winRate,
    lossRate,
    averageWin,
    averageLoss,
    grossProfit,
    grossLoss,
    profitFactor,
    expectancy,
    maxRealizedDrawdown,
    recoveryFactor,
  };
}

function sumMarkToClosePnl(trades: readonly PaperMarkToCloseTrade[]): string {
  return trades.reduce((total, trade) => addDecimal(total, trade.tradePnl), "0");
}

function derivePaperStrategyEvaluationFromEvents(input: {
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  strategySignalId: string;
  window: PaperPnLWindow;
  markPrices?: PaperPnLMarkPrices;
  fillEvents: readonly PaperPnLFillEvent[];
  derivedAt?: Date;
  forcedFlat?: ForcedFlatMarkToCloseInput;
}): PaperStrategyEvaluation {
  const strategyEvents = filterFillEventsByStrategy(input.fillEvents, input.strategySignalId);
  const symbols = collectSymbols(strategyEvents);
  const quoteCurrency = resolvePaperPnLQuoteCurrency(symbols, input.markPrices);
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);

  const { openingEvents, inWindowEvents } = partitionFillEventsByWindow(
    strategyEvents,
    input.window,
  );

  const openingWalk = walkFillsForPnL(openingEvents, quoteCurrencyBySymbol);
  const endWalk = walkFillsForPnL(
    inWindowEvents,
    quoteCurrencyBySymbol,
    openingWalk.ledgerBySymbol,
  );

  const periodRealizedPnl = subtractDecimal(endWalk.realizedPnl, openingWalk.realizedPnl);
  const periodTotalFees = subtractDecimal(endWalk.totalFees, openingWalk.totalFees);
  const periodFeesByAsset = { ...endWalk.feesByAsset };
  const periodValuationGaps = [...endWalk.valuationGaps];

  const derivedAt = input.derivedAt ?? new Date();
  const endSnapshot = buildPaperPnLFromLedger({
    organizationId: input.organizationId,
    executionMode: input.executionMode,
    quoteCurrency,
    walk: endWalk,
    markPrices: input.markPrices,
    derivedAt,
  });

  let periodUnrealizedChange: string | null = null;
  let periodTotalPnlChange: string | null = null;

  if (input.markPrices !== undefined) {
    const startGaps: string[] = [];
    const startUnrealized = computeUnrealizedFromLedgerForMarks(
      openingWalk.ledgerBySymbol,
      input.markPrices,
      startGaps,
    );
    periodValuationGaps.push(...startGaps);

    if (startUnrealized !== null && endSnapshot.unrealizedPnl !== null) {
      periodUnrealizedChange = subtractDecimal(endSnapshot.unrealizedPnl, startUnrealized);
      periodTotalPnlChange = addDecimal(periodRealizedPnl, periodUnrealizedChange);
    }
  }

  const rawClosedTrades = extractInWindowClosedTrades(
    openingEvents,
    inWindowEvents,
    quoteCurrencyBySymbol,
  );
  const tradeStats = computeTradeStatistics(rawClosedTrades, periodRealizedPnl);

  const openPositionCount = countOpenPositionsFromLedger(endWalk.ledgerBySymbol);
  let markToCloseTrades: PaperMarkToCloseTrade[] = [];
  if (input.forcedFlat) {
    markToCloseTrades = extractForcedFlatMarkToCloseTrades({
      openingEvents,
      inWindowEvents,
      quoteCurrencyBySymbol,
      boundaryClosePrice: input.forcedFlat.boundaryClosePrice,
      boundaryTimestamp: input.forcedFlat.boundaryTimestamp,
      costModel: input.forcedFlat.costModel,
      newSyntheticId: input.forcedFlat.newSyntheticId,
    });
  }
  const periodMarkedPnl = addDecimal(periodRealizedPnl, sumMarkToClosePnl(markToCloseTrades));

  return {
    organizationId: input.organizationId,
    executionMode: input.executionMode,
    strategySignalId: input.strategySignalId,
    quoteCurrency,
    window: input.window,
    periodRealizedPnl,
    periodTotalFees,
    periodFeesByAsset,
    periodValuationGaps,
    periodUnrealizedChange,
    periodTotalPnlChange,
    endSnapshot,
    derivedAt,
    markToCloseTrades,
    markToCloseTradeCount: markToCloseTrades.length,
    openPositionCount,
    periodMarkedPnl,
    ...tradeStats,
  };
}

/**
 * Idempotent derived Paper strategy evaluation for caller-supplied windows.
 *
 * Operational read model — not billing, HWM, equity, or accounting ledger.
 */
export async function derivePaperStrategyEvaluation(
  input: DerivePaperStrategyEvaluationInput,
): Promise<PaperStrategyEvaluation> {
  const executionMode = input.executionMode ?? "mock";
  if (executionMode !== "mock" && executionMode !== "paper") {
    throw new PaperPnLScopeError(
      `execution mode ${executionMode} is out of scope for paper strategy evaluation`,
    );
  }

  assertValidWindow(input.window);

  const fillEvents =
    input.fillEvents ??
    (
      await loadPaperFillEvents({
        context: input.context,
        orderRepository: input.orderRepository,
        executionMode,
      })
    ).fillEvents;

  return derivePaperStrategyEvaluationFromEvents({
    organizationId: input.context.organizationId,
    executionMode,
    strategySignalId: input.strategySignalId,
    window: input.window,
    markPrices: input.markPrices,
    fillEvents,
    forcedFlat: input.forcedFlat,
  });
}

/**
 * Batch strategy evaluation with a single repository pass (or shared injected events).
 */
export async function derivePaperStrategyEvaluations(
  input: DerivePaperStrategyEvaluationsInput,
): Promise<PaperStrategyEvaluation[]> {
  const executionMode = input.executionMode ?? "mock";
  if (executionMode !== "mock" && executionMode !== "paper") {
    throw new PaperPnLScopeError(
      `execution mode ${executionMode} is out of scope for paper strategy evaluation`,
    );
  }

  assertValidWindow(input.window);

  const fillEvents =
    input.fillEvents ??
    (
      await loadPaperFillEvents({
        context: input.context,
        orderRepository: input.orderRepository,
        executionMode,
      })
    ).fillEvents;

  const derivedAt = input.derivedAt ?? new Date();
  return input.strategySignalIds.map((strategySignalId) =>
    derivePaperStrategyEvaluationFromEvents({
      organizationId: input.context.organizationId,
      executionMode,
      strategySignalId,
      window: input.window,
      markPrices: input.markPrices,
      fillEvents,
      derivedAt,
      forcedFlat: input.forcedFlat,
    }),
  );
}
