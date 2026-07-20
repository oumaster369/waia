export { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
export type {
  BuildHypothesisSetInput,
  BuildHypothesisSetResult,
} from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
export {
  CONVICTION_SUSTAINED_CYCLES,
  CONVICTION_THRESHOLD,
  hypothesisReasonCodes,
  hypothesisTypeEnum,
  type HypothesisSet,
  type HypothesisType,
  type MarketHypothesis,
  type MarketOpportunity,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
export {
  resolveEligibleStrategyFamilies,
  STRATEGY_FAMILY_BY_HYPOTHESIS,
} from "@/lib/trader/intelligence/hypothesis/strategy-family-mapping";
export {
  HYPOTHESIS_LINK_SCHEMA_VERSION,
  deriveAuthoritativeHypothesisLinkDigest,
  deriveHypothesisRecordId,
} from "@/lib/trader/intelligence/hypothesis/hypothesis-link";
