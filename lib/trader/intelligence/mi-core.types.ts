import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import type {
  HypothesisSet,
  MarketHypothesis,
  MarketOpportunity,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { TradingPermission } from "@/lib/trader/intelligence/types";

/** Frozen PR-3 hand-off contract — single immutable intelligence snapshot. */
export type MarketStateSnapshot = Readonly<{
  schemaVersion: typeof MARKET_STATE_SNAPSHOT_SCHEMA_VERSION;
  evaluatedAt: string;
  instrumentId: string;
  reconstruction: ReconstructionSnapshot;
  /** Legacy audit/telemetry projection only; carries no hypothesis, permission, or capital authority. */
  understanding: MarketUnderstandingSnapshot | null;
  hypotheses: HypothesisSet;
  activeOpportunity: MarketOpportunity | null;
  tradingPermission: TradingPermission;
  terminalReasonCode: string;
  conviction: number;
  eligibleStrategyFamilies: readonly string[];
}>;

export const MARKET_STATE_SNAPSHOT_SCHEMA_VERSION = "waia.trader.market_state_snapshot.v1" as const;

/** Audit-only per-cycle observation fields for future learning (no persistence in PR-2). */
export type CycleObservationRecord = Readonly<{
  expectedPath: string;
  observedOutcome: string;
  deviation: string;
  invalidationStatus: "ACTIVE" | "TRIGGERED" | "NOT_APPLICABLE";
  terminalReasonCode: string;
}>;

export type DecisionChainStep =
  | "RECONSTRUCTION"
  | "UNDERSTANDING"
  | "HYPOTHESES"
  | "OPPORTUNITY"
  | "CDE"
  | "FINALIZATION";

export type DecisionChain = Readonly<{
  schemaVersion: typeof DECISION_CHAIN_SCHEMA_VERSION;
  evaluatedAt: string;
  steps: readonly DecisionChainStep[];
  terminalReasonCode: string;
  reasonCodes: readonly string[];
  observation: CycleObservationRecord;
  reconstructionSummary: string;
  activeHypothesisType: string | null;
  opportunityAuthorized: boolean;
  tradingPermission: TradingPermission;
}>;

export const DECISION_CHAIN_SCHEMA_VERSION = "waia.trader.decision_chain.v1" as const;

/** D-4: CDE/MSV permission is context only; LD-7 Decision is persisted separately in WP14. */
export const LD7_DECISION_CHAIN_BOUNDARY = "CDE_MSV_PERMISSION_NOT_LD7_DECISION" as const;

export type HypothesisSessionState = Readonly<{
  schemaVersion: typeof HYPOTHESIS_SESSION_STATE_SCHEMA_VERSION;
  /** Per-hypothesis-type sustained conviction cycle counts. */
  sustainedCyclesByType: Readonly<Record<string, number>>;
  /** Per-hypothesis-type peak confidence seen this session. */
  peakConfidenceByType: Readonly<Record<string, number>>;
  /** Last active hypothesis type from prior cycle. */
  lastActiveHypothesisType: string | null;
}>;

export const HYPOTHESIS_SESSION_STATE_SCHEMA_VERSION =
  "waia.trader.hypothesis_session_state.v1" as const;

export function createEmptyHypothesisSessionState(): HypothesisSessionState {
  return {
    schemaVersion: HYPOTHESIS_SESSION_STATE_SCHEMA_VERSION,
    sustainedCyclesByType: {},
    peakConfidenceByType: {},
    lastActiveHypothesisType: null,
  };
}

export const miCoreReasonCodes = {
  reconstructionInsufficientBars: "MI_REC_INSUFFICIENT_BARS",
  hypothesisNoActive: "MI_HYP_NO_ACTIVE",
  hypothesisConvictionBelowThreshold: "MI_HYP_CONVICTION_BELOW_THRESHOLD",
  opportunityAuthorized: "MI_OPP_AUTHORIZED",
  opportunityNotAuthorized: "MI_OPP_NOT_AUTHORIZED",
  cdeConvictionAllowTrading: "MI_CDE_CONVICTION_ALLOW_TRADING",
  cdeConvictionAllowReducedRisk: "MI_CDE_CONVICTION_ALLOW_REDUCED_RISK",
  cdeTruthfulHealthSufficient: "MI_CDE_TRUTHFUL_HEALTH_SUFFICIENT",
  cdeTruthfulHealthDegradedOk: "MI_CDE_TRUTHFUL_HEALTH_DEGRADED_OK",
  decisionChainComplete: "MI_CHAIN_COMPLETE",
} as const;

export type MiCoreReasonCode = (typeof miCoreReasonCodes)[keyof typeof miCoreReasonCodes];

/** Re-export for PR-3 consumers. */
export type { MarketHypothesis, MarketOpportunity, HypothesisSet };
