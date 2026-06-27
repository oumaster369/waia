import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

import type { RiskDecision } from "@/lib/trader/risk/types";

export type TradeAbuseLimitsConfig = {
  allowedSymbols: readonly string[];
  maxNotional: string;
  maxOrdersPerWindow: number;
  windowMs: number;
  collarBps: number;
};

export type TradeAbuseEvaluationInput = {
  order: PlaceOrderInput;
  referencePrice: string;
  accountKey: string;
};

export type TradeAbuseEvaluatorDeps = {
  nowMs: () => number;
  rateStore: OrderRateStore;
};

export type OrderRateStore = {
  recordAndCount(key: string, nowMs: number, windowMs: number): number;
};

export type TradeAbuseEvaluationResult = RiskDecision;
