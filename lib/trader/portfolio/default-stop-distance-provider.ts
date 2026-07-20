import { compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";

import type {
  StopDistanceProvider,
  StopDistanceProviderInput,
  StopDistanceResult,
} from "@/lib/trader/portfolio/stop-distance-provider.types";

export class InvalidStopDistancePctError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStopDistancePctError";
  }
}

/**
 * M2 provisional stop distance: `entryPrice × defaultStopDistancePct`.
 * Not a placed stop order — risk-sizing assumption until M4/M5 providers replace this.
 */
export function resolveDefaultStopDistance(input: StopDistanceProviderInput): StopDistanceResult {
  const { entryPrice, runConfig } = input;
  if (
    compareDecimal(runConfig.defaultStopDistancePct, "0") <= 0 ||
    compareDecimal(entryPrice, "0") <= 0
  ) {
    throw new InvalidStopDistancePctError(
      "[trader/portfolio] defaultStopDistancePct and entryPrice must be positive",
    );
  }

  return {
    stopDistanceUsdt: multiplyDecimal(entryPrice, runConfig.defaultStopDistancePct),
    source: "RUN_DEFAULT_PCT",
  };
}

export const defaultStopDistanceProvider: StopDistanceProvider = {
  resolveStopDistance: resolveDefaultStopDistance,
};
