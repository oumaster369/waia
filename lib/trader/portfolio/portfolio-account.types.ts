import type { PORTFOLIO_RISK_SEMANTICS_VERSION_V1 } from "@/lib/trader/portfolio/portfolio-semantics";

export type PortfolioPositionSnapshot = {
  symbol: string;
  quantity: string;
  avgCost: string;
  markPrice: string;
  unrealizedPnlUsdt: string;
  riskAtStopUsdt: string;
  stopDistanceUsdt: string;
};

/** Deposit-aware USDT spot account snapshot for M2 portfolio/risk sizing. */
export type PortfolioAccountState = {
  semanticsVersion: typeof PORTFOLIO_RISK_SEMANTICS_VERSION_V1;
  quoteCurrency: "USDT";
  startingBalanceUsdt: string;
  availableBalanceUsdt: string;
  reservedMarginUsdt: string;
  realizedPnlUsdt: string;
  markedPnlUsdt: string;
  feesPaidUsdt: string;
  equityUsdt: string;
  openRiskUsdt: string;
  openPositionCount: number;
  maxRiskPerTradePct: string;
  maxPortfolioRiskPct: string;
  maxConcurrentPositions: number;
  positions: readonly PortfolioPositionSnapshot[];
};

export type PortfolioSizingLimits = {
  maxRiskPerTradePct: string;
  maxPortfolioRiskPct: string;
  maxConcurrentPositions: number;
  maxNotional: string;
};
