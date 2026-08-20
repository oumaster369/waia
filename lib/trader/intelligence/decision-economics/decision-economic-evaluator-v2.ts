import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { distributionSemanticDigestHex } from "@/lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1";
import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { computeForecastContentDigest } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";

import {
  assertLegacyStrategyFieldsNonAuthoritative,
  type DecisionEvRange,
} from "./decision-economics-v2";
import {
  DEE649_DECISION_ECONOMICS_CONTRACT_VERSION,
  DEE649_EV_AGGREGATION_POLICY,
  DEE649_INTERIM_POSITION_POLICY_ID,
  computeDee649InstrumentIdentityDigestV1,
  type Dee649AuthorityBindingV1,
  type Dee649ExecutablePolicyInstanceV1,
  type Dee649ReasonCode,
  type EconomicAdmissibleSizeSetV1,
  type ExecOpp13dForecastIdentityV1,
  type ForecastAnchorPriceAuthorityV1,
  resolveDecisionEvaluationContractV1,
  validateDee649ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
  validateForecastAnchorPriceAuthorityV1,
} from "./dee649-contract-v1";
import {
  executionPayoffFunctionalV2,
  EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
  type ExecutionPayoffScenarioV2,
} from "./execution-payoff-functional-v2";

export const WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION = "why-not-cash-receipt/v2" as const;
export const DEE649_AUTHORITY_VERIFICATION_SCHEMA_VERSION =
  "dee649-authority-verification/v1" as const;

export type ForecastEconomicAuthorityV1 = Dee649AuthorityBindingV1 & {
  forecastId: string;
  identity: ExecOpp13dForecastIdentityV1;
  forecastAnchorClosedBarEpochMs: number;
  anchorAuthorityContentDigestHex: string;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  forecastGenerationIdentityDigestHex: string;
  forecastContentDigestHex: string;
  normalizationVersionDigestHex: string;
  k: number;
  m: number;
  distributionSemanticDigestHex: string;
  forecastAuthorityReceiptDigestHex: string;
  economicAuthorityContentDigestHex: string;
  replicaSamples: readonly (readonly (readonly number[])[])[];
};

export type CashEconomicAuthorityV1 = Dee649AuthorityBindingV1 & {
  availableCashUsdt: string;
  authorityReceiptDigestHex: string;
  contentDigestHex: string;
};

export type VerifiedDecisionEconomicAuthorityV1 = {
  schemaVersion: typeof DEE649_AUTHORITY_VERIFICATION_SCHEMA_VERSION;
  verified: boolean;
  purpose:
    | "FORECAST_ISSUANCE"
    | "ANCHOR_QUALIFICATION"
    | "EXECUTABLE_POLICY_PREREGISTRATION"
    | "ECONOMIC_SIZE_AUTHORIZATION"
    | "CASH_SNAPSHOT_AUTHORIZATION";
  organizationId: string;
  accountId: string;
  instrumentIdentityDigestHex: string;
  subjectContentDigestHex: string;
  verificationReceiptDigestHex: string;
};

export type DecisionEconomicAuthorityVerificationV1 = {
  forecast: VerifiedDecisionEconomicAuthorityV1;
  anchor: VerifiedDecisionEconomicAuthorityV1;
  executablePolicy: VerifiedDecisionEconomicAuthorityV1;
  economicSize: VerifiedDecisionEconomicAuthorityV1;
  cash: VerifiedDecisionEconomicAuthorityV1;
};

export type ScientificAdmissionVerificationV1 = {
  schemaVersion: typeof SCIENTIFIC_ADMISSION_RECEIPT_VERSION;
  verified: boolean;
  organizationId: string;
  selectedPackageGenerationIdentityDigestHex: string;
  selectedPackageContentDigestHex: string;
  selectedKConfigDec: number;
  selectedMConfigDec: number;
  evidenceSemanticDigestHex: string;
  receiptContentDigestHex: string;
};

export type WhyNotCashReceiptV2 = {
  schemaVersion: typeof WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION;
  decisionEconomicsContractVersion: typeof DEE649_DECISION_ECONOMICS_CONTRACT_VERSION;
  organizationId: string;
  accountId: string;
  forecastId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  instrumentIdentityDigestHex: string;
  forecastIdentity: ExecOpp13dForecastIdentityV1;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  forecastGenerationIdentityDigestHex: string;
  forecastContentDigestHex: string;
  distributionSemanticDigestHex: string;
  normalizationVersionDigestHex: string;
  k: number;
  m: number;
  forecastAnchorClosedBarEpochMs: number;
  forecastAuthorityReceiptDigestHex: string;
  forecastEconomicAuthorityContentDigestHex: string;
  decisionEvaluationContractId: string | null;
  executionPayoffFunctionalVersion: typeof EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION;
  forecastComponentUse: {
    executableEntryReturnIndices: readonly number[];
    structuralHorizonTriggerReturnIndex: 3;
    executableExitReturnIndices: readonly number[];
    executableEntryVolumeIndices: readonly number[];
    executableExitVolumeIndices: readonly number[];
    unusedByPolicyIndices: readonly number[];
    horizonTriggerIsExecutableFillPrice: false;
  };
  payoffPolicyInstanceId: string;
  payoffPolicyDigestHex: string;
  anchorAuthorityDigestHex: string;
  preregistrationReceiptDigestHex: string;
  costAuthorityReceiptDigestHex: string;
  liquidityCapacityAuthorityReceiptDigestHex: string;
  quantityRulesAuthorityReceiptDigestHex: string;
  inputEconomicSizeSetId: string;
  inputEconomicSizeSetDigestHex: string;
  evaluatedExactQuantity: string | null;
  availableCashUsdt: string;
  cashAuthorityReceiptDigestHex: string;
  cashBaselineUsdt: "0";
  evAggregationPolicy: typeof DEE649_EV_AGGREGATION_POLICY;
  muBaseReplicasScale8: readonly string[];
  muLowerReplicasScale8: readonly string[];
  muBaseReplicasExactScaledRational: readonly ExactScaledRationalReceiptV1[];
  muLowerReplicasExactScaledRational: readonly ExactScaledRationalReceiptV1[];
  evLowerScale8: string | null;
  evBaseScale8: string | null;
  evUpperScale8: string | null;
  evLowerExactScaledRational: ExactScaledRationalReceiptV1 | null;
  evBaseExactScaledRational: ExactScaledRationalReceiptV1 | null;
  evUpperExactScaledRational: ExactScaledRationalReceiptV1 | null;
  scenarioContentDigests: readonly (readonly string[])[];
  scenarioResidualInventoryCount: number;
  scientificAdmission: ScientificAdmissionVerificationV1;
  authorityVerification: DecisionEconomicAuthorityVerificationV1;
  actionCandidate: "ENTER_LONG";
  verdict: "DECISION_ACTIONABLE" | "DECISION_NON_ACTIONABLE";
  economicallyAdmissibleExactQuantities: readonly string[];
  reasonCodes: readonly Dee649ReasonCode[];
  contentDigestHex: string;
};

export type ExactScaledRationalReceiptV1 = {
  numeratorScale8: string;
  denominator: string;
};

export type DecisionEconomicEvaluationInputV2 = {
  forecast: ForecastEconomicAuthorityV1;
  anchorAuthority: ForecastAnchorPriceAuthorityV1;
  policy: Dee649ExecutablePolicyInstanceV1;
  economicSizeSet: EconomicAdmissibleSizeSetV1;
  cashAuthority: CashEconomicAuthorityV1;
  authorityVerification: DecisionEconomicAuthorityVerificationV1;
  scientificAdmission: ScientificAdmissionVerificationV1;
  legacyStrategyDiagnostics?: {
    legacyDiagnosticConfidence?: number;
    legacyDiagnosticExpectedEdge?: number;
    legacyDiagnosticMaxRisk?: number;
  };
};

export type DecisionEconomicEvaluationResultV2 = {
  decisionActionable: boolean;
  action: "ENTER_LONG" | "CASH";
  economicAdmissibleSizeSet: EconomicAdmissibleSizeSetV1 | null;
  evRange: DecisionEvRange | null;
  scenarioResults: readonly (readonly ExecutionPayoffScenarioV2[])[];
  receipt: WhyNotCashReceiptV2;
};

function isDigestHex(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function computeCashEconomicAuthorityContentDigestV1(
  input: Omit<CashEconomicAuthorityV1, "contentDigestHex">,
): string {
  return computeStableJsonDigest({ schemaVersion: "dee649-cash-economic-authority/v1", ...input });
}

export function computeForecastEconomicAuthorityContentDigestV1(
  input: Omit<ForecastEconomicAuthorityV1, "economicAuthorityContentDigestHex" | "replicaSamples">,
): string {
  return computeStableJsonDigest({
    schemaVersion: "dee649-forecast-economic-authority/v1",
    ...input,
  });
}

function uniqueReasons(reasons: readonly Dee649ReasonCode[]): Dee649ReasonCode[] {
  return [...new Set(reasons)];
}

function sameAuthorityBinding(
  expected: Dee649AuthorityBindingV1,
  actual: Dee649AuthorityBindingV1,
): boolean {
  return (
    expected.organizationId === actual.organizationId &&
    expected.accountId === actual.accountId &&
    expected.venue === actual.venue &&
    expected.market === actual.market &&
    expected.symbol === actual.symbol &&
    expected.baseAsset === actual.baseAsset &&
    expected.quoteAsset === actual.quoteAsset &&
    expected.instrumentIdentityDigestHex === actual.instrumentIdentityDigestHex
  );
}

function verifiedAuthorityMatches(input: {
  verification: VerifiedDecisionEconomicAuthorityV1;
  purpose: VerifiedDecisionEconomicAuthorityV1["purpose"];
  subjectContentDigestHex: string;
  authority: Dee649AuthorityBindingV1;
}): boolean {
  const verification = input.verification;
  return (
    verification.schemaVersion === DEE649_AUTHORITY_VERIFICATION_SCHEMA_VERSION &&
    verification.verified &&
    verification.purpose === input.purpose &&
    verification.organizationId === input.authority.organizationId &&
    verification.accountId === input.authority.accountId &&
    verification.instrumentIdentityDigestHex === input.authority.instrumentIdentityDigestHex &&
    verification.subjectContentDigestHex === input.subjectContentDigestHex &&
    isDigestHex(verification.subjectContentDigestHex) &&
    isDigestHex(verification.verificationReceiptDigestHex)
  );
}

function canonicalForecastSamples(
  forecast: ForecastEconomicAuthorityV1,
): readonly (readonly (readonly number[])[])[] | null {
  if (
    !Number.isSafeInteger(forecast.k) ||
    forecast.k <= 0 ||
    !Number.isSafeInteger(forecast.m) ||
    forecast.m <= 0 ||
    !Array.isArray(forecast.replicaSamples) ||
    forecast.replicaSamples.length !== forecast.k
  ) {
    return null;
  }
  const canonical: number[][][] = [];
  for (const replica of forecast.replicaSamples) {
    if (!Array.isArray(replica) || replica.length !== forecast.m) return null;
    const canonicalReplica: number[][] = [];
    for (const sample of replica) {
      if (!Array.isArray(sample) || sample.length !== 13) return null;
      const canonicalSample: number[] = [];
      for (const component of sample) {
        if (!Number.isFinite(component)) return null;
        canonicalSample.push(Number(quantizeScale8HalfUp(component)));
      }
      canonicalReplica.push(canonicalSample);
    }
    canonical.push(canonicalReplica);
  }
  return canonical;
}

function forecastComponentUse(
  policy: Dee649ExecutablePolicyInstanceV1,
): WhyNotCashReceiptV2["forecastComponentUse"] {
  const entryReturns = policy.entrySliceOffsets.map((offset) => offset - 1);
  const exitReturns = policy.exitSliceOffsetsAfterHorizon.map((offset) => 3 + offset);
  const entryVolumes = policy.entrySliceOffsets.map((offset) => 6 + offset);
  const exitVolumes = policy.exitSliceOffsetsAfterHorizon.map((offset) => 9 + offset);
  const used = new Set([3, ...entryReturns, ...exitReturns, ...entryVolumes, ...exitVolumes]);
  return {
    executableEntryReturnIndices: entryReturns,
    structuralHorizonTriggerReturnIndex: 3,
    executableExitReturnIndices: exitReturns,
    executableEntryVolumeIndices: entryVolumes,
    executableExitVolumeIndices: exitVolumes,
    unusedByPolicyIndices: Array.from({ length: 13 }, (_, index) => index).filter(
      (index) => !used.has(index),
    ),
    horizonTriggerIsExecutableFillPrice: false,
  };
}

function receiptWithDigest(
  input: Omit<WhyNotCashReceiptV2, "contentDigestHex">,
): WhyNotCashReceiptV2 {
  return { ...input, contentDigestHex: computeStableJsonDigest(input) };
}

function omitReceiptDigest(
  input: WhyNotCashReceiptV2,
): Omit<WhyNotCashReceiptV2, "contentDigestHex"> {
  const { contentDigestHex, ...payload } = input;
  void contentDigestHex;
  return payload;
}

function fixedScale8(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100_000_000n;
  const fraction = (absolute % 100_000_000n).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

type ExactScaledRational = { numerator: bigint; denominator: bigint };

function rationalReceipt(value: ExactScaledRational): ExactScaledRationalReceiptV1 {
  return {
    numeratorScale8: value.numerator.toString(),
    denominator: value.denominator.toString(),
  };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function rational(numerator: bigint, denominator: bigint): ExactScaledRational {
  if (denominator <= 0n) throw new Error("EV_RANGE_INVALID");
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function compareRational(left: ExactScaledRational, right: ExactScaledRational): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function receiptScale8Truncate(value: ExactScaledRational): string {
  return fixedScale8(value.numerator / value.denominator);
}

function exactReplicaMeanScale8(payoffs: readonly string[]): ExactScaledRational {
  if (payoffs.length === 0) throw new Error("FORECAST_SAMPLE_INVALID");
  return rational(
    payoffs.reduce((sum, payoff) => sum + parseDecimal(payoff), 0n),
    BigInt(payoffs.length),
  );
}

function exactType7Scale8(
  values: readonly ExactScaledRational[],
  probabilityNumerator: bigint,
  probabilityDenominator: bigint,
): ExactScaledRational {
  if (values.length === 0) throw new Error("EV_RANGE_INVALID");
  const sorted = [...values].sort(compareRational);
  if (sorted.length === 1) return sorted[0]!;
  const positionNumerator = BigInt(sorted.length - 1) * probabilityNumerator;
  const lowerIndex = positionNumerator / probabilityDenominator;
  const remainder = positionNumerator % probabilityDenominator;
  const lower = sorted[Number(lowerIndex)]!;
  const upper = sorted[Math.min(sorted.length - 1, Number(lowerIndex) + 1)]!;
  return rational(
    lower.numerator * (probabilityDenominator - remainder) * upper.denominator +
      upper.numerator * remainder * lower.denominator,
    lower.denominator * upper.denominator * probabilityDenominator,
  );
}

function exactDecisionEvRange(input: {
  muBaseScale8: readonly ExactScaledRational[];
  muLowerScale8: readonly ExactScaledRational[];
  scientificAdmissionVerified: boolean;
}): {
  evRange: DecisionEvRange;
  exact: {
    evLower: ExactScaledRational;
    evBase: ExactScaledRational;
    evUpper: ExactScaledRational;
  };
} {
  const evLowerScaled = exactType7Scale8(input.muLowerScale8, 1n, 10n);
  const evBaseScaled = exactType7Scale8(input.muBaseScale8, 1n, 2n);
  const evUpperScaled = exactType7Scale8(input.muBaseScale8, 9n, 10n);
  const reasons: string[] = [];
  if (
    compareRational(evLowerScaled, evBaseScaled) > 0 ||
    compareRational(evBaseScaled, evUpperScaled) > 0
  ) {
    reasons.push("EV_RANGE_INVALID");
  }
  if (!input.scientificAdmissionVerified) {
    reasons.push("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");
  }
  if (evLowerScaled.numerator <= 0n) reasons.push("EV_LOWER_NON_POSITIVE");
  const decisionActionable = evLowerScaled.numerator > 0n && reasons.length === 0;
  if (!decisionActionable) reasons.push("DECISION_NON_ACTIONABLE");
  return {
    evRange: {
      evLower: Number(receiptScale8Truncate(evLowerScaled)),
      evBase: Number(receiptScale8Truncate(evBaseScaled)),
      evUpper: Number(receiptScale8Truncate(evUpperScaled)),
      evLowerScale8: receiptScale8Truncate(evLowerScaled),
      evBaseScale8: receiptScale8Truncate(evBaseScaled),
      evUpperScale8: receiptScale8Truncate(evUpperScaled),
      decisionActionable,
      reasonCodes: reasons,
    },
    exact: { evLower: evLowerScaled, evBase: evBaseScaled, evUpper: evUpperScaled },
  };
}

function computeExactDecisionEvRangeFromPayoffsV1(input: {
  baseReplicaPayoffsScale8: readonly (readonly string[])[];
  lowerReplicaPayoffsScale8: readonly (readonly string[])[];
  scientificAdmissionVerified: boolean;
}): {
  muBaseReplicasScale8: readonly string[];
  muLowerReplicasScale8: readonly string[];
  muBaseReplicasExactScaledRational: readonly ExactScaledRationalReceiptV1[];
  muLowerReplicasExactScaledRational: readonly ExactScaledRationalReceiptV1[];
  evRange: DecisionEvRange;
  evExactScaledRational: {
    evLower: ExactScaledRationalReceiptV1;
    evBase: ExactScaledRationalReceiptV1;
    evUpper: ExactScaledRationalReceiptV1;
  };
} {
  if (
    input.baseReplicaPayoffsScale8.length === 0 ||
    input.baseReplicaPayoffsScale8.length !== input.lowerReplicaPayoffsScale8.length
  ) {
    throw new Error("EV_RANGE_INVALID");
  }
  const muBase = input.baseReplicaPayoffsScale8.map(exactReplicaMeanScale8);
  const muLower = input.lowerReplicaPayoffsScale8.map(exactReplicaMeanScale8);
  const range = exactDecisionEvRange({
    muBaseScale8: muBase,
    muLowerScale8: muLower,
    scientificAdmissionVerified: input.scientificAdmissionVerified,
  });
  return {
    muBaseReplicasScale8: muBase.map(receiptScale8Truncate),
    muLowerReplicasScale8: muLower.map(receiptScale8Truncate),
    muBaseReplicasExactScaledRational: muBase.map(rationalReceipt),
    muLowerReplicasExactScaledRational: muLower.map(rationalReceipt),
    evRange: range.evRange,
    evExactScaledRational: {
      evLower: rationalReceipt(range.exact.evLower),
      evBase: rationalReceipt(range.exact.evBase),
      evUpper: rationalReceipt(range.exact.evUpper),
    },
  };
}

export function computeExactDecisionEvRangeDiagnosticFromPayoffsV1(input: {
  baseReplicaPayoffsScale8: readonly (readonly string[])[];
  lowerReplicaPayoffsScale8: readonly (readonly string[])[];
}): ReturnType<typeof computeExactDecisionEvRangeFromPayoffsV1> {
  const result = computeExactDecisionEvRangeFromPayoffsV1({
    ...input,
    scientificAdmissionVerified: false,
  });
  return {
    ...result,
    evRange: {
      ...result.evRange,
      decisionActionable: false,
      reasonCodes: result.evRange.reasonCodes.includes("DECISION_NON_ACTIONABLE")
        ? result.evRange.reasonCodes
        : [...result.evRange.reasonCodes, "DECISION_NON_ACTIONABLE"],
    },
  };
}

function authorityReasonCodes(input: DecisionEconomicEvaluationInputV2): Dee649ReasonCode[] {
  const reasons: Dee649ReasonCode[] = [];
  const forecastIdentityDigest = computeDee649InstrumentIdentityDigestV1({
    organizationId: input.forecast.organizationId,
    accountId: input.forecast.accountId,
    venue: input.forecast.venue,
    market: input.forecast.market,
    symbol: input.forecast.symbol,
    baseAsset: input.forecast.baseAsset,
    quoteAsset: input.forecast.quoteAsset,
  });
  if (
    input.forecast.organizationId.trim() === "" ||
    input.forecast.forecastId.trim() === "" ||
    input.forecast.venue.trim() === "" ||
    input.forecast.market !== "SPOT" ||
    input.forecast.symbol.trim() === "" ||
    input.forecast.baseAsset.trim() === "" ||
    input.forecast.quoteAsset !== "USDT" ||
    input.forecast.symbol !== `${input.forecast.baseAsset}${input.forecast.quoteAsset}` ||
    !isDigestHex(input.forecast.instrumentIdentityDigestHex) ||
    input.forecast.instrumentIdentityDigestHex !== forecastIdentityDigest ||
    !isDigestHex(input.forecast.predictivePackageContentDigestHex) ||
    !isDigestHex(input.forecast.predictivePackageGenerationIdentityDigestHex) ||
    !isDigestHex(input.forecast.forecastGenerationIdentityDigestHex) ||
    !isDigestHex(input.forecast.forecastContentDigestHex) ||
    !isDigestHex(input.forecast.normalizationVersionDigestHex) ||
    !isDigestHex(input.forecast.distributionSemanticDigestHex) ||
    !isDigestHex(input.forecast.forecastAuthorityReceiptDigestHex) ||
    !isDigestHex(input.forecast.economicAuthorityContentDigestHex) ||
    !Number.isSafeInteger(input.forecast.forecastAnchorClosedBarEpochMs) ||
    input.forecast.forecastAnchorClosedBarEpochMs <= 0
  ) {
    reasons.push("FORECAST_AUTHORITY_INVALID");
  }
  const {
    economicAuthorityContentDigestHex,
    replicaSamples: _replicaSamples,
    ...forecastSeal
  } = input.forecast;
  void _replicaSamples;
  if (
    computeForecastEconomicAuthorityContentDigestV1(forecastSeal) !==
    economicAuthorityContentDigestHex
  ) {
    reasons.push("FORECAST_AUTHORITY_INVALID");
  }
  if (
    !verifiedAuthorityMatches({
      verification: input.authorityVerification.forecast,
      purpose: "FORECAST_ISSUANCE",
      subjectContentDigestHex: input.forecast.economicAuthorityContentDigestHex,
      authority: input.forecast,
    })
  ) {
    reasons.push("FORECAST_AUTHORITY_NOT_VERIFIED");
  }
  if (
    !sameAuthorityBinding(input.forecast, input.anchorAuthority) ||
    !sameAuthorityBinding(input.forecast, input.policy) ||
    !sameAuthorityBinding(input.forecast, input.economicSizeSet) ||
    !sameAuthorityBinding(input.forecast, input.cashAuthority)
  ) {
    reasons.push("INSTRUMENT_AUTHORITY_MISMATCH");
  }
  const anchorErrors = validateForecastAnchorPriceAuthorityV1(input.anchorAuthority);
  if (anchorErrors.length > 0) {
    reasons.push(
      anchorErrors.some((error) => error.endsWith(":MISMATCH"))
        ? "ANCHOR_AUTHORITY_MISMATCH"
        : "ANCHOR_AUTHORITY_INVALID",
    );
  }
  if (
    !verifiedAuthorityMatches({
      verification: input.authorityVerification.anchor,
      purpose: "ANCHOR_QUALIFICATION",
      subjectContentDigestHex: input.anchorAuthority.contentDigestHex,
      authority: input.anchorAuthority,
    })
  ) {
    reasons.push("ANCHOR_AUTHORITY_NOT_VERIFIED");
  }
  if (
    input.forecast.forecastAnchorClosedBarEpochMs !==
      input.anchorAuthority.forecastAnchorClosedBarEpochMs ||
    input.forecast.anchorAuthorityContentDigestHex !== input.anchorAuthority.contentDigestHex
  ) {
    reasons.push("ANCHOR_AUTHORITY_MISMATCH");
  }
  const policyErrors = validateDee649ExecutablePolicyInstanceV1(input.policy);
  let policySpecificReason = false;
  if (policyErrors.some((error) => error.startsWith("costAuthorityReceiptDigestHex:"))) {
    reasons.push("COST_AUTHORITY_MISSING");
    policySpecificReason = true;
  }
  if (
    policyErrors.some((error) => error.startsWith("liquidityCapacityAuthorityReceiptDigestHex:"))
  ) {
    reasons.push("LIQUIDITY_CAPACITY_AUTHORITY_MISSING");
    policySpecificReason = true;
  }
  if (policyErrors.some((error) => error.startsWith("quantityRulesAuthorityReceiptDigestHex:"))) {
    reasons.push("QUANTITY_AUTHORITY_MISSING");
    policySpecificReason = true;
  }
  if (policyErrors.includes("contentDigestHex:MISMATCH")) {
    reasons.push("POLICY_DIGEST_MISMATCH");
    policySpecificReason = true;
  }
  if (policyErrors.length > 0 && !policySpecificReason) {
    reasons.push("EXECUTABLE_POLICY_INVALID");
  }
  if (
    !verifiedAuthorityMatches({
      verification: input.authorityVerification.executablePolicy,
      purpose: "EXECUTABLE_POLICY_PREREGISTRATION",
      subjectContentDigestHex: input.policy.contentDigestHex,
      authority: input.policy,
    })
  ) {
    reasons.push("EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED");
  }
  const sizeErrors = validateEconomicAdmissibleSizeSetV1(input.economicSizeSet);
  if (sizeErrors.includes("contentDigestHex:MISMATCH")) {
    reasons.push("SIZE_SET_DIGEST_MISMATCH");
  } else if (sizeErrors.length > 0) {
    reasons.push("ECONOMIC_SIZE_SET_INVALID");
  }
  if (
    !verifiedAuthorityMatches({
      verification: input.authorityVerification.economicSize,
      purpose: "ECONOMIC_SIZE_AUTHORIZATION",
      subjectContentDigestHex: input.economicSizeSet.contentDigestHex,
      authority: input.economicSizeSet,
    })
  ) {
    reasons.push("ECONOMIC_SIZE_AUTHORITY_NOT_VERIFIED");
  }
  try {
    const availableCash = parseDecimal(input.cashAuthority.availableCashUsdt);
    const { contentDigestHex, ...cashPayload } = input.cashAuthority;
    if (
      availableCash < 0n ||
      !isDigestHex(input.cashAuthority.authorityReceiptDigestHex) ||
      !isDigestHex(contentDigestHex) ||
      computeCashEconomicAuthorityContentDigestV1(cashPayload) !== contentDigestHex
    ) {
      reasons.push("CASH_AUTHORITY_INVALID");
    }
  } catch {
    reasons.push("CASH_AUTHORITY_INVALID");
  }
  if (
    !verifiedAuthorityMatches({
      verification: input.authorityVerification.cash,
      purpose: "CASH_SNAPSHOT_AUTHORIZATION",
      subjectContentDigestHex: input.cashAuthority.contentDigestHex,
      authority: input.cashAuthority,
    })
  ) {
    reasons.push("CASH_AUTHORITY_NOT_VERIFIED");
  }
  const canonicalSamples = canonicalForecastSamples(input.forecast);
  if (canonicalSamples === null) {
    reasons.push("FORECAST_KM_MISMATCH");
  } else {
    try {
      const recomputed = distributionSemanticDigestHex({
        forecastGenerationIdentityDigestHex: input.forecast.forecastGenerationIdentityDigestHex,
        predictivePackageContentDigestHex: input.forecast.predictivePackageContentDigestHex,
        k: input.forecast.k,
        m: input.forecast.m,
        normalizationVersionDigestHex: input.forecast.normalizationVersionDigestHex,
        targetRoleId: input.forecast.identity.targetRoleId,
        samples: canonicalSamples,
      });
      if (recomputed !== input.forecast.distributionSemanticDigestHex) {
        reasons.push("FORECAST_DISTRIBUTION_DIGEST_MISMATCH");
      }
      const forecastContentDigestHex = computeForecastContentDigest(
        Buffer.from(input.forecast.forecastGenerationIdentityDigestHex, "hex"),
        Buffer.from(input.forecast.distributionSemanticDigestHex, "hex"),
      ).toString("hex");
      if (forecastContentDigestHex !== input.forecast.forecastContentDigestHex) {
        reasons.push("FORECAST_CONTENT_DIGEST_MISMATCH");
      }
    } catch {
      reasons.push("FORECAST_AUTHORITY_INVALID");
    }
  }
  const admission = input.scientificAdmission;
  if (
    admission.schemaVersion !== SCIENTIFIC_ADMISSION_RECEIPT_VERSION ||
    !admission.verified ||
    admission.organizationId !== input.forecast.organizationId ||
    admission.selectedPackageGenerationIdentityDigestHex !==
      input.forecast.predictivePackageGenerationIdentityDigestHex ||
    admission.selectedPackageContentDigestHex !==
      input.forecast.predictivePackageContentDigestHex ||
    admission.selectedKConfigDec !== input.forecast.k ||
    admission.selectedMConfigDec !== input.forecast.m ||
    !isDigestHex(admission.evidenceSemanticDigestHex) ||
    !isDigestHex(admission.receiptContentDigestHex)
  ) {
    reasons.push("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");
  }
  return uniqueReasons(reasons);
}

function emptyReceipt(input: {
  evaluationInput: DecisionEconomicEvaluationInputV2;
  evaluationContractId: string | null;
  evaluatedExactQuantity: string | null;
  reasons: readonly Dee649ReasonCode[];
}): WhyNotCashReceiptV2 {
  const source = input.evaluationInput;
  return receiptWithDigest({
    schemaVersion: WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION,
    decisionEconomicsContractVersion: DEE649_DECISION_ECONOMICS_CONTRACT_VERSION,
    organizationId: source.forecast.organizationId,
    accountId: source.forecast.accountId,
    forecastId: source.forecast.forecastId,
    venue: source.forecast.venue,
    market: source.forecast.market,
    symbol: source.forecast.symbol,
    baseAsset: source.forecast.baseAsset,
    quoteAsset: source.forecast.quoteAsset,
    instrumentIdentityDigestHex: source.forecast.instrumentIdentityDigestHex,
    forecastIdentity: source.forecast.identity,
    predictivePackageContentDigestHex: source.forecast.predictivePackageContentDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      source.forecast.predictivePackageGenerationIdentityDigestHex,
    forecastGenerationIdentityDigestHex: source.forecast.forecastGenerationIdentityDigestHex,
    forecastContentDigestHex: source.forecast.forecastContentDigestHex,
    distributionSemanticDigestHex: source.forecast.distributionSemanticDigestHex,
    normalizationVersionDigestHex: source.forecast.normalizationVersionDigestHex,
    k: source.forecast.k,
    m: source.forecast.m,
    forecastAnchorClosedBarEpochMs: source.forecast.forecastAnchorClosedBarEpochMs,
    forecastAuthorityReceiptDigestHex: source.forecast.forecastAuthorityReceiptDigestHex,
    forecastEconomicAuthorityContentDigestHex: source.forecast.economicAuthorityContentDigestHex,
    decisionEvaluationContractId: input.evaluationContractId,
    executionPayoffFunctionalVersion: EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
    forecastComponentUse: forecastComponentUse(source.policy),
    payoffPolicyInstanceId: source.policy.policyInstanceId,
    payoffPolicyDigestHex: source.policy.contentDigestHex,
    anchorAuthorityDigestHex: source.anchorAuthority.contentDigestHex,
    preregistrationReceiptDigestHex: source.policy.preregistrationReceiptDigestHex,
    costAuthorityReceiptDigestHex: source.policy.costAuthorityReceiptDigestHex,
    liquidityCapacityAuthorityReceiptDigestHex:
      source.policy.liquidityCapacityAuthorityReceiptDigestHex,
    quantityRulesAuthorityReceiptDigestHex: source.policy.quantityRulesAuthorityReceiptDigestHex,
    inputEconomicSizeSetId: source.economicSizeSet.sizeSetId,
    inputEconomicSizeSetDigestHex: source.economicSizeSet.contentDigestHex,
    evaluatedExactQuantity: input.evaluatedExactQuantity,
    availableCashUsdt: source.cashAuthority.availableCashUsdt,
    cashAuthorityReceiptDigestHex: source.cashAuthority.authorityReceiptDigestHex,
    cashBaselineUsdt: "0",
    evAggregationPolicy: DEE649_EV_AGGREGATION_POLICY,
    muBaseReplicasScale8: [],
    muLowerReplicasScale8: [],
    muBaseReplicasExactScaledRational: [],
    muLowerReplicasExactScaledRational: [],
    evLowerScale8: null,
    evBaseScale8: null,
    evUpperScale8: null,
    evLowerExactScaledRational: null,
    evBaseExactScaledRational: null,
    evUpperExactScaledRational: null,
    scenarioContentDigests: [],
    scenarioResidualInventoryCount: 0,
    scientificAdmission: source.scientificAdmission,
    authorityVerification: source.authorityVerification,
    actionCandidate: "ENTER_LONG",
    verdict: "DECISION_NON_ACTIONABLE",
    economicallyAdmissibleExactQuantities: [],
    reasonCodes: uniqueReasons([...input.reasons, "DECISION_NON_ACTIONABLE"]),
  });
}

/**
 * Closed-family Decision economics evaluator. Risk, Execution and Guardian permission
 * are intentionally absent from the input contract.
 */
function evaluateDecisionEconomicsV2Internal(
  input: DecisionEconomicEvaluationInputV2,
): DecisionEconomicEvaluationResultV2 {
  assertLegacyStrategyFieldsNonAuthoritative(input.legacyStrategyDiagnostics ?? {});

  const registry = resolveDecisionEvaluationContractV1(input.forecast.identity);
  const exactQuantity = input.economicSizeSet.exactQuantities[0] ?? null;
  if (!registry.ok) {
    const receipt = emptyReceipt({
      evaluationInput: input,
      evaluationContractId: null,
      evaluatedExactQuantity: exactQuantity,
      reasons: [registry.reasonCode],
    });
    return {
      decisionActionable: false,
      action: "CASH",
      economicAdmissibleSizeSet: null,
      evRange: null,
      scenarioResults: [],
      receipt,
    };
  }

  const preflightReasons = authorityReasonCodes(input);
  if (preflightReasons.length > 0 || exactQuantity === null) {
    const receipt = emptyReceipt({
      evaluationInput: input,
      evaluationContractId: registry.contract.contractId,
      evaluatedExactQuantity: exactQuantity,
      reasons:
        exactQuantity === null
          ? [...preflightReasons, "ECONOMIC_SIZE_SET_INVALID"]
          : preflightReasons,
    });
    return {
      decisionActionable: false,
      action: "CASH",
      economicAdmissibleSizeSet: null,
      evRange: null,
      scenarioResults: [],
      receipt,
    };
  }

  const canonicalSamples = canonicalForecastSamples(input.forecast);
  if (canonicalSamples === null) {
    const receipt = emptyReceipt({
      evaluationInput: input,
      evaluationContractId: registry.contract.contractId,
      evaluatedExactQuantity: exactQuantity,
      reasons: ["FORECAST_SAMPLE_INVALID"],
    });
    return {
      decisionActionable: false,
      action: "CASH",
      economicAdmissibleSizeSet: null,
      evRange: null,
      scenarioResults: [],
      receipt,
    };
  }

  const scenarioResults = canonicalSamples.map((samples) =>
    samples.map((sample13d) =>
      executionPayoffFunctionalV2({
        sample13d,
        primaryHorizonMinutes: input.forecast.identity.primaryHorizonMinutes,
        anchorAuthority: input.anchorAuthority,
        policy: input.policy,
        exactQuantity,
        availableCashUsdt: input.cashAuthority.availableCashUsdt,
        cashAuthorityReceiptDigestHex: input.cashAuthority.authorityReceiptDigestHex,
      }),
    ),
  );
  const scenarioReasons = uniqueReasons(
    scenarioResults.flatMap((replica) => replica.flatMap((scenario) => scenario.reasonCodes)),
  );
  const residualCount = scenarioResults
    .flat()
    .filter((scenario) => scenario.reasonCodes.includes("POST_EXIT_RESIDUAL_INVENTORY")).length;
  if (scenarioResults.flat().some((scenario) => scenario.status === "ECONOMICALLY_INADMISSIBLE")) {
    const receipt = receiptWithDigest({
      ...omitReceiptDigest(
        emptyReceipt({
          evaluationInput: input,
          evaluationContractId: registry.contract.contractId,
          evaluatedExactQuantity: exactQuantity,
          reasons: scenarioReasons,
        }),
      ),
      scenarioContentDigests: scenarioResults.map((replica) =>
        replica.map((scenario) => scenario.contentDigestHex),
      ),
      scenarioResidualInventoryCount: residualCount,
    });
    return {
      decisionActionable: false,
      action: "CASH",
      economicAdmissibleSizeSet: null,
      evRange: null,
      scenarioResults,
      receipt,
    };
  }

  const exactRange = computeExactDecisionEvRangeFromPayoffsV1({
    baseReplicaPayoffsScale8: scenarioResults.map((replica) =>
      replica.map((scenario) => scenario.basePayoffUsdt),
    ),
    lowerReplicaPayoffsScale8: scenarioResults.map((replica) =>
      replica.map((scenario) => scenario.lowerPayoffUsdt),
    ),
    scientificAdmissionVerified: input.scientificAdmission.verified,
  });
  const evRange = exactRange.evRange;
  const rangeReasons = evRange.reasonCodes.filter(
    (reason): reason is Dee649ReasonCode =>
      reason === "EV_RANGE_INVALID" ||
      reason === "EV_LOWER_NON_POSITIVE" ||
      reason === "SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED" ||
      reason === "DECISION_NON_ACTIONABLE",
  );
  const decisionActionable = evRange.decisionActionable && rangeReasons.length === 0;
  const reasons = decisionActionable
    ? []
    : uniqueReasons([...rangeReasons, "DECISION_NON_ACTIONABLE"]);
  const admissibleSizes = decisionActionable ? [exactQuantity] : [];

  const receipt = receiptWithDigest({
    schemaVersion: WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION,
    decisionEconomicsContractVersion: DEE649_DECISION_ECONOMICS_CONTRACT_VERSION,
    organizationId: input.forecast.organizationId,
    accountId: input.forecast.accountId,
    forecastId: input.forecast.forecastId,
    venue: input.forecast.venue,
    market: input.forecast.market,
    symbol: input.forecast.symbol,
    baseAsset: input.forecast.baseAsset,
    quoteAsset: input.forecast.quoteAsset,
    instrumentIdentityDigestHex: input.forecast.instrumentIdentityDigestHex,
    forecastIdentity: input.forecast.identity,
    predictivePackageContentDigestHex: input.forecast.predictivePackageContentDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      input.forecast.predictivePackageGenerationIdentityDigestHex,
    forecastGenerationIdentityDigestHex: input.forecast.forecastGenerationIdentityDigestHex,
    forecastContentDigestHex: input.forecast.forecastContentDigestHex,
    distributionSemanticDigestHex: input.forecast.distributionSemanticDigestHex,
    normalizationVersionDigestHex: input.forecast.normalizationVersionDigestHex,
    k: input.forecast.k,
    m: input.forecast.m,
    forecastAnchorClosedBarEpochMs: input.forecast.forecastAnchorClosedBarEpochMs,
    forecastAuthorityReceiptDigestHex: input.forecast.forecastAuthorityReceiptDigestHex,
    forecastEconomicAuthorityContentDigestHex: input.forecast.economicAuthorityContentDigestHex,
    decisionEvaluationContractId: registry.contract.contractId,
    executionPayoffFunctionalVersion: EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
    forecastComponentUse: forecastComponentUse(input.policy),
    payoffPolicyInstanceId: input.policy.policyInstanceId,
    payoffPolicyDigestHex: input.policy.contentDigestHex,
    anchorAuthorityDigestHex: input.anchorAuthority.contentDigestHex,
    preregistrationReceiptDigestHex: input.policy.preregistrationReceiptDigestHex,
    costAuthorityReceiptDigestHex: input.policy.costAuthorityReceiptDigestHex,
    liquidityCapacityAuthorityReceiptDigestHex:
      input.policy.liquidityCapacityAuthorityReceiptDigestHex,
    quantityRulesAuthorityReceiptDigestHex: input.policy.quantityRulesAuthorityReceiptDigestHex,
    inputEconomicSizeSetId: input.economicSizeSet.sizeSetId,
    inputEconomicSizeSetDigestHex: input.economicSizeSet.contentDigestHex,
    evaluatedExactQuantity: exactQuantity,
    availableCashUsdt: input.cashAuthority.availableCashUsdt,
    cashAuthorityReceiptDigestHex: input.cashAuthority.authorityReceiptDigestHex,
    cashBaselineUsdt: "0",
    evAggregationPolicy: DEE649_EV_AGGREGATION_POLICY,
    muBaseReplicasScale8: exactRange.muBaseReplicasScale8,
    muLowerReplicasScale8: exactRange.muLowerReplicasScale8,
    muBaseReplicasExactScaledRational: exactRange.muBaseReplicasExactScaledRational,
    muLowerReplicasExactScaledRational: exactRange.muLowerReplicasExactScaledRational,
    evLowerScale8: evRange.evLowerScale8,
    evBaseScale8: evRange.evBaseScale8,
    evUpperScale8: evRange.evUpperScale8,
    evLowerExactScaledRational: exactRange.evExactScaledRational.evLower,
    evBaseExactScaledRational: exactRange.evExactScaledRational.evBase,
    evUpperExactScaledRational: exactRange.evExactScaledRational.evUpper,
    scenarioContentDigests: scenarioResults.map((replica) =>
      replica.map((scenario) => scenario.contentDigestHex),
    ),
    scenarioResidualInventoryCount: residualCount,
    scientificAdmission: input.scientificAdmission,
    authorityVerification: input.authorityVerification,
    actionCandidate: "ENTER_LONG",
    verdict: decisionActionable ? "DECISION_ACTIONABLE" : "DECISION_NON_ACTIONABLE",
    economicallyAdmissibleExactQuantities: admissibleSizes,
    reasonCodes: reasons,
  });

  return {
    decisionActionable,
    action: decisionActionable ? "ENTER_LONG" : "CASH",
    economicAdmissibleSizeSet: decisionActionable ? input.economicSizeSet : null,
    evRange,
    scenarioResults,
    receipt,
  };
}

function malformedEvaluationResult(): DecisionEconomicEvaluationResultV2 {
  const zeroDigest = "0".repeat(64);
  const unverified = (
    purpose: VerifiedDecisionEconomicAuthorityV1["purpose"],
  ): VerifiedDecisionEconomicAuthorityV1 => ({
    schemaVersion: DEE649_AUTHORITY_VERIFICATION_SCHEMA_VERSION,
    verified: false,
    purpose,
    organizationId: "",
    accountId: "",
    instrumentIdentityDigestHex: zeroDigest,
    subjectContentDigestHex: zeroDigest,
    verificationReceiptDigestHex: zeroDigest,
  });
  const authorityVerification: DecisionEconomicAuthorityVerificationV1 = {
    forecast: unverified("FORECAST_ISSUANCE"),
    anchor: unverified("ANCHOR_QUALIFICATION"),
    executablePolicy: unverified("EXECUTABLE_POLICY_PREREGISTRATION"),
    economicSize: unverified("ECONOMIC_SIZE_AUTHORIZATION"),
    cash: unverified("CASH_SNAPSHOT_AUTHORIZATION"),
  };
  const receipt = receiptWithDigest({
    schemaVersion: WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION,
    decisionEconomicsContractVersion: DEE649_DECISION_ECONOMICS_CONTRACT_VERSION,
    organizationId: "",
    accountId: "",
    forecastId: "",
    venue: "",
    market: "SPOT",
    symbol: "",
    baseAsset: "",
    quoteAsset: "USDT",
    instrumentIdentityDigestHex: zeroDigest,
    forecastIdentity: {
      targetRoleId: TARGET_ROLE_EXECUTION,
      representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
      componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
      outcomeVersion: OUTCOME_VERSION,
      modelTransformVersion: MODEL_TRANSFORM_VERSION,
      primaryHorizonMinutes: 30,
      interimPositionPolicyId: DEE649_INTERIM_POSITION_POLICY_ID,
    },
    predictivePackageContentDigestHex: zeroDigest,
    predictivePackageGenerationIdentityDigestHex: zeroDigest,
    forecastGenerationIdentityDigestHex: zeroDigest,
    forecastContentDigestHex: zeroDigest,
    distributionSemanticDigestHex: zeroDigest,
    normalizationVersionDigestHex: zeroDigest,
    k: 0,
    m: 0,
    forecastAnchorClosedBarEpochMs: 0,
    forecastAuthorityReceiptDigestHex: zeroDigest,
    forecastEconomicAuthorityContentDigestHex: zeroDigest,
    decisionEvaluationContractId: null,
    executionPayoffFunctionalVersion: EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
    forecastComponentUse: {
      executableEntryReturnIndices: [],
      structuralHorizonTriggerReturnIndex: 3,
      executableExitReturnIndices: [],
      executableEntryVolumeIndices: [],
      executableExitVolumeIndices: [],
      unusedByPolicyIndices: Array.from({ length: 13 }, (_, index) => index),
      horizonTriggerIsExecutableFillPrice: false,
    },
    payoffPolicyInstanceId: "",
    payoffPolicyDigestHex: zeroDigest,
    anchorAuthorityDigestHex: zeroDigest,
    preregistrationReceiptDigestHex: zeroDigest,
    costAuthorityReceiptDigestHex: zeroDigest,
    liquidityCapacityAuthorityReceiptDigestHex: zeroDigest,
    quantityRulesAuthorityReceiptDigestHex: zeroDigest,
    inputEconomicSizeSetId: "",
    inputEconomicSizeSetDigestHex: zeroDigest,
    evaluatedExactQuantity: null,
    availableCashUsdt: "0",
    cashAuthorityReceiptDigestHex: zeroDigest,
    cashBaselineUsdt: "0",
    evAggregationPolicy: DEE649_EV_AGGREGATION_POLICY,
    muBaseReplicasScale8: [],
    muLowerReplicasScale8: [],
    muBaseReplicasExactScaledRational: [],
    muLowerReplicasExactScaledRational: [],
    evLowerScale8: null,
    evBaseScale8: null,
    evUpperScale8: null,
    evLowerExactScaledRational: null,
    evBaseExactScaledRational: null,
    evUpperExactScaledRational: null,
    scenarioContentDigests: [],
    scenarioResidualInventoryCount: 0,
    scientificAdmission: {
      schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
      verified: false,
      organizationId: "",
      selectedPackageGenerationIdentityDigestHex: zeroDigest,
      selectedPackageContentDigestHex: zeroDigest,
      selectedKConfigDec: 0,
      selectedMConfigDec: 0,
      evidenceSemanticDigestHex: zeroDigest,
      receiptContentDigestHex: zeroDigest,
    },
    authorityVerification,
    actionCandidate: "ENTER_LONG",
    verdict: "DECISION_NON_ACTIONABLE",
    economicallyAdmissibleExactQuantities: [],
    reasonCodes: ["EVALUATION_INPUT_MALFORMED", "DECISION_NON_ACTIONABLE"],
  });
  return {
    decisionActionable: false,
    action: "CASH",
    economicAdmissibleSizeSet: null,
    evRange: null,
    scenarioResults: [],
    receipt,
  };
}

export function evaluateDecisionEconomicsV2(
  input: DecisionEconomicEvaluationInputV2,
): DecisionEconomicEvaluationResultV2 {
  try {
    return evaluateDecisionEconomicsV2Internal(input);
  } catch {
    return malformedEvaluationResult();
  }
}
