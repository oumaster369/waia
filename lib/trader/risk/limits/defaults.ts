import type { UpsertOrgRiskLimitsInput } from "@/lib/trader/risk/limits/types";

/** Paper/mock defaults aligned with evaluator test fixtures. */
export const DEFAULT_ORG_RISK_LIMITS: UpsertOrgRiskLimitsInput = {
  allowedSymbols: ["BTC/USDT", "ETH/USDT"],
  maxNotional: "10000.00",
  maxOrdersPerWindow: 10,
  windowMs: 60_000,
  collarBps: 500,
  maxPositionPerSymbol: "1",
  maxDailyLoss: "500",
  maxDrawdown: "1000",
  maxOpenOrders: 10,
  maxQuoteExposure: "10000",
};
