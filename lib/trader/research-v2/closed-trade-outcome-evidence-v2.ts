import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  assertResearchDiscoveryFitnessV2,
  requireResearchV2DigestHex,
  requireResearchV2IsoUtc,
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";

export const CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_SCHEMA =
  "waia.trader.closed_trade_outcome_evidence_package.v2" as const;

export const CLOSED_TRADE_OUTCOME_POLARITIES_V2 = [
  "PROFIT",
  "LOSS",
  "FLAT",
  "INCONCLUSIVE",
  "INVALIDATED",
] as const;

export type ClosedTradeOutcomePolarityV2 = (typeof CLOSED_TRADE_OUTCOME_POLARITIES_V2)[number];

export const CLOSED_TRADE_OUTCOME_STATUSES_V2 = [
  "OBSERVED",
  "INCONCLUSIVE",
  "INVALIDATED",
] as const;

export type ClosedTradeOutcomeStatusV2 = (typeof CLOSED_TRADE_OUTCOME_STATUSES_V2)[number];

export type ClosedTradeOutcomeInputV2 = Readonly<{
  outcomeId: string;
  closedTradeRef: string;
  observedAtUtc: string;
  netEconomicResult: string;
  causalContextDigestHex: string;
  status?: ClosedTradeOutcomeStatusV2;
}>;

export type ClosedTradeOutcomeRecordV2 = Readonly<{
  outcomeId: string;
  closedTradeRef: string;
  observedAtUtc: string;
  netEconomicResult: string;
  causalContextDigestHex: string;
  polarity: ClosedTradeOutcomePolarityV2;
  evaluationRole: "SUPPORTING" | "CONTRADICTING" | "NEUTRAL";
}>;

export type ClosedTradeOutcomeEvidencePackageV2 = Readonly<{
  schemaVersion: typeof CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_SCHEMA;
  capitalAuthority: "NONE";
  organizationId: string;
  campaignId: string;
  symbol: string;
  evidenceCutoffUtc: string;
  records: readonly ClosedTradeOutcomeRecordV2[];
  polaritiesPresent: readonly ClosedTradeOutcomePolarityV2[];
  contentDigestHex: string;
}>;

export type BuildClosedTradeOutcomeEvidencePackageV2Input = Readonly<{
  organizationId: string;
  campaignId: string;
  symbol: string;
  evidenceCutoffUtc: string;
  outcomes: readonly ClosedTradeOutcomeInputV2[];
  omitPolarities?: readonly ClosedTradeOutcomePolarityV2[];
}>;

function classifyPolarity(input: ClosedTradeOutcomeInputV2): ClosedTradeOutcomePolarityV2 {
  if (input.status === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (input.status === "INVALIDATED") return "INVALIDATED";
  const compared = compareDecimal(input.netEconomicResult, "0");
  if (compared > 0) return "PROFIT";
  if (compared < 0) return "LOSS";
  return "FLAT";
}

function evaluationRole(
  polarity: ClosedTradeOutcomePolarityV2,
): ClosedTradeOutcomeRecordV2["evaluationRole"] {
  if (polarity === "PROFIT") return "SUPPORTING";
  if (polarity === "LOSS" || polarity === "INVALIDATED") return "CONTRADICTING";
  return "NEUTRAL";
}

export function discardLosingOutcomesFromEvidencePackageV2(
  packageToProtect: ClosedTradeOutcomeEvidencePackageV2,
): never {
  void packageToProtect;
  throw new StrategyEvolutionResearchError(
    "SURVIVORSHIP_DISCARD_FORBIDDEN",
    "Losing outcomes cannot be filtered out of the evidence package",
  );
}

export function buildClosedTradeOutcomeEvidencePackageV2(
  input: BuildClosedTradeOutcomeEvidencePackageV2Input,
): ClosedTradeOutcomeEvidencePackageV2 {
  assertResearchDiscoveryFitnessV2(input.outcomes, "closed-trade outcome evidence");
  if (input.omitPolarities && input.omitPolarities.length > 0) {
    throw new StrategyEvolutionResearchError(
      "SURVIVORSHIP_DISCARD_FORBIDDEN",
      "Evidence package construction cannot omit polarities",
    );
  }
  requireResearchV2NonEmpty(input.organizationId, "RESEARCH_SCOPE_INCOMPLETE");
  requireResearchV2NonEmpty(input.campaignId, "RESEARCH_SCOPE_INCOMPLETE");
  requireResearchV2NonEmpty(input.symbol, "RESEARCH_SCOPE_INCOMPLETE");
  requireResearchV2IsoUtc(input.evidenceCutoffUtc, "RESEARCH_EVIDENCE_CUTOFF_INVALID");
  if (input.outcomes.length === 0) {
    throw new StrategyEvolutionResearchError("RESEARCH_OUTCOMES_REQUIRED");
  }

  const records = input.outcomes.map((outcome) => {
    requireResearchV2NonEmpty(outcome.outcomeId, "RESEARCH_OUTCOME_IDENTITY_INVALID");
    requireResearchV2NonEmpty(outcome.closedTradeRef, "RESEARCH_OUTCOME_IDENTITY_INVALID");
    requireResearchV2IsoUtc(outcome.observedAtUtc, "RESEARCH_OUTCOME_TIME_INVALID");
    requireResearchV2DigestHex(
      outcome.causalContextDigestHex,
      "RESEARCH_OUTCOME_CAUSAL_CONTEXT_INVALID",
    );
    try {
      parseDecimal(outcome.netEconomicResult);
    } catch {
      throw new StrategyEvolutionResearchError("RESEARCH_OUTCOME_AMOUNT_INVALID");
    }
    const polarity = classifyPolarity(outcome);
    return Object.freeze({
      outcomeId: outcome.outcomeId,
      closedTradeRef: outcome.closedTradeRef,
      observedAtUtc: outcome.observedAtUtc,
      netEconomicResult: formatDecimal(parseDecimal(outcome.netEconomicResult)),
      causalContextDigestHex: outcome.causalContextDigestHex,
      polarity,
      evaluationRole: evaluationRole(polarity),
    });
  });

  const ids = records.map((record) => record.outcomeId);
  if (new Set(ids).size !== ids.length) {
    throw new StrategyEvolutionResearchError("RESEARCH_OUTCOME_DUPLICATE");
  }

  records.sort((left, right) => (left.outcomeId < right.outcomeId ? -1 : 1));
  const polaritiesPresent = Object.freeze(
    CLOSED_TRADE_OUTCOME_POLARITIES_V2.filter((polarity) =>
      records.some((record) => record.polarity === polarity),
    ),
  );

  const body = {
    schemaVersion: CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    symbol: input.symbol,
    evidenceCutoffUtc: input.evidenceCutoffUtc,
    records: Object.freeze(records),
    polaritiesPresent,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
