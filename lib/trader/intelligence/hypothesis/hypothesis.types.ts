export const hypothesisTypeEnum = [
  "trend_continuation",
  "reversal",
  "accumulation",
  "distribution",
  "breakout",
  "false_breakout",
  "liquidity_sweep",
  "mean_reversion",
] as const;

export type HypothesisType = (typeof hypothesisTypeEnum)[number];

export type MarketHypothesis = Readonly<{
  hypothesisType: HypothesisType;
  confidence: number;
  supportingEvidence: readonly string[];
  contradictingEvidence: readonly string[];
  expectedPath: string;
  invalidationConditions: readonly string[];
  eligibleStrategyFamilies: readonly string[];
  authority?: "LEGACY_DIAGNOSTIC" | "CANONICAL_PIT_KNOWLEDGE";
  rankOrdinal?: number | null;
  canonicalHypothesisId?: string | null;
  canonicalIntelligenceStateDigest?: string | null;
  canonicalHypothesisCausalStateDigest?: string | null;
  canonicalCausalLineageJson?: string | null;
  canonicalCausalLineageDigest?: string | null;
}>;

export type MarketOpportunity = Readonly<{
  authorized: boolean;
  hypothesisType: HypothesisType;
  conviction: number;
  sustainedCycles: number;
  eligibleStrategyFamilies: readonly string[];
  reasonCode: string;
  /** Present only for the explicit historical, pre-holdout, non-capital canonical path. */
  authority?: "LEGACY_CONVICTION" | "CANONICAL_HISTORICAL_APPLICABILITY_RECEIPT_V1";
  capitalAuthority?: "NONE";
  applicabilityReceiptContentDigestHex?: string;
  applicabilityReceipt?: CanonicalHistoricalApplicabilityReceiptV1;
}>;

export type HypothesisSet = Readonly<{
  schemaVersion: typeof HYPOTHESIS_SET_SCHEMA_VERSION;
  evaluatedAt: string;
  hypotheses: readonly MarketHypothesis[];
  activeHypothesis: MarketHypothesis | null;
  opportunity: MarketOpportunity | null;
}>;

export const HYPOTHESIS_SET_SCHEMA_VERSION = "waia.trader.hypothesis_set.v1" as const;

export const CONVICTION_THRESHOLD = 0.65;
export const CONVICTION_SUSTAINED_CYCLES = 3;

export const hypothesisReasonCodes = {
  trendContinuation: "HYP_TREND_CONTINUATION",
  reversal: "HYP_REVERSAL",
  accumulation: "HYP_ACCUMULATION",
  distribution: "HYP_DISTRIBUTION",
  breakout: "HYP_BREAKOUT",
  falseBreakout: "HYP_FALSE_BREAKOUT",
  liquiditySweep: "HYP_LIQUIDITY_SWEEP",
  meanReversion: "HYP_MEAN_REVERSION",
  convictionSustained: "HYP_CONVICTION_SUSTAINED",
  convictionInsufficient: "HYP_CONVICTION_INSUFFICIENT",
} as const;
import type { CanonicalHistoricalApplicabilityReceiptV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-historical-applicability-v1";
