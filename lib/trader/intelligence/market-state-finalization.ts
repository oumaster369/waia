import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { HypothesisSet } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import {
  MARKET_STATE_SNAPSHOT_SCHEMA_VERSION,
  miCoreReasonCodes,
  type MarketStateSnapshot,
} from "@/lib/trader/intelligence/mi-core.types";
import type { TradingPermission } from "@/lib/trader/intelligence/types";

export type FinalizeMarketStateInput = {
  reconstruction: ReconstructionSnapshot;
  understanding?: MarketUnderstandingSnapshot;
  hypothesisSet: HypothesisSet;
  tradingPermission: TradingPermission;
  terminalReasonCode: string;
};

function deepFreeze<T extends object>(obj: T): T {
  if (process.env.NODE_ENV === "production") {
    return obj;
  }
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj;
}

export function finalizeMarketStateSnapshot(input: FinalizeMarketStateInput): MarketStateSnapshot {
  const opportunity = input.hypothesisSet.opportunity;
  const active = input.hypothesisSet.activeHypothesis;
  const conviction = opportunity?.conviction ?? active?.confidence ?? 0;
  const eligibleStrategyFamilies =
    opportunity?.eligibleStrategyFamilies ?? active?.eligibleStrategyFamilies ?? [];

  const snapshot: MarketStateSnapshot = {
    schemaVersion: MARKET_STATE_SNAPSHOT_SCHEMA_VERSION,
    evaluatedAt: input.reconstruction.evaluatedAt,
    instrumentId: input.reconstruction.instrumentId,
    reconstruction: input.reconstruction,
    understanding: input.understanding ?? null,
    hypotheses: input.hypothesisSet,
    activeOpportunity: opportunity,
    tradingPermission: input.tradingPermission,
    terminalReasonCode: input.terminalReasonCode,
    conviction,
    eligibleStrategyFamilies,
  };

  return deepFreeze(snapshot);
}

export function resolveTerminalReasonCode(input: {
  opportunityAuthorized: boolean;
  tradingPermission: TradingPermission;
  conviction: number;
}): string {
  if (input.opportunityAuthorized && input.tradingPermission === "ALLOW_TRADING") {
    return miCoreReasonCodes.cdeConvictionAllowTrading;
  }
  if (input.opportunityAuthorized && input.tradingPermission === "ALLOW_REDUCED_RISK") {
    return miCoreReasonCodes.cdeConvictionAllowReducedRisk;
  }
  if (!input.opportunityAuthorized) {
    return miCoreReasonCodes.opportunityNotAuthorized;
  }
  return miCoreReasonCodes.hypothesisConvictionBelowThreshold;
}
