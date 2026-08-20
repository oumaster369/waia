import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import {
  assertLegacyStrategyFieldsNonAuthoritative,
  computeDecisionEvRangeV1,
  type DecisionEvRange,
} from "./decision-economics-v2";
import {
  DEE649_DECISION_ECONOMICS_CONTRACT_VERSION,
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

export type ForecastEconomicAuthorityV1 = {
  organizationId: string;
  forecastId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  identity: ExecOpp13dForecastIdentityV1;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  distributionSemanticDigestHex: string;
  replicaSamples: readonly (readonly (readonly number[])[])[];
};

export type WhyNotCashReceiptV2 = {
  schemaVersion: typeof WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION;
  decisionEconomicsContractVersion: typeof DEE649_DECISION_ECONOMICS_CONTRACT_VERSION;
  organizationId: string;
  forecastId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  forecastIdentity: ExecOpp13dForecastIdentityV1;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  distributionSemanticDigestHex: string;
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
  muBaseReplicasScale8: readonly string[];
  muLowerReplicasScale8: readonly string[];
  evLowerScale8: string | null;
  evBaseScale8: string | null;
  evUpperScale8: string | null;
  scenarioContentDigests: readonly (readonly string[])[];
  scenarioResidualInventoryCount: number;
  scientificAdmissionVerified: boolean;
  scientificAdmissionReceiptDigestHex: string | null;
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
  availableCashUsdt: string;
  cashAuthorityReceiptDigestHex: string;
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
  economicAdmissibleSizeSet: readonly string[];
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

function authorityReasonCodes(input: DecisionEconomicEvaluationInputV2): Dee649ReasonCode[] {
  const reasons: Dee649ReasonCode[] = [];
  if (
    input.forecast.organizationId.trim() === "" ||
    input.forecast.forecastId.trim() === "" ||
    input.forecast.venue.trim() === "" ||
    input.forecast.market !== "SPOT" ||
    input.forecast.symbol.trim() === "" ||
    !isDigestHex(input.forecast.predictivePackageContentDigestHex) ||
    !isDigestHex(input.forecast.predictivePackageGenerationIdentityDigestHex) ||
    !isDigestHex(input.forecast.distributionSemanticDigestHex)
  ) {
    reasons.push("FORECAST_AUTHORITY_INVALID");
  }
  if (
    input.forecast.venue !== input.anchorAuthority.venue ||
    input.forecast.venue !== input.policy.venue ||
    input.forecast.market !== input.anchorAuthority.market ||
    input.forecast.market !== input.policy.market ||
    input.forecast.symbol !== input.anchorAuthority.symbol ||
    input.forecast.symbol !== input.policy.symbol ||
    input.forecast.symbol !== input.economicSizeSet.symbol
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
  const sizeErrors = validateEconomicAdmissibleSizeSetV1(input.economicSizeSet);
  if (sizeErrors.includes("contentDigestHex:MISMATCH")) {
    reasons.push("SIZE_SET_DIGEST_MISMATCH");
  } else if (sizeErrors.length > 0) {
    reasons.push("ECONOMIC_SIZE_SET_INVALID");
  }
  try {
    const availableCash = parseDecimal(input.availableCashUsdt);
    if (
      availableCash < 0n ||
      formatDecimal(availableCash) !== input.availableCashUsdt ||
      !isDigestHex(input.cashAuthorityReceiptDigestHex)
    ) {
      reasons.push("CASH_AUTHORITY_INVALID");
    }
  } catch {
    reasons.push("CASH_AUTHORITY_INVALID");
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
    forecastId: source.forecast.forecastId,
    venue: source.forecast.venue,
    market: source.forecast.market,
    symbol: source.forecast.symbol,
    forecastIdentity: source.forecast.identity,
    predictivePackageContentDigestHex: source.forecast.predictivePackageContentDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      source.forecast.predictivePackageGenerationIdentityDigestHex,
    distributionSemanticDigestHex: source.forecast.distributionSemanticDigestHex,
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
    availableCashUsdt: source.availableCashUsdt,
    cashAuthorityReceiptDigestHex: source.cashAuthorityReceiptDigestHex,
    cashBaselineUsdt: "0",
    muBaseReplicasScale8: [],
    muLowerReplicasScale8: [],
    evLowerScale8: null,
    evBaseScale8: null,
    evUpperScale8: null,
    scenarioContentDigests: [],
    scenarioResidualInventoryCount: 0,
    scientificAdmissionVerified: source.scientificAdmissionVerified,
    scientificAdmissionReceiptDigestHex: source.scientificAdmissionReceiptDigestHex ?? null,
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
export function evaluateDecisionEconomicsV2(
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
      economicAdmissibleSizeSet: [],
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
      economicAdmissibleSizeSet: [],
      evRange: null,
      scenarioResults: [],
      receipt,
    };
  }

  if (
    input.forecast.replicaSamples.length === 0 ||
    input.forecast.replicaSamples.some((samples) => samples.length === 0)
  ) {
    const receipt = emptyReceipt({
      evaluationInput: input,
      evaluationContractId: registry.contract.contractId,
      evaluatedExactQuantity: exactQuantity,
      reasons: ["FORECAST_SAMPLE_INVALID"],
    });
    return {
      decisionActionable: false,
      action: "CASH",
      economicAdmissibleSizeSet: [],
      evRange: null,
      scenarioResults: [],
      receipt,
    };
  }

  const scenarioResults = input.forecast.replicaSamples.map((samples) =>
    samples.map((sample13d) =>
      executionPayoffFunctionalV2({
        sample13d,
        primaryHorizonMinutes: input.forecast.identity.primaryHorizonMinutes,
        anchorAuthority: input.anchorAuthority,
        policy: input.policy,
        exactQuantity,
        availableCashUsdt: input.availableCashUsdt,
        cashAuthorityReceiptDigestHex: input.cashAuthorityReceiptDigestHex,
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
      economicAdmissibleSizeSet: [],
      evRange: null,
      scenarioResults,
      receipt,
    };
  }

  const muBaseReplicas = scenarioResults.map(
    (replica) => replica.reduce((sum, scenario) => sum + scenario.basePayoff, 0) / replica.length,
  );
  const muLowerReplicas = scenarioResults.map(
    (replica) => replica.reduce((sum, scenario) => sum + scenario.lowerPayoff, 0) / replica.length,
  );
  const evRange = computeDecisionEvRangeV1({
    muBaseReplicas,
    muLowerReplicas,
    scientificAdmissionVerified: input.scientificAdmissionVerified,
  });
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
    forecastId: input.forecast.forecastId,
    venue: input.forecast.venue,
    market: input.forecast.market,
    symbol: input.forecast.symbol,
    forecastIdentity: input.forecast.identity,
    predictivePackageContentDigestHex: input.forecast.predictivePackageContentDigestHex,
    predictivePackageGenerationIdentityDigestHex:
      input.forecast.predictivePackageGenerationIdentityDigestHex,
    distributionSemanticDigestHex: input.forecast.distributionSemanticDigestHex,
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
    availableCashUsdt: input.availableCashUsdt,
    cashAuthorityReceiptDigestHex: input.cashAuthorityReceiptDigestHex,
    cashBaselineUsdt: "0",
    muBaseReplicasScale8: muBaseReplicas.map(quantizeScale8HalfUp),
    muLowerReplicasScale8: muLowerReplicas.map(quantizeScale8HalfUp),
    evLowerScale8: evRange.evLowerScale8,
    evBaseScale8: evRange.evBaseScale8,
    evUpperScale8: evRange.evUpperScale8,
    scenarioContentDigests: scenarioResults.map((replica) =>
      replica.map((scenario) => scenario.contentDigestHex),
    ),
    scenarioResidualInventoryCount: residualCount,
    scientificAdmissionVerified: input.scientificAdmissionVerified,
    scientificAdmissionReceiptDigestHex: input.scientificAdmissionReceiptDigestHex ?? null,
    actionCandidate: "ENTER_LONG",
    verdict: decisionActionable ? "DECISION_ACTIONABLE" : "DECISION_NON_ACTIONABLE",
    economicallyAdmissibleExactQuantities: admissibleSizes,
    reasonCodes: reasons,
  });

  return {
    decisionActionable,
    action: decisionActionable ? "ENTER_LONG" : "CASH",
    economicAdmissibleSizeSet: admissibleSizes,
    evRange,
    scenarioResults,
    receipt,
  };
}
