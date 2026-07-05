import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import { COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import {
  DEFAULT_PORTFOLIO_RUN_CONFIG,
  defaultStopDistanceProvider,
  type PortfolioSizingLimits,
} from "@/lib/trader/portfolio";
import type { PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";

/** Default M9 research portfolio — 1M USDT starting balance (Org-0 operator vault policy). */
export const DEFAULT_RESEARCH_V2_STARTING_BALANCE_USDT = "1000000.00";

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
    maxRiskPerTradePct: resolved.maxRiskPerTradePct,
    maxPortfolioRiskPct: resolved.maxPortfolioRiskPct,
    maxConcurrentPositions: resolved.maxConcurrentPositions,
    maxNotional: resolved.maxNotional,
  };

  return {
    runConfig: {
      ...DEFAULT_PORTFOLIO_RUN_CONFIG,
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
