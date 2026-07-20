import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
} from "@/lib/trader/intelligence/types";

export type PinnedStrategyVersion = {
  strategyId: string;
  strategyVersion: string;
};

export const PINNED_STRATEGY_VERSIONS: readonly PinnedStrategyVersion[] = [
  { strategyId: LIQUIDITY_SWEEP_REVERSAL_V0, strategyVersion: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION },
  { strategyId: MEAN_REVERSION_V0, strategyVersion: MEAN_REVERSION_V0_VERSION },
  { strategyId: TREND_MOMENTUM_V0, strategyVersion: TREND_MOMENTUM_V0_VERSION },
] as const;

export class StrategyVersionPinError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StrategyVersionPinError";
    this.code = code;
  }
}

export function resolvePinnedStrategyVersion(
  strategyId: string,
  strategyVersion: string,
): PinnedStrategyVersion {
  const match = PINNED_STRATEGY_VERSIONS.find(
    (entry) => entry.strategyId === strategyId && entry.strategyVersion === strategyVersion,
  );
  if (!match) {
    throw new StrategyVersionPinError(
      "STRAT_VERSION_NOT_REGISTERED",
      `[wp16] unregistered strategy version: ${strategyId}@${strategyVersion}`,
    );
  }
  return match;
}

export function assertPinnedStrategyVersion(strategyId: string, strategyVersion: string): void {
  resolvePinnedStrategyVersion(strategyId, strategyVersion);
}
