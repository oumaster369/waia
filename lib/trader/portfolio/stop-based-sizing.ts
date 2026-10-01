import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import { applyCostToFill } from "@/lib/trader/execution/cost-model";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import {
  isV2CapitalAuthorityPath,
  type CapitalAuthorityPath,
} from "@/lib/trader/risk/authority-chain";
import type {
  PortfolioAccountState,
  PortfolioSizingLimits,
} from "@/lib/trader/portfolio/portfolio-account.types";
import type { PortfolioRunConfig } from "@/lib/trader/portfolio/portfolio-run-config.types";
import type {
  StopDistanceProvider,
  StopDistanceSource,
  StopDistanceResult,
} from "@/lib/trader/portfolio/stop-distance-provider.types";
import { resolveDefaultStopDistance } from "@/lib/trader/portfolio/default-stop-distance-provider";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  minDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type StopBasedSizingSkipReason =
  | "PORTFOLIO_BELOW_MIN_QTY"
  | "RISK_INVALID_STOP_DISTANCE"
  | "SELL_NO_POSITION";

export type StopBasedSizingSuccess = {
  ok: true;
  quantity: string;
  stopDistanceUsdt: string;
  stopDistanceSource: StopDistanceSource;
};

export type StopBasedSizingFailure = {
  ok: false;
  reason: StopBasedSizingSkipReason;
};

export type StopBasedSizingResult = StopBasedSizingSuccess | StopBasedSizingFailure;

export type ComputeStopBasedQuantityInput = {
  side: "buy" | "sell";
  signal: StrategySignal;
  entryPrice: string;
  defaultQuantity: string;
  account: Pick<
    PortfolioAccountState,
    "equityUsdt" | "availableBalanceUsdt" | "openRiskUsdt" | "openPositionCount" | "positions"
  >;
  limits: PortfolioSizingLimits;
  stopDistanceProvider: StopDistanceProvider;
  runConfig: PortfolioRunConfig;
  costModel: CostModelV1;
  /** V2 path quarantines StrategySignal.maxRisk (§1.20). */
  capitalAuthorityPath?: CapitalAuthorityPath;
};

function resolveMinOrderQty(runConfig: PortfolioRunConfig): string {
  return runConfig.minOrderQty ?? "0.00001";
}

export function floorToMinQty(qty: string, minOrderQty: string): string {
  if (compareDecimal(qty, minOrderQty) < 0) {
    return "0";
  }
  return qty;
}

function getPositionQuantity(
  positions: readonly { symbol: string; quantity: string }[],
  symbol: string,
): string {
  let total = "0";
  for (const position of positions) {
    if (position.symbol === symbol) {
      total = addDecimal(total, position.quantity);
    }
  }
  return total;
}

/** Largest buy qty where fee-aware cost <= availableBalanceUsdt. */
export function trimQtyToAffordable(
  entryPrice: string,
  candidateQty: string,
  availableBalanceUsdt: string,
  costModel: CostModelV1,
): string {
  if (compareDecimal(candidateQty, "0") <= 0) {
    return "0";
  }
  if (compareDecimal(availableBalanceUsdt, "0") <= 0) {
    return "0";
  }

  const projected = applyCostToFill(entryPrice, candidateQty, "buy", costModel);
  const buyCost = addDecimal(multiplyDecimal(projected.adjustedPrice, candidateQty), projected.fee);
  if (compareDecimal(buyCost, availableBalanceUsdt) <= 0) {
    return candidateQty;
  }

  const ratio = divideDecimal(availableBalanceUsdt, buyCost);
  const trimmed = multiplyDecimal(candidateQty, ratio);
  if (compareDecimal(trimmed, candidateQty) >= 0) {
    return candidateQty;
  }
  return trimQtyToAffordable(entryPrice, trimmed, availableBalanceUsdt, costModel);
}

type CommonSizingInput = Omit<ComputeStopBasedQuantityInput,
  "signal" | "stopDistanceProvider" | "capitalAuthorityPath"> & { symbol: string };

/** One arithmetic implementation for legacy and research sizing. */
function computeStopBasedQuantityCore(
  input: CommonSizingInput & { legacyMaxRisk?: string; resolveStopDistance(): StopDistanceResult },
): StopBasedSizingResult {
  const minOrderQty = resolveMinOrderQty(input.runConfig);

  if (input.side === "sell") {
    const held = getPositionQuantity(input.account.positions, input.symbol);
    if (compareDecimal(held, "0") <= 0) {
      return { ok: false, reason: "SELL_NO_POSITION" };
    }
    const qty = minDecimal(held, input.defaultQuantity);
    const floored = floorToMinQty(qty, minOrderQty);
    if (compareDecimal(floored, minOrderQty) < 0) {
      return { ok: false, reason: "PORTFOLIO_BELOW_MIN_QTY" };
    }
    let stopDistanceUsdt = "0";
    let stopDistanceSource: StopDistanceSource = "RUN_DEFAULT_PCT";
    try {
      const stop = input.resolveStopDistance();
      stopDistanceUsdt = stop.stopDistanceUsdt;
      stopDistanceSource = stop.source;
    } catch {
      return { ok: false, reason: "RISK_INVALID_STOP_DISTANCE" };
    }
    return {
      ok: true,
      quantity: floored,
      stopDistanceUsdt,
      stopDistanceSource,
    };
  }

  let stopDistanceUsdt: string;
  let stopDistanceSource: StopDistanceSource;
  try {
    const stop = input.resolveStopDistance();
    stopDistanceUsdt = stop.stopDistanceUsdt;
    stopDistanceSource = stop.source;
  } catch {
    return { ok: false, reason: "RISK_INVALID_STOP_DISTANCE" };
  }

  if (compareDecimal(stopDistanceUsdt, "0") <= 0) {
    return { ok: false, reason: "RISK_INVALID_STOP_DISTANCE" };
  }

  const riskBudgetUsdt = multiplyDecimal(input.account.equityUsdt, input.limits.maxRiskPerTradePct);
  const qtyByRisk = divideDecimal(riskBudgetUsdt, stopDistanceUsdt);

  const remainingPortfolioRiskUsdt = subtractDecimal(
    multiplyDecimal(input.account.equityUsdt, input.limits.maxPortfolioRiskPct),
    input.account.openRiskUsdt,
  );
  const qtyByPortfolio =
    compareDecimal(remainingPortfolioRiskUsdt, "0") <= 0
      ? "0"
      : divideDecimal(remainingPortfolioRiskUsdt, stopDistanceUsdt);

  let qty = minDecimal(qtyByRisk, qtyByPortfolio);
  qty = minDecimal(qty, input.defaultQuantity);

  if (
    input.legacyMaxRisk &&
    compareDecimal(input.entryPrice, "0") > 0
  ) {
    qty = minDecimal(qty, divideDecimal(input.legacyMaxRisk, input.entryPrice));
  }

  if (compareDecimal(input.entryPrice, "0") > 0) {
    const qtyByNotional = divideDecimal(input.limits.maxNotional, input.entryPrice);
    qty = minDecimal(qty, qtyByNotional);
  }

  qty = trimQtyToAffordable(
    input.entryPrice,
    qty,
    input.account.availableBalanceUsdt,
    input.costModel,
  );

  const floored = floorToMinQty(qty, minOrderQty);
  if (compareDecimal(floored, minOrderQty) < 0) {
    return { ok: false, reason: "PORTFOLIO_BELOW_MIN_QTY" };
  }

  return {
    ok: true,
    quantity: floored,
    stopDistanceUsdt,
    stopDistanceSource,
  };
}

/** Existing signal/provider API, including the quarantined legacy maxRisk cap. */
export function computeStopBasedQuantity(
  input: ComputeStopBasedQuantityInput,
): StopBasedSizingResult {
  return computeStopBasedQuantityCore({ ...input, symbol: input.signal.symbol,
    legacyMaxRisk: isV2CapitalAuthorityPath(input.capitalAuthorityPath) ? undefined : input.signal.maxRisk,
    resolveStopDistance: () => input.stopDistanceProvider.resolveStopDistance({
      entryPrice: input.entryPrice, symbol: input.signal.symbol, side: input.side,
      signal: input.signal, runConfig: input.runConfig,
    }),
  });
}

/** Research arithmetic only: no fabricated StrategySignal/MVP identity, no
 * signal-owned capital limit and no injected stop policy. The current canonical
 * provisional stop-distance resolver is shared with HTR research. This neither
 * grants an order allowance nor places a protective stop. The stage owner must
 * obtain these inputs from its registered policy and actual modeled account. */
export function computeResearchStopBasedQuantity(
  input: CommonSizingInput,
): StopBasedSizingResult {
  return computeStopBasedQuantityCore({
    side: input.side, symbol: input.symbol, entryPrice: input.entryPrice,
    defaultQuantity: input.defaultQuantity, account: input.account, limits: input.limits,
    runConfig: input.runConfig, costModel: input.costModel,
    resolveStopDistance: () => resolveDefaultStopDistance({
      entryPrice: input.entryPrice, runConfig: input.runConfig,
    }),
  });
}
