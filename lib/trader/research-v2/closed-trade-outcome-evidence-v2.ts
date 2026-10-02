import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  assertResearchDiscoveryFitnessV2,
  assertResearchV2ContentDigest,
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

function assertObservedAtOrBeforeCutoff(observedAtUtc: string, evidenceCutoffUtc: string): void {
  requireResearchV2IsoUtc(evidenceCutoffUtc, "RESEARCH_EVIDENCE_CUTOFF_INVALID");
  requireResearchV2IsoUtc(observedAtUtc, "RESEARCH_OUTCOME_TIME_INVALID");
  if (Date.parse(observedAtUtc) > Date.parse(evidenceCutoffUtc)) {
    throw new StrategyEvolutionResearchError(
      "RESEARCH_OUTCOME_AFTER_CUTOFF",
      "Outcome observation is later than the evidence cutoff",
    );
  }
}

const CLOSED_TRADE_OUTCOME_RECORD_V2_KEYS = [
  "causalContextDigestHex",
  "closedTradeRef",
  "evaluationRole",
  "netEconomicResult",
  "observedAtUtc",
  "outcomeId",
  "polarity",
] as const;

const CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_KEYS = [
  "campaignId",
  "capitalAuthority",
  "contentDigestHex",
  "evidenceCutoffUtc",
  "organizationId",
  "polaritiesPresent",
  "records",
  "schemaVersion",
  "symbol",
] as const;

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  code: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StrategyEvolutionResearchError(code);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== "string") ||
    actual.length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new StrategyEvolutionResearchError(code);
  }
}

export function assertClosedTradeOutcomeRecordV2Integrity(
  value: unknown,
  evidenceCutoffUtc: string,
  code = "RESEARCH_EVIDENCE_PACKAGE_INVALID",
): asserts value is ClosedTradeOutcomeRecordV2 {
  assertExactKeys(value, CLOSED_TRADE_OUTCOME_RECORD_V2_KEYS, code);
  if (
    typeof value.outcomeId !== "string" ||
    typeof value.closedTradeRef !== "string" ||
    typeof value.observedAtUtc !== "string" ||
    typeof value.netEconomicResult !== "string" ||
    typeof value.causalContextDigestHex !== "string" ||
    typeof value.polarity !== "string" ||
    typeof value.evaluationRole !== "string"
  ) {
    throw new StrategyEvolutionResearchError(code);
  }
  requireResearchV2NonEmpty(value.outcomeId, code);
  requireResearchV2NonEmpty(value.closedTradeRef, code);
  assertObservedAtOrBeforeCutoff(value.observedAtUtc, evidenceCutoffUtc);
  requireResearchV2DigestHex(value.causalContextDigestHex, code);

  let amount: ReturnType<typeof parseDecimal>;
  try {
    amount = parseDecimal(value.netEconomicResult);
    if (formatDecimal(amount) !== value.netEconomicResult) {
      throw new Error("noncanonical decimal");
    }
  } catch {
    throw new StrategyEvolutionResearchError(code);
  }
  if (!(CLOSED_TRADE_OUTCOME_POLARITIES_V2 as readonly string[]).includes(value.polarity)) {
    throw new StrategyEvolutionResearchError(code);
  }
  if (
    (value.polarity === "PROFIT" && compareDecimal(value.netEconomicResult, "0") <= 0) ||
    (value.polarity === "LOSS" && compareDecimal(value.netEconomicResult, "0") >= 0) ||
    (value.polarity === "FLAT" && compareDecimal(value.netEconomicResult, "0") !== 0)
  ) {
    throw new StrategyEvolutionResearchError(code);
  }
  const expectedRole = evaluationRole(value.polarity as ClosedTradeOutcomePolarityV2);
  if (value.evaluationRole !== expectedRole) {
    throw new StrategyEvolutionResearchError(code);
  }
}

/**
 * Revalidates an untrusted/deserialized package's content consistency and temporal boundary.
 * A matching digest proves byte consistency only; it does not authenticate issuance or provenance.
 */
export function assertClosedTradeOutcomeEvidencePackageV2Integrity(
  value: unknown,
): asserts value is ClosedTradeOutcomeEvidencePackageV2 {
  assertExactKeys(value, CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_KEYS, "RESEARCH_EVIDENCE_PACKAGE_INVALID");
  if (typeof value.contentDigestHex !== "string") {
    throw new StrategyEvolutionResearchError("RESEARCH_EVIDENCE_PACKAGE_INVALID");
  }
  assertResearchV2ContentDigest(
    value as Readonly<{ contentDigestHex: string }>,
    "RESEARCH_EVIDENCE_PACKAGE_INVALID",
  );
  if (
    value.schemaVersion !== CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_SCHEMA ||
    value.capitalAuthority !== "NONE" ||
    typeof value.organizationId !== "string" ||
    typeof value.campaignId !== "string" ||
    typeof value.symbol !== "string" ||
    typeof value.evidenceCutoffUtc !== "string" ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.polaritiesPresent)
  ) {
    throw new StrategyEvolutionResearchError("RESEARCH_EVIDENCE_PACKAGE_INVALID");
  }
  requireResearchV2NonEmpty(value.organizationId, "RESEARCH_EVIDENCE_PACKAGE_INVALID");
  requireResearchV2NonEmpty(value.campaignId, "RESEARCH_EVIDENCE_PACKAGE_INVALID");
  requireResearchV2NonEmpty(value.symbol, "RESEARCH_EVIDENCE_PACKAGE_INVALID");
  requireResearchV2IsoUtc(value.evidenceCutoffUtc, "RESEARCH_EVIDENCE_CUTOFF_INVALID");
  const ids = new Set<string>();
  const validRecords: ClosedTradeOutcomeRecordV2[] = [];
  const records: unknown[] = value.records;
  const polaritiesPresent: unknown[] = value.polaritiesPresent;
  let previousOutcomeId: string | undefined;
  for (const rawRecord of records) {
    const record = rawRecord;
    assertClosedTradeOutcomeRecordV2Integrity(record, value.evidenceCutoffUtc);
    if (ids.has(record.outcomeId) || (previousOutcomeId !== undefined && previousOutcomeId >= record.outcomeId)) {
      throw new StrategyEvolutionResearchError("RESEARCH_EVIDENCE_PACKAGE_INVALID");
    }
    ids.add(record.outcomeId);
    previousOutcomeId = record.outcomeId;
    validRecords.push(record);
  }
  if (validRecords.length === 0) {
    throw new StrategyEvolutionResearchError("RESEARCH_EVIDENCE_PACKAGE_INVALID");
  }
  const expectedPolarities = CLOSED_TRADE_OUTCOME_POLARITIES_V2.filter((polarity) =>
    validRecords.some((record) => record.polarity === polarity),
  );
  if (
    polaritiesPresent.length !== expectedPolarities.length ||
    polaritiesPresent.some((polarity, index) => polarity !== expectedPolarities[index])
  ) {
    throw new StrategyEvolutionResearchError("RESEARCH_EVIDENCE_PACKAGE_INVALID");
  }
}

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
    assertObservedAtOrBeforeCutoff(outcome.observedAtUtc, input.evidenceCutoffUtc);
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
