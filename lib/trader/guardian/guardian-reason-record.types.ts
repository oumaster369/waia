import type { GuardianDecision } from "@/lib/trader/guardian/guardian.types";
import type { ExitIntelligenceContext } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { SlTpLevelsSnapshot } from "@/lib/trader/exits/exit-types";
import type { Regime, TradingPermission } from "@/lib/trader/intelligence/types";

export const GUARDIAN_REASON_RECORD_SCHEMA_VERSION = "waia.trader.guardian-reason.v2";

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
  slTpLevels: SlTpLevelsSnapshot | null;
  rMultiple: null;
  invalidation: null;
  patternRefs: readonly string[];
  signalRefs: readonly string[];
  exitIntelligenceContext: ExitIntelligenceContext | null;
};
