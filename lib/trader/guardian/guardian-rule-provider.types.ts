import type { GuardianDecision } from "@/lib/trader/guardian/guardian.types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { Regime, TradingPermission } from "@/lib/trader/intelligence/types";

/** M4+ composition hook — M3 ships with an empty provider list. */
export type GuardianRuleInput = {
  lot: PositionLotRow;
  trade: TradeRow;
  tradingPermission: TradingPermission;
  allowedStrategyIds: readonly string[];
  regime: Regime;
  markPrice: string;
  barsHeld: number;
  cycleId: string;
  evaluatedAt: string;
};

export type GuardianRuleOutcome = {
  decision: GuardianDecision;
  reasonCode: string;
  ruleId: string;
  partialExitFraction?: string;
};

export type GuardianRuleProvider = {
  ruleId: string;
  evaluate(input: GuardianRuleInput): GuardianRuleOutcome | null;
};
