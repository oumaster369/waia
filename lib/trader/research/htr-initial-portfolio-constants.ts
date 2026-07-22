export const HTR_INITIAL_PORTFOLIO_SCHEMA_VERSION = "htr-initial-portfolio/v1" as const;

export const HTR_INITIAL_PORTFOLIO_CONTRACT_V1 = {
  schemaVersion: HTR_INITIAL_PORTFOLIO_SCHEMA_VERSION,
  startingBalanceUsdt: "100000.00",
  startingPositions: {
    BTC: "0",
    ETH: "0",
  },
  market: "SPOT" as const,
  sharedPortfolio: true,
  leverageAllowed: false,
  borrowingAllowed: false,
  shortingAllowed: false,
  externalCashFlowsAllowed: false,
} as const;

export const HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT =
  HTR_INITIAL_PORTFOLIO_CONTRACT_V1.startingBalanceUsdt;
