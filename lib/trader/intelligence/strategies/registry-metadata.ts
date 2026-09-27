import {
  LIQUIDITY_SWEEP_REVERSAL_V0, LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0, MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0, TREND_MOMENTUM_V0_VERSION,
} from "@/lib/trader/intelligence/types";

/** Master Spec §9 lifecycle states (MVP registry subset). */
export const strategyLifecycleStates = [
  "DRAFT",
  "RESEARCHING",
  "PAPER",
  "LIVE",
  "RETIRED",
] as const;

export type StrategyLifecycleState = (typeof strategyLifecycleStates)[number];

export type MvpStrategyId =
  | typeof LIQUIDITY_SWEEP_REVERSAL_V0
  | typeof MEAN_REVERSION_V0
  | typeof TREND_MOMENTUM_V0;

export type StrategyRegistryEntry = {
  strategyId: MvpStrategyId;
  version: string;
  lifecycleState: StrategyLifecycleState;
  displayName: string;
};

export const MVP_STRATEGY_REGISTRY: readonly StrategyRegistryEntry[] = [
  {
    strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
    version: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
    lifecycleState: "PAPER",
    displayName: "Liquidity Sweep Reversal",
  },
  {
    strategyId: TREND_MOMENTUM_V0,
    version: TREND_MOMENTUM_V0_VERSION,
    lifecycleState: "RESEARCHING",
    displayName: "Trend Momentum",
  },
  {
    strategyId: MEAN_REVERSION_V0,
    version: MEAN_REVERSION_V0_VERSION,
    lifecycleState: "PAPER",
    displayName: "Mean Reversion",
  },
] as const;

export function listMvpStrategyRegistry(): readonly StrategyRegistryEntry[] {
  return MVP_STRATEGY_REGISTRY;
}

