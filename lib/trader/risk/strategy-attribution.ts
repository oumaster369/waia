import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
} from "@/lib/trader/intelligence/types";
import { addDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";

export type StrategyAttributionKey = {
  organizationId: string;
  accountKey: string;
  portfolioId: string;
  runId: string;
  strategyId: string;
  strategyVersion: string;
};

export const FHV_V0_TOTAL_VIRTUAL_EQUITY_USDT = HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
export const FHV_V0_LSR_ALLOCATION_USDT = "50000";
export const FHV_V0_MR_ALLOCATION_USDT = "50000";
export const FHV_V0_TM_ALLOCATION_USDT = "0";

const TRADE_ELIGIBLE_VERSIONS: readonly StrategyAttributionKey[] = [
  {
    organizationId: "*",
    accountKey: "*",
    portfolioId: "*",
    runId: "*",
    strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
    strategyVersion: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  },
  {
    organizationId: "*",
    accountKey: "*",
    portfolioId: "*",
    runId: "*",
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: MEAN_REVERSION_V0_VERSION,
  },
];

export function computeVirtualStrategyAllocations(
  input: {
    totalVirtualEquityUsdt?: string;
  } = {},
): Readonly<Record<string, string>> {
  const total = input.totalVirtualEquityUsdt ?? FHV_V0_TOTAL_VIRTUAL_EQUITY_USDT;
  void total;
  return {
    [`${LIQUIDITY_SWEEP_REVERSAL_V0}@${LIQUIDITY_SWEEP_REVERSAL_V0_VERSION}`]:
      FHV_V0_LSR_ALLOCATION_USDT,
    [`${MEAN_REVERSION_V0}@${MEAN_REVERSION_V0_VERSION}`]: FHV_V0_MR_ALLOCATION_USDT,
    [`${TREND_MOMENTUM_V0}@${TREND_MOMENTUM_V0_VERSION}`]: FHV_V0_TM_ALLOCATION_USDT,
  };
}

export function computeStrategyEquity(input: {
  allocationUsdt: string;
  cumulativeRealizedNetPnlUsdt: string;
  pointInTimeUnrealizedNetPnlUsdt: string;
  attributableCostsUsdt: string;
}): string {
  const withRealized = addDecimal(input.allocationUsdt, input.cumulativeRealizedNetPnlUsdt);
  const withUnrealized = addDecimal(withRealized, input.pointInTimeUnrealizedNetPnlUsdt);
  return subtractDecimal(withUnrealized, input.attributableCostsUsdt);
}

export function isTradeEligibleForAllocation(strategyId: string, strategyVersion: string): boolean {
  return TRADE_ELIGIBLE_VERSIONS.some(
    (entry) => entry.strategyId === strategyId && entry.strategyVersion === strategyVersion,
  );
}

export function resolveVirtualAllocation(
  strategyId: string,
  strategyVersion: string,
  allocations: Readonly<Record<string, string>> = computeVirtualStrategyAllocations(),
): string {
  return allocations[`${strategyId}@${strategyVersion}`] ?? "0";
}
