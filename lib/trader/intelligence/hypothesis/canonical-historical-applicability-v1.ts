import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  HypothesisType,
  MarketHypothesis,
  MarketOpportunity,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import {
  assertCanonicalRuntimeIntelligenceStateV1,
  type CanonicalRuntimeIntelligenceStateV1,
} from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import type { ReconstructionSnapshot } from
  "@/lib/trader/intelligence/reconstruction/reconstruction.types";

export const CANONICAL_HISTORICAL_APPLICABILITY_SCHEMA_VERSION =
  "waia.trader.canonical_historical_applicability.v1" as const;
export const CANONICAL_HISTORICAL_APPLICABILITY_EVALUATOR_VERSION =
  "dee-854-canonical-pit-reconstruction-applicability/v1" as const;

export type CanonicalHistoricalApplicabilityReceiptV1 = Readonly<{
  schemaVersion: typeof CANONICAL_HISTORICAL_APPLICABILITY_SCHEMA_VERSION;
  evaluatorVersion: typeof CANONICAL_HISTORICAL_APPLICABILITY_EVALUATOR_VERSION;
  purpose: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL";
  capitalAuthority: "NONE";
  organizationId: string;
  symbol: string;
  pitAnchor: string;
  canonicalIntelligenceStateDigestHex: string;
  canonicalHypothesisId: string;
  canonicalHypothesisCausalStateDigestHex: string;
  reconstructionSemanticDigestHex: string;
  observedApplicabilityFacts: readonly string[];
  status: "APPLICABLE" | "NOT_APPLICABLE";
  reasonCodes: readonly string[];
  contentDigestHex: string;
}>;

function observeApplicability(
  hypothesisType: HypothesisType,
  reconstruction: ReconstructionSnapshot,
): Readonly<{ facts: readonly string[]; applicable: boolean }> {
  const market = reconstruction.marketStructure;
  const liquidity = reconstruction.liquidityStructure;
  const trend = reconstruction.trendStructure;
  const volatility = reconstruction.volatilityStructure;
  const participation = reconstruction.participationStructure;
  const facts: string[] = [];

  switch (hypothesisType) {
    case "trend_continuation":
      if (trend.mtfAlignment === "ALIGNED") facts.push("MTF_ALIGNED");
      if (market.structureBias === "BULLISH" || market.structureBias === "BEARISH") {
        facts.push(`DIRECTIONAL_STRUCTURE_${market.structureBias}`);
      }
      break;
    case "reversal":
      if (market.changeOfCharacter) facts.push("CHANGE_OF_CHARACTER");
      if (liquidity.unsweptHighCount > 0 || liquidity.unsweptLowCount > 0) {
        facts.push("UNSWEPT_LIQUIDITY_PRESENT");
      }
      break;
    case "accumulation":
      if (trend.regimeBias === "RANGE") facts.push("RANGE_REGIME");
      if (participation.effortVsResult === "ABSORPTION") facts.push("ABSORPTION");
      break;
    case "distribution":
      if (trend.regimeBias === "RANGE" && market.structureBias === "BEARISH") {
        facts.push("RANGE_WITH_BEARISH_STRUCTURE");
      }
      if (participation.volumeAnomaly) facts.push("VOLUME_ANOMALY");
      break;
    case "breakout":
      if (market.breakOfStructure) facts.push("BREAK_OF_STRUCTURE");
      if (volatility.volatilityRegime === "EXPANSION") facts.push("VOLATILITY_EXPANSION");
      break;
    case "false_breakout":
      if (market.breakOfStructure && participation.effortVsResult === "ABSORPTION") {
        facts.push("BREAK_OF_STRUCTURE_WITH_ABSORPTION");
      }
      if (trend.mtfAlignment === "CONFLICTING") facts.push("MTF_CONFLICTING");
      break;
    case "liquidity_sweep":
      if (liquidity.unsweptHighCount > 0 || liquidity.unsweptLowCount > 0) {
        facts.push("UNSWEPT_LIQUIDITY_PRESENT");
      }
      if (liquidity.nearestObjectiveAbove || liquidity.nearestObjectiveBelow) {
        facts.push("LIQUIDITY_OBJECTIVE_IDENTIFIED");
      }
      break;
    case "mean_reversion":
      if (trend.regimeBias === "RANGE" || trend.regimeBias === "CHOP") {
        facts.push(`NON_TREND_REGIME_${trend.regimeBias}`);
      }
      break;
  }
  const requiredFacts: Readonly<Record<HypothesisType, readonly string[]>> = {
    trend_continuation: ["MTF_ALIGNED", `DIRECTIONAL_STRUCTURE_${market.structureBias}`],
    reversal: ["CHANGE_OF_CHARACTER", "UNSWEPT_LIQUIDITY_PRESENT"],
    accumulation: ["RANGE_REGIME", "ABSORPTION"],
    distribution: ["RANGE_WITH_BEARISH_STRUCTURE", "VOLUME_ANOMALY"],
    breakout: ["BREAK_OF_STRUCTURE", "VOLATILITY_EXPANSION"],
    false_breakout: ["BREAK_OF_STRUCTURE_WITH_ABSORPTION", "MTF_CONFLICTING"],
    liquidity_sweep: ["UNSWEPT_LIQUIDITY_PRESENT", "LIQUIDITY_OBJECTIVE_IDENTIFIED"],
    mean_reversion: trend.regimeBias === "RANGE"
      ? ["NON_TREND_REGIME_RANGE"]
      : ["NON_TREND_REGIME_CHOP"],
  };
  const required = requiredFacts[hypothesisType];
  return Object.freeze({
    facts: Object.freeze(facts),
    applicable: required.every((fact) => facts.includes(fact)),
  });
}

/**
 * Produces a PIT, content-addressed, non-capital applicability receipt.
 *
 * This is deliberately an ordinal/boolean admission check. It never converts Knowledge rank,
 * evidence count, or reconstruction facts into a probability, confidence, expected edge,
 * position size, trading permission, or capital authority.
 */
export function buildCanonicalHistoricalApplicabilityReceiptV1(input: Readonly<{
  reconstruction: ReconstructionSnapshot;
  canonicalState: CanonicalRuntimeIntelligenceStateV1;
  activeHypothesis: MarketHypothesis;
}>): CanonicalHistoricalApplicabilityReceiptV1 {
  assertCanonicalRuntimeIntelligenceStateV1(input.canonicalState);
  const active = input.activeHypothesis;
  if (
    input.reconstruction.evaluatedAt !== input.canonicalState.pitAnchor ||
    active.authority !== "CANONICAL_PIT_KNOWLEDGE" ||
    !active.canonicalHypothesisId ||
    active.canonicalIntelligenceStateDigest !== input.canonicalState.semanticDigest ||
    !active.canonicalHypothesisCausalStateDigest
  ) {
    throw new Error("CANONICAL_HISTORICAL_APPLICABILITY_REFUSED:IDENTITY");
  }
  const source = input.canonicalState.hypotheses.find(
    (hypothesis) => hypothesis.hypothesisId === active.canonicalHypothesisId,
  );
  if (!source || source.hypothesisType !== active.hypothesisType || source.rankOrdinal !== 0) {
    throw new Error("CANONICAL_HISTORICAL_APPLICABILITY_REFUSED:ACTIVE_HYPOTHESIS");
  }

  const observation = observeApplicability(source.hypothesisType, input.reconstruction);
  const reasons: string[] = [];
  if (source.lifecycleState !== "VALIDATED") reasons.push("HYPOTHESIS_NOT_VALIDATED");
  if (source.ordinalJudgment !== "SUPPORTED") reasons.push("ORDINAL_JUDGMENT_NOT_SUPPORTED");
  if (source.supportingEvidence.length === 0) reasons.push("NO_CANONICAL_SUPPORTING_EVIDENCE");
  if (source.contradictingEvidence.length > 0) reasons.push("CANONICAL_CONTRADICTION_PRESENT");
  if (!source.knowledgeRefs.some((item) => item.knowledgeState === "RESOLVED_CORRECT")) {
    reasons.push("NO_RESOLVED_CORRECT_KNOWLEDGE");
  }
  if (!observation.applicable) reasons.push("CURRENT_RECONSTRUCTION_NOT_APPLICABLE");

  const body = {
    schemaVersion: CANONICAL_HISTORICAL_APPLICABILITY_SCHEMA_VERSION,
    evaluatorVersion: CANONICAL_HISTORICAL_APPLICABILITY_EVALUATOR_VERSION,
    purpose: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL" as const,
    capitalAuthority: "NONE" as const,
    organizationId: input.canonicalState.organizationId,
    symbol: input.canonicalState.symbol,
    pitAnchor: input.canonicalState.pitAnchor,
    canonicalIntelligenceStateDigestHex: input.canonicalState.semanticDigest,
    canonicalHypothesisId: source.hypothesisId,
    canonicalHypothesisCausalStateDigestHex: active.canonicalHypothesisCausalStateDigest,
    reconstructionSemanticDigestHex: computeSemanticSha256Hex(input.reconstruction),
    observedApplicabilityFacts: observation.facts,
    status: reasons.length === 0 ? "APPLICABLE" as const : "NOT_APPLICABLE" as const,
    reasonCodes: Object.freeze(reasons),
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function requireCanonicalHistoricalApplicabilityReceiptV1(
  value: CanonicalHistoricalApplicabilityReceiptV1,
): CanonicalHistoricalApplicabilityReceiptV1 {
  const { contentDigestHex, ...body } = value;
  if (
    value.schemaVersion !== CANONICAL_HISTORICAL_APPLICABILITY_SCHEMA_VERSION ||
    value.evaluatorVersion !== CANONICAL_HISTORICAL_APPLICABILITY_EVALUATOR_VERSION ||
    value.purpose !== "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL" ||
    value.capitalAuthority !== "NONE" ||
    value.status !== "APPLICABLE" ||
    !value.organizationId ||
    !value.symbol ||
    new Date(value.pitAnchor).toISOString() !== value.pitAnchor ||
    !value.canonicalHypothesisId ||
    !/^[0-9a-f]{64}$/.test(value.canonicalIntelligenceStateDigestHex) ||
    !/^[0-9a-f]{64}$/.test(value.canonicalHypothesisCausalStateDigestHex) ||
    !/^[0-9a-f]{64}$/.test(value.reconstructionSemanticDigestHex) ||
    value.observedApplicabilityFacts.length === 0 ||
    value.reasonCodes.length !== 0 ||
    computeSemanticSha256Hex(body) !== contentDigestHex
  ) {
    throw new Error("CANONICAL_HISTORICAL_APPLICABILITY_RECEIPT_INVALID");
  }
  return value;
}

export function projectCanonicalHistoricalOpportunityV1(
  activeHypothesis: MarketHypothesis,
  receipt: CanonicalHistoricalApplicabilityReceiptV1,
): MarketOpportunity | null {
  if (receipt.status !== "APPLICABLE") return null;
  if (
    receipt.capitalAuthority !== "NONE" ||
    receipt.canonicalHypothesisId !== activeHypothesis.canonicalHypothesisId ||
    receipt.canonicalHypothesisCausalStateDigestHex !==
      activeHypothesis.canonicalHypothesisCausalStateDigest
  ) {
    throw new Error("CANONICAL_HISTORICAL_APPLICABILITY_REFUSED:PROJECTION");
  }
  return Object.freeze({
    authorized: true,
    hypothesisType: activeHypothesis.hypothesisType,
    // Canonical applicability is boolean/ordinal; zero explicitly means no fabricated scalar.
    conviction: 0,
    sustainedCycles: 0,
    eligibleStrategyFamilies: activeHypothesis.eligibleStrategyFamilies,
    reasonCode: "CANONICAL_HISTORICAL_APPLICABILITY_CONFIRMED_NON_CAPITAL",
    authority: "CANONICAL_HISTORICAL_APPLICABILITY_RECEIPT_V1",
    capitalAuthority: "NONE",
    applicabilityReceiptContentDigestHex: receipt.contentDigestHex,
    applicabilityReceipt: receipt,
  });
}
