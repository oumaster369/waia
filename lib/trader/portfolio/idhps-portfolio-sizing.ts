import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  applyBuyFill,
  applySellFill,
  type SymbolLedger,
} from "@/lib/trader/paper/derive-canonical-inventory";
import type { IdhpsAccountRiskMirrorV1 } from "@/lib/trader/paper/idhps-account-risk-mirror";
import { applyFillToIdhpsAvailableBalance } from "@/lib/trader/paper/idhps-account-risk-mirror";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
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
import type { StrategySignal } from "@/lib/trader/intelligence/types";

/** Portfolio sizing uses slash symbols (signal/order form). */
export function toIdhpsPortfolioSymbol(symbol: string): string {
  if (symbol.includes("/")) {
    return symbol;
  }
  if (symbol.endsWith("USDT")) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  return symbol;
}

export type IdhpsPortfolioLedgerEntry = {
  openQty: string;
  avgCost: string;
  realizedPnl: string;
};

function emptyLedger(): SymbolLedger {
  return { openQty: "0", avgCost: "0", realizedPnl: "0", sellFees: "0" };
}

function asSymbolLedger(entry: IdhpsPortfolioLedgerEntry | undefined): SymbolLedger {
  if (!entry) return emptyLedger();
  return {
    openQty: entry.openQty,
    avgCost: entry.avgCost,
    realizedPnl: entry.realizedPnl,
    sellFees: "0",
  };
}

function toEntry(ledger: SymbolLedger): IdhpsPortfolioLedgerEntry {
  return {
    openQty: ledger.openQty,
    avgCost: ledger.avgCost,
    realizedPnl: ledger.realizedPnl,
  };
}

/**
 * Apply one fill to IDHPS available-balance + fee-aware avg-cost ledgers.
 * Matches derivePortfolioAccountState / computeAvailableBalanceFromFills semantics.
 */
export function applyFillToIdhpsPortfolioSizing(
  mirror: IdhpsAccountRiskMirrorV1,
  input: {
    symbol: string;
    side: "buy" | "sell";
    price: string;
    quantity: string;
    fee: string;
    startingBalanceUsdt: string;
  },
): void {
  applyFillToIdhpsAvailableBalance(mirror, {
    side: input.side,
    price: input.price,
    quantity: input.quantity,
    fee: input.fee,
    startingBalanceUsdt: input.startingBalanceUsdt,
  });

  const portfolioSymbol = toIdhpsPortfolioSymbol(input.symbol);
  const ledgers = mirror.portfolioLedgerBySymbol;
  const ledger = asSymbolLedger(ledgers[portfolioSymbol]);
  if (input.side === "buy") {
    applyBuyFill(ledger, input.price, input.quantity, input.fee);
  } else {
    applySellFill(ledger, input.price, input.quantity, input.fee);
  }
  if (compareDecimal(ledger.openQty, "0") === 0) {
    delete ledgers[portfolioSymbol];
  } else {
    ledgers[portfolioSymbol] = toEntry(ledger);
  }

  let realized = "0";
  for (const entry of Object.values(ledgers)) {
    realized = addDecimal(realized, entry.realizedPnl);
  }
  mirror.realizedPnlUsdt = realized;
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

/** O(open positions) mark-to-market portfolio snapshot from IDHPS sizing mirrors. */
export function buildPortfolioAccountStateFromIdhps(input: {
  mirror: IdhpsAccountRiskMirrorV1;
  context: OrgContext;
  runConfig: PortfolioRunConfig;
  limits: PortfolioSizingLimits;
  stopDistanceProvider: StopDistanceProvider;
  markPrices?: PaperPnLMarkPrices;
  stopDistanceSignal?: StrategySignal;
}): PortfolioAccountState {
  const availableBalanceUsdt =
    input.mirror.availableBalanceUsdt ?? input.runConfig.startingBalanceUsdt;
  const stopSignal = input.stopDistanceSignal ?? buildStopDistanceSignal(input.context);
  const positions: PortfolioPositionSnapshot[] = [];
  let markedPnlUsdt = "0";
  let openRiskUsdt = "0";
  let inventoryMarkValue = "0";

  for (const [symbol, entry] of Object.entries(input.mirror.portfolioLedgerBySymbol)) {
    if (compareDecimal(entry.openQty, "0") <= 0) continue;
    const avgCost = entry.avgCost;
    const markPrice =
      input.markPrices?.marks[symbol] ??
      input.markPrices?.marks[symbol.replace("/", "")] ??
      (compareDecimal(avgCost, "0") > 0 ? avgCost : "0");
    const unrealizedPnlUsdt = multiplyDecimal(subtractDecimal(markPrice, avgCost), entry.openQty);
    markedPnlUsdt = addDecimal(markedPnlUsdt, unrealizedPnlUsdt);
    inventoryMarkValue = addDecimal(inventoryMarkValue, multiplyDecimal(markPrice, entry.openQty));

    const stop = input.stopDistanceProvider.resolveStopDistance({
      entryPrice: avgCost,
      symbol,
      side: "buy",
      signal: { ...stopSignal, symbol },
      runConfig: input.runConfig,
    });
    const riskAtStopUsdt = multiplyDecimal(entry.openQty, stop.stopDistanceUsdt);
    openRiskUsdt = addDecimal(openRiskUsdt, riskAtStopUsdt);
    positions.push({
      symbol,
      quantity: entry.openQty,
      avgCost,
      markPrice,
      unrealizedPnlUsdt,
      riskAtStopUsdt,
      stopDistanceUsdt: stop.stopDistanceUsdt,
    });
  }

  const equityUsdt = addDecimal(availableBalanceUsdt, inventoryMarkValue);
  return {
    semanticsVersion: PORTFOLIO_RISK_SEMANTICS_VERSION_V1,
    quoteCurrency: "USDT",
    startingBalanceUsdt: input.runConfig.startingBalanceUsdt,
    availableBalanceUsdt,
    reservedMarginUsdt: "0",
    realizedPnlUsdt: input.mirror.realizedPnlUsdt,
    markedPnlUsdt,
    feesPaidUsdt: input.mirror.feesPaidUsdt,
    equityUsdt,
    openRiskUsdt,
    openPositionCount: positions.length,
    maxRiskPerTradePct: input.limits.maxRiskPerTradePct,
    maxPortfolioRiskPct: input.limits.maxPortfolioRiskPct,
    maxConcurrentPositions: input.limits.maxConcurrentPositions,
    positions,
  };
}
