import type {
  MsvEnvelope,
  MvpStrategyId,
  StrategySignal,
  TradingPermission,
} from "@/lib/trader/intelligence/types";

const TRADEABLE_PERMISSIONS: readonly TradingPermission[] = ["ALLOW_TRADING", "ALLOW_REDUCED_RISK"];

export function isStrategyAllowed(msv: MsvEnvelope, strategyId: string): boolean {
  return msv.derived.allowedStrategyIds.includes(strategyId);
}

export function isPermissionTradeable(permission: TradingPermission): boolean {
  return TRADEABLE_PERMISSIONS.includes(permission);
}

export type StrategySignalBaseInput = {
  strategySignalId: string;
  strategyId: MvpStrategyId;
  strategyVersion: string;
  organizationId: string;
  symbol: StrategySignal["symbol"];
  msvId: string;
  featureSetId: string;
  evaluatedAt: string;
};

export function buildNoSignal(
  base: StrategySignalBaseInput,
  reasonCodes: readonly string[],
): StrategySignal {
  return {
    ...base,
    outcome: "NO_SIGNAL",
    reasonCodes,
  };
}
