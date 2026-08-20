import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { distributionSemanticDigestHex } from "@/lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1";
import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

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

export type ForecastEconomicAuthorityV1 = Dee649AuthorityBindingV1 & {
  forecastId: string;
  identity: ExecOpp13dForecastIdentityV1;
  forecastAnchorClosedBarEpochMs: number;
  anchorAuthorityContentDigestHex: string;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  normalizationVersionDigestHex: string;
  k: number;
  m: number;
  distributionSemanticDigestHex: string;
  forecastAuthorityReceiptDigestHex: string;
  replicaSamples: readonly (readonly (readonly number[])[])[];
};

export type CashEconomicAuthorityV1 = Dee649AuthorityBindingV1 & {
  availableCashUsdt: string;
  authorityReceiptDigestHex: string;
};

export type DecisionEconomicAuthorityVerificationV1 = {
  /**
   * A trusted admission boundary may set these flags only after validating the
   * current org/account/instrument-bound object and its exact receipt/content
   * digest. Constructors and raw digest strings never confer verification.
   */
  forecastAuthorityVerified: boolean;
  anchorAuthorityVerified: boolean;
  executablePolicyAuthorityVerified: boolean;
  economicSizeAuthorityVerified: boolean;
  cashAuthorityVerified: boolean;
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
  distributionSemanticDigestHex: string;
  normalizationVersionDigestHex: string;
  k: number;
  m: number;
  forecastAnchorClosedBarEpochMs: number;
  forecastAuthorityReceiptDigestHex: string;
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
  evLowerScale8: string | null;
  evBaseScale8: string | null;
  evUpperScale8: string | null;
  scenarioContentDigests: readonly (readonly string[])[];
  scenarioResidualInventoryCount: number;
  scientificAdmissionVerified: boolean;
  scientificAdmissionReceiptDigestHex: string | null;
  authorityVerification: DecisionEconomicAuthorityVerificationV1;
  actionCandidate: "ENTER_LONG";
  verdict: "DECISION_ACTIONABLE" | "DECISION_NON_ACTIONABLE";
  economicallyAdmissibleExactQuantities: readonly string[];
  reasonCodes: readonly Dee649ReasonCode[];
  contentDigestHex: string;
};

export type DecisionEconomicEvaluationInputV2 = {
  forecast: ForecastEconomicAuthorityV1;
  anchorAuthority: ForecastAnchorPriceAuthorityV1;
  policy: Dee649ExecutablePolicyInstanceV1;
  economicSizeSet: EconomicAdmissibleSizeSetV1;
  cashAuthority: CashEconomicAuthorityV1;
  authorityVerification: DecisionEconomicAuthorityVerificationV1;
  scientificAdmissionVerified: boolean;
  scientificAdmissionReceiptDigestHex?: string | null;
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

function divideHalfUpSigned(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("FORECAST_SAMPLE_INVALID");
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  if ((absolute % denominator) * 2n >= denominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

function fixedScale8(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100_000_000n;
  const fraction = (absolute % 100_000_000n).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function exactReplicaMeanScale8(payoffs: readonly string[]): bigint {
  if (payoffs.length === 0) throw new Error("FORECAST_SAMPLE_INVALID");
  return divideHalfUpSigned(
    payoffs.reduce((sum, payoff) => sum + parseDecimal(payoff), 0n),
    BigInt(payoffs.length),
  );
}

function exactType7Scale8(
  values: readonly bigint[],
  probabilityNumerator: bigint,
  probabilityDenominator: bigint,
): bigint {
  if (values.length === 0) throw new Error("EV_RANGE_INVALID");
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (sorted.length === 1) return sorted[0]!;
  const positionNumerator = BigInt(sorted.length - 1) * probabilityNumerator;
  const lowerIndex = positionNumerator / probabilityDenominator;
  const remainder = positionNumerator % probabilityDenominator;
  const lower = sorted[Number(lowerIndex)]!;
  const upper = sorted[Math.min(sorted.length - 1, Number(lowerIndex) + 1)]!;
  return divideHalfUpSigned(
    lower * (probabilityDenominator - remainder) + upper * remainder,
    probabilityDenominator,
  );
}

function exactDecisionEvRange(input: {
  muBaseScale8: readonly bigint[];
  muLowerScale8: readonly bigint[];
  scientificAdmissionVerified: boolean;
}): DecisionEvRange {
  const evLowerScaled = exactType7Scale8(input.muLowerScale8, 1n, 10n);
  const evBaseScaled = exactType7Scale8(input.muBaseScale8, 1n, 2n);
  const evUpperScaled = exactType7Scale8(input.muBaseScale8, 9n, 10n);
  const reasons: string[] = [];
  if (!(evLowerScaled <= evBaseScaled && evBaseScaled <= evUpperScaled)) {
    reasons.push("EV_RANGE_INVALID");
  }
  if (!input.scientificAdmissionVerified) {
    reasons.push("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");
  }
  if (evLowerScaled <= 0n) reasons.push("EV_LOWER_NON_POSITIVE");
  const decisionActionable = evLowerScaled > 0n && reasons.length === 0;
  if (!decisionActionable) reasons.push("DECISION_NON_ACTIONABLE");
  return {
    evLower: Number(formatDecimal(evLowerScaled)),
    evBase: Number(formatDecimal(evBaseScaled)),
    evUpper: Number(formatDecimal(evUpperScaled)),
    evLowerScale8: fixedScale8(evLowerScaled),
    evBaseScale8: fixedScale8(evBaseScaled),
    evUpperScale8: fixedScale8(evUpperScaled),
    decisionActionable,
    reasonCodes: reasons,
  };
}

export function computeExactDecisionEvRangeFromPayoffsV1(input: {
  baseReplicaPayoffsScale8: readonly (readonly string[])[];
  lowerReplicaPayoffsScale8: readonly (readonly string[])[];
  scientificAdmissionVerified: boolean;
}): {
  muBaseReplicasScale8: readonly string[];
  muLowerReplicasScale8: readonly string[];
  evRange: DecisionEvRange;
} {
  if (
    input.baseReplicaPayoffsScale8.length === 0 ||
    input.baseReplicaPayoffsScale8.length !== input.lowerReplicaPayoffsScale8.length
  ) {
    throw new Error("EV_RANGE_INVALID");
  }
  const muBase = input.baseReplicaPayoffsScale8.map(exactReplicaMeanScale8);
  const muLower = input.lowerReplicaPayoffsScale8.map(exactReplicaMeanScale8);
  return {
    muBaseReplicasScale8: muBase.map(fixedScale8),
    muLowerReplicasScale8: muLower.map(fixedScale8),
    evRange: exactDecisionEvRange({
      muBaseScale8: muBase,
      muLowerScale8: muLower,
      scientificAdmissionVerified: input.scientificAdmissionVerified,
    }),
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
    !isDigestHex(input.forecast.normalizationVersionDigestHex) ||
    !isDigestHex(input.forecast.distributionSemanticDigestHex) ||
    !isDigestHex(input.forecast.forecastAuthorityReceiptDigestHex) ||
    !Number.isSafeInteger(input.forecast.forecastAnchorClosedBarEpochMs) ||
    input.forecast.forecastAnchorClosedBarEpochMs <= 0
  ) {
    reasons.push("FORECAST_AUTHORITY_INVALID");
  }
  if (!input.authorityVerification.forecastAuthorityVerified) {
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
  if (!input.authorityVerification.anchorAuthorityVerified) {
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
  if (!input.authorityVerification.executablePolicyAuthorityVerified) {
    reasons.push("EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED");
  }
  const sizeErrors = validateEconomicAdmissibleSizeSetV1(input.economicSizeSet);
  if (sizeErrors.includes("contentDigestHex:MISMATCH")) {
    reasons.push("SIZE_SET_DIGEST_MISMATCH");
  } else if (sizeErrors.length > 0) {
    reasons.push("ECONOMIC_SIZE_SET_INVALID");
  }
  if (!input.authorityVerification.economicSizeAuthorityVerified) {
    reasons.push("ECONOMIC_SIZE_AUTHORITY_NOT_VERIFIED");
  }
  try {
    const availableCash = parseDecimal(input.cashAuthority.availableCashUsdt);
    if (availableCash < 0n || !isDigestHex(input.cashAuthority.authorityReceiptDigestHex)) {
      reasons.push("CASH_AUTHORITY_INVALID");
    }
  } catch {
    reasons.push("CASH_AUTHORITY_INVALID");
  }
  if (!input.authorityVerification.cashAuthorityVerified) {
    reasons.push("CASH_AUTHORITY_NOT_VERIFIED");
  }
  const canonicalSamples = canonicalForecastSamples(input.forecast);
  if (canonicalSamples === null) {
    reasons.push("FORECAST_KM_MISMATCH");
  } else {
    try {
      const recomputed = distributionSemanticDigestHex({
        forecastGenerationIdentityDigestHex:
          input.forecast.predictivePackageGenerationIdentityDigestHex,
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
    } catch {
      reasons.push("FORECAST_AUTHORITY_INVALID");
    }
  }
  if (
    !input.scientificAdmissionVerified ||
    !isDigestHex(input.scientificAdmissionReceiptDigestHex)
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
    distributionSemanticDigestHex: source.forecast.distributionSemanticDigestHex,
    normalizationVersionDigestHex: source.forecast.normalizationVersionDigestHex,
    k: source.forecast.k,
    m: source.forecast.m,
    forecastAnchorClosedBarEpochMs: source.forecast.forecastAnchorClosedBarEpochMs,
    forecastAuthorityReceiptDigestHex: source.forecast.forecastAuthorityReceiptDigestHex,
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
    evLowerScale8: null,
    evBaseScale8: null,
    evUpperScale8: null,
    scenarioContentDigests: [],
    scenarioResidualInventoryCount: 0,
    scientificAdmissionVerified: source.scientificAdmissionVerified,
    scientificAdmissionReceiptDigestHex: source.scientificAdmissionReceiptDigestHex ?? null,
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
    scientificAdmissionVerified: input.scientificAdmissionVerified,
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
    distributionSemanticDigestHex: input.forecast.distributionSemanticDigestHex,
    normalizationVersionDigestHex: input.forecast.normalizationVersionDigestHex,
    k: input.forecast.k,
    m: input.forecast.m,
    forecastAnchorClosedBarEpochMs: input.forecast.forecastAnchorClosedBarEpochMs,
    forecastAuthorityReceiptDigestHex: input.forecast.forecastAuthorityReceiptDigestHex,
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
    evLowerScale8: evRange.evLowerScale8,
    evBaseScale8: evRange.evBaseScale8,
    evUpperScale8: evRange.evUpperScale8,
    scenarioContentDigests: scenarioResults.map((replica) =>
      replica.map((scenario) => scenario.contentDigestHex),
    ),
    scenarioResidualInventoryCount: residualCount,
    scientificAdmissionVerified: input.scientificAdmissionVerified,
    scientificAdmissionReceiptDigestHex: input.scientificAdmissionReceiptDigestHex ?? null,
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
  const authorityVerification: DecisionEconomicAuthorityVerificationV1 = {
    forecastAuthorityVerified: false,
    anchorAuthorityVerified: false,
    executablePolicyAuthorityVerified: false,
    economicSizeAuthorityVerified: false,
    cashAuthorityVerified: false,
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
    distributionSemanticDigestHex: zeroDigest,
    normalizationVersionDigestHex: zeroDigest,
    k: 0,
    m: 0,
    forecastAnchorClosedBarEpochMs: 0,
    forecastAuthorityReceiptDigestHex: zeroDigest,
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
    evLowerScale8: null,
    evBaseScale8: null,
    evUpperScale8: null,
    scenarioContentDigests: [],
    scenarioResidualInventoryCount: 0,
    scientificAdmissionVerified: false,
    scientificAdmissionReceiptDigestHex: null,
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
