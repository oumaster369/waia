import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { derivePaperBook } from "@/lib/trader/paper/derive-paper-book";
import {
  buildQuoteCurrencyBySymbol,
  loadPaperFillEvents,
  walkFillsForPnL,
} from "@/lib/trader/paper/derive-paper-pnl";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type {
  PortfolioAccountState,
  PortfolioPositionSnapshot,
  PortfolioSizingLimits,
} from "@/lib/trader/portfolio/portfolio-account.types";
import { PORTFOLIO_RISK_SEMANTICS_VERSION_V1 } from "@/lib/trader/portfolio/portfolio-semantics";
import type { PortfolioRunConfig } from "@/lib/trader/portfolio/portfolio-run-config.types";
import type { StopDistanceProvider } from "@/lib/trader/portfolio/stop-distance-provider.types";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type DerivePortfolioAccountStateInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  runConfig: PortfolioRunConfig;
  limits: PortfolioSizingLimits;
  stopDistanceProvider: StopDistanceProvider;
  executionMode?: PaperBookExecutionMode;
  markPrices?: PaperPnLMarkPrices;
  /** Synthetic signal for stop-distance on open lots (M2: metadata only). */
  stopDistanceSignal?: StrategySignal;
};

function parseQuoteCurrency(symbol: string): string {
  const parts = symbol.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[trader/portfolio] invalid symbol for quote currency: ${symbol}`);
  }
  return parts[1];
}

function computeAvailableBalanceFromFills(
  startingBalanceUsdt: string,
  events: readonly {
    fill: { price: string; quantity: string; fee: string };
    order: { side: "buy" | "sell" };
  }[],
): { availableBalanceUsdt: string; feesPaidUsdt: string } {
  let available = startingBalanceUsdt;
  let feesPaid = "0";

  for (const { fill, order } of events) {
    const notional = multiplyDecimal(fill.price, fill.quantity);
    feesPaid = addDecimal(feesPaid, fill.fee);
    if (order.side === "buy") {
      available = subtractDecimal(available, addDecimal(notional, fill.fee));
    } else {
      available = addDecimal(available, subtractDecimal(notional, fill.fee));
    }
  }

  return { availableBalanceUsdt: available, feesPaidUsdt: feesPaid };
}

function buildStopDistanceSignal(context: OrgContext): StrategySignal {
  return {
    strategySignalId: "portfolio-stop-distance-synthetic",
    strategyId: "mean_reversion_v0",
    strategyVersion: "0",
    organizationId: context.organizationId,
    symbol: "BTC/USDT",
    outcome: "NO_SIGNAL",
    reasonCodes: [],
    msvId: "msv-synthetic",
    featureSetId: "fs-synthetic",
    evaluatedAt: new Date(0).toISOString(),
  };
}

/**
 * Derives deposit-aware USDT spot portfolio state from persisted mock/paper orders.
 */
export async function derivePortfolioAccountState(
  input: DerivePortfolioAccountStateInput,
): Promise<PortfolioAccountState> {
  const executionMode = input.executionMode ?? "mock";
  const [book, loaded] = await Promise.all([
    derivePaperBook({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
    loadPaperFillEvents({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
  ]);

  const events = loaded.fillEvents;
  const symbols = [...new Set(events.map((event) => event.order.symbol))];
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);
  const walk = walkFillsForPnL(events, quoteCurrencyBySymbol);
  const { availableBalanceUsdt, feesPaidUsdt } = computeAvailableBalanceFromFills(
    input.runConfig.startingBalanceUsdt,
    events,
  );

  const stopSignal = input.stopDistanceSignal ?? buildStopDistanceSignal(input.context);
  const positions: PortfolioPositionSnapshot[] = [];
  let markedPnlUsdt = "0";
  let openRiskUsdt = "0";
  let inventoryMarkValue = "0";

  for (const position of book.positions) {
    if (compareDecimal(position.quantity, "0") <= 0) {
      continue;
    }

    const ledger = walk.ledgerBySymbol.get(position.symbol);
    const avgCost = ledger?.avgCost ?? "0";
    const markPrice =
      input.markPrices?.marks[position.symbol] ??
      (compareDecimal(avgCost, "0") > 0 ? avgCost : "0");

    const unrealizedPnlUsdt = multiplyDecimal(
      subtractDecimal(markPrice, avgCost),
      position.quantity,
    );
    markedPnlUsdt = addDecimal(markedPnlUsdt, unrealizedPnlUsdt);
    inventoryMarkValue = addDecimal(
      inventoryMarkValue,
      multiplyDecimal(markPrice, position.quantity),
    );

    const stop = input.stopDistanceProvider.resolveStopDistance({
      entryPrice: avgCost,
      symbol: position.symbol,
      side: "buy",
      signal: { ...stopSignal, symbol: position.symbol },
      runConfig: input.runConfig,
    });
    const riskAtStopUsdt = multiplyDecimal(position.quantity, stop.stopDistanceUsdt);
    openRiskUsdt = addDecimal(openRiskUsdt, riskAtStopUsdt);

    positions.push({
      symbol: position.symbol,
      quantity: position.quantity,
      avgCost,
      markPrice,
      unrealizedPnlUsdt,
      riskAtStopUsdt,
      stopDistanceUsdt: stop.stopDistanceUsdt,
    });
  }

  const equityUsdt = addDecimal(availableBalanceUsdt, inventoryMarkValue);
  const openPositionCount = positions.length;

  return {
    semanticsVersion: PORTFOLIO_RISK_SEMANTICS_VERSION_V1,
    quoteCurrency: "USDT",
    startingBalanceUsdt: input.runConfig.startingBalanceUsdt,
    availableBalanceUsdt,
    reservedMarginUsdt: "0",
    realizedPnlUsdt: walk.realizedPnl,
    markedPnlUsdt,
    feesPaidUsdt,
    equityUsdt,
    openRiskUsdt,
    openPositionCount,
    maxRiskPerTradePct: input.limits.maxRiskPerTradePct,
    maxPortfolioRiskPct: input.limits.maxPortfolioRiskPct,
    maxConcurrentPositions: input.limits.maxConcurrentPositions,
    positions,
  };
}

export type DerivePortfolioAccountStateSyncDeps = Pick<
  DerivePortfolioAccountStateInput,
  "runConfig" | "limits" | "stopDistanceProvider" | "markPrices" | "stopDistanceSignal"
>;

/** Builds empty portfolio state before any fills (run start seed). */
export function createInitialPortfolioAccountState(
  deps: DerivePortfolioAccountStateSyncDeps,
): PortfolioAccountState {
  return {
    semanticsVersion: PORTFOLIO_RISK_SEMANTICS_VERSION_V1,
    quoteCurrency: "USDT",
    startingBalanceUsdt: deps.runConfig.startingBalanceUsdt,
    availableBalanceUsdt: deps.runConfig.startingBalanceUsdt,
    reservedMarginUsdt: "0",
    realizedPnlUsdt: "0",
    markedPnlUsdt: "0",
    feesPaidUsdt: "0",
    equityUsdt: deps.runConfig.startingBalanceUsdt,
    openRiskUsdt: "0",
    openPositionCount: 0,
    maxRiskPerTradePct: deps.limits.maxRiskPerTradePct,
    maxPortfolioRiskPct: deps.limits.maxPortfolioRiskPct,
    maxConcurrentPositions: deps.limits.maxConcurrentPositions,
    positions: [],
  };
}

/** Net USDT quote exposure: buys add, sells subtract (fixed vs legacy buy-only snapshot). */
export function computeQuoteExposureUsdt(
  events: readonly {
    fill: { price: string; quantity: string };
    order: { side: "buy" | "sell"; symbol: string };
  }[],
): string {
  let exposure = "0";
  for (const { fill, order } of events) {
    if (parseQuoteCurrency(order.symbol) !== "USDT") {
      continue;
    }
    const notional = multiplyDecimal(fill.price, fill.quantity);
    exposure =
      order.side === "buy" ? addDecimal(exposure, notional) : subtractDecimal(exposure, notional);
  }
  if (compareDecimal(exposure, "0") < 0) {
    return "0";
  }
  return exposure;
}
