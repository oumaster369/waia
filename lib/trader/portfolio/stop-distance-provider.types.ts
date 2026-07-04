import type { StrategySignal } from "@/lib/trader/intelligence/types";

import type { PortfolioRunConfig } from "@/lib/trader/portfolio/portfolio-run-config.types";

export type StopDistanceSource =
  | "RUN_DEFAULT_PCT"
  | "GUARDIAN"
  | "ATR"
  | "STRATEGY"
  | "EXIT_INTELLIGENCE";

export type StopDistanceResult = {
  stopDistanceUsdt: string;
  source: StopDistanceSource;
};

export type StopDistanceProviderInput = {
  entryPrice: string;
  symbol: string;
  side: "buy" | "sell";
  signal: StrategySignal;
  runConfig: PortfolioRunConfig;
};

export type StopDistanceProvider = {
  resolveStopDistance(input: StopDistanceProviderInput): StopDistanceResult;
};
