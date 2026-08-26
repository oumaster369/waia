import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import {
  CONVICTION_THRESHOLD,
  HYPOTHESIS_SET_SCHEMA_VERSION,
  type HypothesisSet,
  type HypothesisType,
  type MarketHypothesis,
  type MarketOpportunity,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { resolveEligibleStrategyFamilies } from "@/lib/trader/intelligence/hypothesis/strategy-family-mapping";
import type { HypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import {
  assertCanonicalRuntimeIntelligenceStateV1,
  type CanonicalRuntimeIntelligenceStateV1,
} from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";

export type BuildHypothesisSetInput = {
  reconstruction: ReconstructionSnapshot;
  understanding?: MarketUnderstandingSnapshot;
  evaluatedAt: string;
  sessionState: HypothesisSessionState;
  organizationId?: string;
  symbol?: string;
  canonicalRuntimeIntelligenceState?: CanonicalRuntimeIntelligenceStateV1;
};

export type BuildHypothesisSetResult = {
  hypothesisSet: HypothesisSet;
  sessionState: HypothesisSessionState;
};

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildHypothesis(
  hypothesisType: HypothesisType,
  reconstruction: ReconstructionSnapshot,
): MarketHypothesis {
  const ms = reconstruction.marketStructure;
  const ls = reconstruction.liquidityStructure;
  const ts = reconstruction.trendStructure;
  const vs = reconstruction.volatilityStructure;
  const ps = reconstruction.participationStructure;

  const supporting: string[] = [];
  const contradicting: string[] = [];
  let confidence = 0.3;
  let expectedPath = "no_clear_path";
  const invalidation: string[] = [];

  switch (hypothesisType) {
    case "trend_continuation":
      if (ts.mtfAlignment === "ALIGNED") {
        supporting.push("mtf_aligned");
        confidence += 0.25;
      }
      if (ms.structureBias === "BULLISH" || ms.structureBias === "BEARISH") {
        supporting.push(`structure_${ms.structureBias.toLowerCase()}`);
        confidence += 0.15;
      }
      expectedPath = ms.structureBias === "BEARISH" ? "continuation_lower" : "continuation_higher";
      invalidation.push("break_of_structure_against_bias");
      break;
    case "reversal":
      if (ms.changeOfCharacter) {
        supporting.push("change_of_character");
        confidence += 0.3;
      }
      if (ls.unsweptHighCount > 0 || ls.unsweptLowCount > 0) {
        supporting.push("unswept_liquidity_present");
        confidence += 0.1;
      }
      expectedPath = "reversal_toward_opposite_liquidity";
      invalidation.push("continuation_beyond_invalidation");
      break;
    case "accumulation":
      if (ts.regimeBias === "RANGE") {
        supporting.push("range_regime");
        confidence += 0.2;
      }
      if (ps.effortVsResult === "ABSORPTION") {
        supporting.push("absorption_detected");
        confidence += 0.15;
      }
      expectedPath = "range_accumulation_base";
      invalidation.push("break_below_range_low");
      break;
    case "distribution":
      if (ts.regimeBias === "RANGE" && ms.structureBias === "BEARISH") {
        supporting.push("range_with_bearish_bias");
        confidence += 0.2;
      }
      if (ps.volumeAnomaly) {
        supporting.push("volume_anomaly");
        confidence += 0.1;
      }
      expectedPath = "range_distribution_top";
      invalidation.push("reclaim_above_distribution_high");
      break;
    case "breakout":
      if (ms.breakOfStructure) {
        supporting.push("break_of_structure");
        confidence += 0.3;
      }
      if (vs.volatilityRegime === "EXPANSION") {
        supporting.push("volatility_expansion");
        confidence += 0.15;
      }
      expectedPath = "breakout_extension";
      invalidation.push("failed_breakout_reclaim");
      break;
    case "false_breakout":
      if (ms.breakOfStructure && ps.effortVsResult === "ABSORPTION") {
        supporting.push("breakout_with_absorption");
        confidence += 0.25;
      }
      if (ts.mtfAlignment === "CONFLICTING") {
        supporting.push("mtf_conflict");
        confidence += 0.1;
      }
      expectedPath = "fade_false_breakout";
      invalidation.push("sustained_breakout_follow_through");
      break;
    case "liquidity_sweep":
      if (ls.unsweptHighCount > 0 || ls.unsweptLowCount > 0) {
        supporting.push("unswept_liquidity_levels");
        confidence += 0.25;
      }
      if (ls.nearestObjectiveAbove || ls.nearestObjectiveBelow) {
        supporting.push("liquidity_objective_identified");
        confidence += 0.15;
      }
      expectedPath = "sweep_and_reclaim";
      invalidation.push("no_reclaim_after_sweep");
      break;
    case "mean_reversion":
      if (ts.regimeBias === "RANGE" || ts.regimeBias === "CHOP") {
        supporting.push("range_or_chop_regime");
        confidence += 0.2;
      }
      expectedPath = "revert_to_mean";
      invalidation.push("trend_extension_beyond_band");
      break;
  }
  if (ps.volumeAnomaly && hypothesisType !== "distribution") {
    supporting.push("participation_anomaly");
    confidence += 0.05;
  }

  return {
    hypothesisType,
    confidence: clampConfidence(confidence),
    supportingEvidence: supporting,
    contradictingEvidence: contradicting,
    expectedPath,
    invalidationConditions: invalidation,
    eligibleStrategyFamilies: resolveEligibleStrategyFamilies(hypothesisType),
    authority: "LEGACY_DIAGNOSTIC",
    rankOrdinal: null,
    canonicalHypothesisId: null,
    canonicalIntelligenceStateDigest: null,
  };
}

function buildCanonicalHypotheses(authority: CanonicalRuntimeIntelligenceStateV1): readonly MarketHypothesis[] {
  const superseded = new Set(
    authority.hypotheses
      .filter((item) => item.lifecycleState === "VALIDATED" || item.lifecycleState === "DECAYING")
      .flatMap((item) => item.supersedesHypothesisIds),
  );
  return [...authority.hypotheses]
    .filter((hypothesis) =>
      (hypothesis.lifecycleState === "VALIDATED" || hypothesis.lifecycleState === "DECAYING") &&
      !superseded.has(hypothesis.hypothesisId),
    )
    .sort((a, b) => a.rankOrdinal - b.rankOrdinal)
    .map((hypothesis) => ({
      hypothesisType: hypothesis.hypothesisType,
      // Canonical rank is ordinal, never a probability or confidence scalar.
      confidence: 0,
      supportingEvidence: hypothesis.supportingEvidence.map((item) => item.evidenceId),
      contradictingEvidence: hypothesis.contradictingEvidence.map((item) => item.evidenceId),
      expectedPath: hypothesis.expectedPath,
      invalidationConditions: hypothesis.invalidationConditions,
      eligibleStrategyFamilies: resolveEligibleStrategyFamilies(hypothesis.hypothesisType),
      authority: "CANONICAL_PIT_KNOWLEDGE" as const,
      rankOrdinal: hypothesis.rankOrdinal,
      canonicalHypothesisId: hypothesis.hypothesisId,
      canonicalIntelligenceStateDigest: authority.semanticDigest,
    }));
}

function updateSessionState(
  sessionState: HypothesisSessionState,
  hypotheses: readonly MarketHypothesis[],
): HypothesisSessionState {
  const sustainedCyclesByType: Record<string, number> = { ...sessionState.sustainedCyclesByType };
  const peakConfidenceByType: Record<string, number> = { ...sessionState.peakConfidenceByType };

  for (const hypothesis of hypotheses) {
    const type = hypothesis.hypothesisType;
    const prevPeak = peakConfidenceByType[type] ?? 0;
    peakConfidenceByType[type] = Math.max(prevPeak, hypothesis.confidence);

    if (hypothesis.confidence >= CONVICTION_THRESHOLD) {
      const prev = sustainedCyclesByType[type] ?? 0;
      const strengthening = hypothesis.confidence >= prevPeak;
      sustainedCyclesByType[type] = strengthening ? prev + 1 : prev;
    } else {
      sustainedCyclesByType[type] = 0;
    }
  }

  const ranked = [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  const active = ranked[0] ?? null;

  return {
    schemaVersion: sessionState.schemaVersion,
    sustainedCyclesByType,
    peakConfidenceByType,
    lastActiveHypothesisType: active?.hypothesisType ?? null,
  };
}

/**
 * Strategy-agnostic hypothesis engine — produces competing market hypotheses.
 * Legacy Understanding remains an input-compatible audit projection and is causally inert here;
 * DEE-626 owns future exact-evidence propagation into Hypothesis/Forecast lineage.
 */
export function buildHypothesisSet(input: BuildHypothesisSetInput): BuildHypothesisSetResult {
  const hypothesisTypes: HypothesisType[] = [
    "trend_continuation",
    "reversal",
    "accumulation",
    "distribution",
    "breakout",
    "false_breakout",
    "liquidity_sweep",
    "mean_reversion",
  ];

  const diagnosticHypotheses = hypothesisTypes.map((type) => buildHypothesis(type, input.reconstruction));

  if (!input.canonicalRuntimeIntelligenceState) {
    return {
      hypothesisSet: {
        schemaVersion: HYPOTHESIS_SET_SCHEMA_VERSION,
        evaluatedAt: input.evaluatedAt,
        hypotheses: diagnosticHypotheses,
        activeHypothesis: null,
        opportunity: null,
      },
      sessionState: input.sessionState,
    };
  }
  assertCanonicalRuntimeIntelligenceStateV1(input.canonicalRuntimeIntelligenceState);
  if (
    input.canonicalRuntimeIntelligenceState.pitAnchor !== input.evaluatedAt ||
    (input.organizationId && input.canonicalRuntimeIntelligenceState.organizationId !== input.organizationId) ||
    (input.symbol && input.canonicalRuntimeIntelligenceState.symbol !== input.symbol)
  ) {
    throw new Error("[runtime-knowledge-authority] authority scope mismatch");
  }

  const hypotheses = buildCanonicalHypotheses(input.canonicalRuntimeIntelligenceState);

  const updatedSession = updateSessionState(input.sessionState, hypotheses);
  const ranked = [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  const activeHypothesis = ranked[0] ?? null;
  // DEE-629 is epistemic authority only. Predictive Admission owns any future
  // numeric/opportunity receipt; ordinal Knowledge rank cannot authorize capital.
  const opportunity: MarketOpportunity | null = null;

  return {
    hypothesisSet: {
      schemaVersion: HYPOTHESIS_SET_SCHEMA_VERSION,
      evaluatedAt: input.evaluatedAt,
      hypotheses,
      activeHypothesis,
      opportunity,
    },
    sessionState: updatedSession,
  };
}
