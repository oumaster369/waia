import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import { COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import { defaultStopDistanceProvider, type PortfolioSizingLimits } from "@/lib/trader/portfolio";
import type { PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";
import {
  HTR_DEFAULT_PORTFOLIO_RUN_CONFIG,
  HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";

/** Default HTR research portfolio — canonical 100k USDT shared spot portfolio. */
export const DEFAULT_RESEARCH_V2_STARTING_BALANCE_USDT =
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;

export type ResearchPortfolioConfig = {
  startingBalanceUsdt?: string;
  maxRiskPerTradePct?: string;
  maxPortfolioRiskPct?: string;
  maxConcurrentPositions?: number;
  maxNotional?: string;
  defaultStopDistancePct?: string;
};

export function resolveResearchPortfolioConfig(
  input?: ResearchPortfolioConfig,
): Required<
  Pick<
    ResearchPortfolioConfig,
    | "startingBalanceUsdt"
    | "maxRiskPerTradePct"
    | "maxPortfolioRiskPct"
    | "maxConcurrentPositions"
    | "maxNotional"
  >
> &
  Pick<ResearchPortfolioConfig, "defaultStopDistancePct"> {
  return {
    startingBalanceUsdt: input?.startingBalanceUsdt ?? DEFAULT_RESEARCH_V2_STARTING_BALANCE_USDT,
    maxRiskPerTradePct: input?.maxRiskPerTradePct ?? "0.10",
    maxPortfolioRiskPct: input?.maxPortfolioRiskPct ?? "0.50",
    maxConcurrentPositions: input?.maxConcurrentPositions ?? 10,
    maxNotional: input?.maxNotional ?? "100000.00",
    defaultStopDistancePct: input?.defaultStopDistancePct,
  };
}

export function buildResearchV2PortfolioContext(
  costModel: CostModelV1,
  config?: ResearchPortfolioConfig,
): PortfolioCycleContext {
  const resolved = resolveResearchPortfolioConfig(config);
  const limits: PortfolioSizingLimits = {
    ...HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS,
    maxRiskPerTradePct: resolved.maxRiskPerTradePct,
    maxPortfolioRiskPct: resolved.maxPortfolioRiskPct,
    maxConcurrentPositions: resolved.maxConcurrentPositions,
    maxNotional: resolved.maxNotional,
  };

  return {
    runConfig: {
      ...HTR_DEFAULT_PORTFOLIO_RUN_CONFIG,
      startingBalanceUsdt: resolved.startingBalanceUsdt,
      ...(resolved.defaultStopDistancePct
        ? { defaultStopDistancePct: resolved.defaultStopDistancePct }
        : {}),
    },
    limits,
    stopDistanceProvider: defaultStopDistanceProvider,
    costModel: {
      version: costModel.version ?? COST_MODEL_VERSION_V1,
      feesBps: costModel.feesBps,
      slippageBps: costModel.slippageBps,
    },
  };
}
