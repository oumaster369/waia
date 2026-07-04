import type { SlTpLevelsSnapshot, TrailingPhase } from "@/lib/trader/exits/exit-types";
import type { GuardianDecision } from "@/lib/trader/guardian/guardian.types";
import type { Regime, TradingPermission } from "@/lib/trader/intelligence/types";

export const EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION = "waia.trader.exit-intelligence-context.v1";

export type ExitIntelligenceRunConfig = {
  enabled: boolean;
};

export const DEFAULT_EXIT_INTELLIGENCE_RUN_CONFIG: ExitIntelligenceRunConfig = {
  enabled: false,
};

export type ExitIntelligenceScores = {
  exitPressureScore: string;
  riskAlignmentScore: string;
  conflictScore: string;
};

export type ExitIntelligenceLayerSummary = {
  structuralExitTriggered: boolean;
  m4PriceExitRuleId: string | null;
  markToStopLossDistanceUsdt: string | null;
  markToTakeProfitDistanceUsdt: string | null;
  trailingPhase: TrailingPhase | null;
};

export type ExitIntelligenceRegimeContext = {
  currentRegime: Regime;
  openingRegime: Regime | null;
  regimeChanged: boolean;
  tradingPermission: TradingPermission;
  msvReasonCodes: readonly string[];
  eventRiskScore: string;
};

export type ExitIntelligenceConflictAnalysis = {
  aligned: readonly string[];
  conflicting: readonly string[];
};

export type ExitIntelligenceContext = {
  schemaVersion: typeof EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION;
  positionId: string;
  cycleId: string;
  evaluatedAt: string;
  guardianOutcome: {
    decision: GuardianDecision;
    reasonCode: string;
    ruleId: string;
  };
  m4Levels: SlTpLevelsSnapshot | null;
  regimeContext: ExitIntelligenceRegimeContext;
  strategySignalRefs: readonly string[];
  layerSummary: ExitIntelligenceLayerSummary;
  scores: ExitIntelligenceScores;
  conflictAnalysis: ExitIntelligenceConflictAnalysis;
  explanation: string;
};
