import type { GuardianDecision } from "@/lib/trader/guardian/guardian.types";
import type { Regime, TradingPermission } from "@/lib/trader/intelligence/types";

export const GUARDIAN_REASON_RECORD_SCHEMA_VERSION = "waia.trader.guardian-reason.v1";

export type GuardianReasonRecord = {
  schemaVersion: typeof GUARDIAN_REASON_RECORD_SCHEMA_VERSION;
  decision: GuardianDecision;
  reasonCode: string;
  ruleId: string;
  cycleId: string;
  evaluatedAt: string;
  symbol: string;
  positionLotId: string;
  tradeId: string;
  strategyId: string;
  openingStrategySignalId: string;
  regime: Regime;
  tradingPermission: TradingPermission;
  remainingQty: string;
  avgCost: string;
  markPrice: string;
  unrealizedPnlUsdt: string;
  barsHeld: number;
  slTpLevels: null;
  rMultiple: null;
  invalidation: null;
  patternRefs: readonly string[];
  signalRefs: readonly string[];
};
