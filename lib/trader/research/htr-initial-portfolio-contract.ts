import {
  createInitialPortfolioAccountState,
  defaultStopDistanceProvider,
  toAccountRiskState,
} from "@/lib/trader/portfolio";
import type {
  PortfolioAccountState,
  PortfolioSizingLimits,
} from "@/lib/trader/portfolio/portfolio-account.types";
import {
  DEFAULT_PORTFOLIO_RUN_CONFIG,
  type PortfolioRunConfig,
} from "@/lib/trader/portfolio/portfolio-run-config.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  HTR_INITIAL_PORTFOLIO_CONTRACT_V1,
  HTR_INITIAL_PORTFOLIO_SCHEMA_VERSION,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-constants";

export {
  HTR_INITIAL_PORTFOLIO_CONTRACT_V1,
  HTR_INITIAL_PORTFOLIO_SCHEMA_VERSION,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-constants";

export const HTR_DEFAULT_PORTFOLIO_RUN_CONFIG: PortfolioRunConfig = {
  ...DEFAULT_PORTFOLIO_RUN_CONFIG,
  startingBalanceUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
};

export const HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS: PortfolioSizingLimits = {
  maxRiskPerTradePct: "0.10",
  maxPortfolioRiskPct: "0.50",
  maxConcurrentPositions: 10,
  maxNotional: "100000.00",
};

export type HtrInitialPortfolioContractDeps = {
  runConfig?: PortfolioRunConfig;
  limits?: PortfolioSizingLimits;
};

function resolveContractDeps(deps?: HtrInitialPortfolioContractDeps) {
  return {
    runConfig: deps?.runConfig ?? HTR_DEFAULT_PORTFOLIO_RUN_CONFIG,
    limits: deps?.limits ?? HTR_DEFAULT_PORTFOLIO_SIZING_LIMITS,
    stopDistanceProvider: defaultStopDistanceProvider,
  };
}

/** Builds the canonical HTR initial portfolio account snapshot before any replay fills. */
export function createHtrInitialPortfolioAccountState(
  deps?: HtrInitialPortfolioContractDeps,
): PortfolioAccountState {
  return createInitialPortfolioAccountState(resolveContractDeps(deps));
}

/** Builds the canonical HTR initial account risk state for V1 research validation runs. */
export function createHtrInitialAccountRiskState(
  deps?: HtrInitialPortfolioContractDeps,
): AccountRiskState {
  return toAccountRiskState({
    portfolio: createHtrInitialPortfolioAccountState(deps),
    openOrderCount: 0,
  });
}

export function computeHtrInitialPortfolioSemanticDigest(): string {
  return computeStableJsonDigest({
    schemaVersion: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.schemaVersion,
    startingBalanceUsdt: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.startingBalanceUsdt,
    startingPositions: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.startingPositions,
    market: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.market,
    sharedPortfolio: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.sharedPortfolio,
    leverageAllowed: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.leverageAllowed,
    borrowingAllowed: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.borrowingAllowed,
    shortingAllowed: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.shortingAllowed,
    externalCashFlowsAllowed: HTR_INITIAL_PORTFOLIO_CONTRACT_V1.externalCashFlowsAllowed,
  });
}

export function assertHtrInitialPortfolioContract(state: PortfolioAccountState): void {
  if (state.startingBalanceUsdt !== HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT) {
    throw new Error(
      `[htr/initial-portfolio] startingBalanceUsdt must be ${HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT}`,
    );
  }
  if (state.availableBalanceUsdt !== HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT) {
    throw new Error(
      `[htr/initial-portfolio] availableBalanceUsdt must equal starting balance before replay`,
    );
  }
  if (state.equityUsdt !== HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT) {
    throw new Error(`[htr/initial-portfolio] equityUsdt must equal starting balance before replay`);
  }
  if (state.realizedPnlUsdt !== "0" || state.markedPnlUsdt !== "0" || state.feesPaidUsdt !== "0") {
    throw new Error(`[htr/initial-portfolio] PnL and fees must be zero before replay`);
  }
  if (state.openPositionCount !== 0 || state.positions.length !== 0) {
    throw new Error(`[htr/initial-portfolio] starting positions must be empty (BTC/ETH = 0)`);
  }
  if (state.reservedMarginUsdt !== "0") {
    throw new Error(`[htr/initial-portfolio] reserved margin must be zero (no leverage)`);
  }
}
