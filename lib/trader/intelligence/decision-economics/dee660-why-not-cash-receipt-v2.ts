import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import { EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION } from "./execution-payoff-functional-v2";
import type { ExecutionPayoffScenarioV2 } from "./execution-payoff-functional-v2";
import type {
  DecisionEconomicEvaluationInputV2,
  DecisionEvaluationContractV2,
  Dee660ReasonCode,
} from "./dee660-decision-evaluation-contract-v1";
import type { DecisionEvRangeV2 } from "./dee660-replica-aggregation-v1";

export const WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION = "why-not-cash-receipt/v2" as const;
export const DECISION_EVALUATION_RECEIPT_V1_SCHEMA_VERSION =
  "decision-evaluation-receipt/v1" as const;

export type WhyNotCashReceiptV2 = {
  schemaVersion: typeof WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION;
  evaluationContract: DecisionEvaluationContractV2 | null;
  authorityBinding: {
    organizationId: string;
    accountId: string;
    venue: string;
    market: "SPOT";
    symbol: string;
    baseAsset: string;
    quoteAsset: "USDT";
    instrumentIdentityDigestHex: string;
  } | null;
  forecast: {
    forecastId: string;
    identity: DecisionEconomicEvaluationInputV2["forecast"]["identity"];
    predictivePackageContentDigestHex: string;
    predictivePackageGenerationIdentityDigestHex: string;
    forecastGenerationIdentityDigestHex: string;
    forecastContentDigestHex: string;
    distributionSemanticDigestHex: string;
    normalizationVersionDigestHex: string;
    forecastAuthorityContentDigestHex: string;
    issuanceReceiptDigestHex: string;
    observedCanonicalSamplesDigestHex: string;
    k: number;
    m: number;
    forecastAnchorClosedBarEpochMs: number;
  } | null;
  scientificAdmission: DecisionEconomicEvaluationInputV2["scientificAdmission"] | null;
  payoff: {
    executionPayoffFunctionalVersion: typeof EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION;
    anchorAuthorityDigestHex: string;
    policyInstanceId: string;
    policyDigestHex: string;
    preregistrationReceiptDigestHex: string;
    costAuthorityReceiptDigestHex: string;
    liquidityCapacityAuthorityReceiptDigestHex: string;
    quantityRulesAuthorityReceiptDigestHex: string;
    componentUse: {
      executableEntryReturnIndices: readonly number[];
      structuralHorizonTriggerReturnIndex: 3;
      executableExitReturnIndices: readonly number[];
      executableEntryVolumeIndices: readonly number[];
      executableExitVolumeIndices: readonly number[];
      unusedByPolicyIndices: readonly number[];
      horizonTriggerIsExecutableFillPrice: false;
    };
  } | null;
  candidate: {
    actionCandidate: "ENTER_LONG";
    inputEconomicSizeSetId: string;
    inputEconomicSizeSetDigestHex: string;
    evaluatedExactQuantity: string | null;
    availableCashUsdt: string;
    cashAuthorityDigestHex: string;
    cashAuthorityReceiptDigestHex: string;
    cashBaselineUsdt: "0";
  } | null;
  authorityVerification: DecisionEconomicEvaluationInputV2["authorityVerification"] | null;
  evaluation: DecisionEvRangeV2 | null;
  scenarioContentDigests: readonly (readonly string[])[];
  scenarioResidualInventoryCount: number;
  alternatives: readonly [
    { action: "CASH"; incrementalReturnUsdt: "0" },
    { action: "ENTER_LONG"; evaluatedExactQuantity: string | null },
  ];
  selectedAction: "ENTER_LONG" | "CASH";
  verdict: "DECISION_ACTIONABLE" | "DECISION_NON_ACTIONABLE";
  decisionActionable: boolean;
  economicallyAdmissibleExactQuantities: readonly string[];
  reasonCodes: readonly Dee660ReasonCode[];
  contentDigestHex: string;
};

export type DecisionEvaluationReceiptV1 = {
  schemaVersion: typeof DECISION_EVALUATION_RECEIPT_V1_SCHEMA_VERSION;
  evaluationContractVersion: DecisionEvaluationContractV2["schemaVersion"] | null;
  whyNotCashReceiptDigestHex: string;
  forecastAuthorityContentDigestHex: string | null;
  inputEconomicSizeSetDigestHex: string | null;
  selectedAction: "ENTER_LONG" | "CASH";
  verdict: "DECISION_ACTIONABLE" | "DECISION_NON_ACTIONABLE";
  decisionActionable: boolean;
  evLowerExact: DecisionEvRangeV2["evLowerExact"] | null;
  evBaseExact: DecisionEvRangeV2["evBaseExact"] | null;
  evUpperExact: DecisionEvRangeV2["evUpperExact"] | null;
  contentDigestHex: string;
};

function uniqueReasons(reasons: readonly Dee660ReasonCode[]): Dee660ReasonCode[] {
  return [...new Set(reasons)];
}

function componentUse(
  policy: DecisionEconomicEvaluationInputV2["policy"],
): NonNullable<WhyNotCashReceiptV2["payoff"]>["componentUse"] {
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

function withDigest(
  input: Omit<WhyNotCashReceiptV2, "contentDigestHex">,
): WhyNotCashReceiptV2 {
  return { ...input, contentDigestHex: computeStableJsonDigest(input) };
}

export function validateWhyNotCashReceiptV2(input: WhyNotCashReceiptV2): readonly string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentDigestHex)) {
    errors.push("contentDigestHex:INVALID_DIGEST");
  }
  const { contentDigestHex, ...payload } = input;
  if (computeStableJsonDigest(payload) !== contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  if (
    input.decisionActionable !== (input.verdict === "DECISION_ACTIONABLE") ||
    input.decisionActionable !== (input.selectedAction === "ENTER_LONG")
  ) {
    errors.push("verdict:INCONSISTENT");
  }
  if (
    input.decisionActionable !==
    (input.economicallyAdmissibleExactQuantities.length === 1)
  ) {
    errors.push("economicallyAdmissibleExactQuantities:INCONSISTENT");
  }
  return errors;
}

export function buildDecisionEvaluationReceiptV1(
  whyNotCash: WhyNotCashReceiptV2,
): DecisionEvaluationReceiptV1 {
  const payload: Omit<DecisionEvaluationReceiptV1, "contentDigestHex"> = {
    schemaVersion: DECISION_EVALUATION_RECEIPT_V1_SCHEMA_VERSION,
    evaluationContractVersion: whyNotCash.evaluationContract?.schemaVersion ?? null,
    whyNotCashReceiptDigestHex: whyNotCash.contentDigestHex,
    forecastAuthorityContentDigestHex:
      whyNotCash.forecast?.forecastAuthorityContentDigestHex ?? null,
    inputEconomicSizeSetDigestHex: whyNotCash.candidate?.inputEconomicSizeSetDigestHex ?? null,
    selectedAction: whyNotCash.selectedAction,
    verdict: whyNotCash.verdict,
    decisionActionable: whyNotCash.decisionActionable,
    evLowerExact: whyNotCash.evaluation?.evLowerExact ?? null,
    evBaseExact: whyNotCash.evaluation?.evBaseExact ?? null,
    evUpperExact: whyNotCash.evaluation?.evUpperExact ?? null,
  };
  return { ...payload, contentDigestHex: computeStableJsonDigest(payload) };
}

export function validateDecisionEvaluationReceiptV1(
  input: DecisionEvaluationReceiptV1,
): readonly string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== DECISION_EVALUATION_RECEIPT_V1_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  const { contentDigestHex, ...payload } = input;
  if (!/^[0-9a-f]{64}$/.test(contentDigestHex)) {
    errors.push("contentDigestHex:INVALID_DIGEST");
  } else if (computeStableJsonDigest(payload) !== contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  if (
    input.decisionActionable !== (input.verdict === "DECISION_ACTIONABLE") ||
    input.decisionActionable !== (input.selectedAction === "ENTER_LONG")
  ) {
    errors.push("verdict:INCONSISTENT");
  }
  return errors;
}

export function buildWhyNotCashReceiptV2(input: {
  evaluationInput: DecisionEconomicEvaluationInputV2;
  evaluationContract: DecisionEvaluationContractV2 | null;
  observedCanonicalSamplesDigestHex: string;
  evaluatedExactQuantity: string | null;
  scenarioResults: readonly (readonly ExecutionPayoffScenarioV2[])[];
  evaluation: DecisionEvRangeV2 | null;
  decisionActionable: boolean;
  reasonCodes: readonly Dee660ReasonCode[];
}): WhyNotCashReceiptV2 {
  const source = input.evaluationInput;
  const selectedAction = input.decisionActionable ? "ENTER_LONG" : "CASH";
  const reasonCodes = input.decisionActionable
    ? uniqueReasons(input.reasonCodes)
    : uniqueReasons([...input.reasonCodes, "DECISION_NON_ACTIONABLE"]);
  return withDigest({
    schemaVersion: WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION,
    evaluationContract: input.evaluationContract,
    authorityBinding: {
      organizationId: source.forecast.organizationId,
      accountId: source.forecast.accountId,
      venue: source.forecast.venue,
      market: source.forecast.market,
      symbol: source.forecast.symbol,
      baseAsset: source.forecast.baseAsset,
      quoteAsset: source.forecast.quoteAsset,
      instrumentIdentityDigestHex: source.forecast.instrumentIdentityDigestHex,
    },
    forecast: {
      forecastId: source.forecast.forecastId,
      identity: source.forecast.identity,
      predictivePackageContentDigestHex: source.forecast.predictivePackageContentDigestHex,
      predictivePackageGenerationIdentityDigestHex:
        source.forecast.predictivePackageGenerationIdentityDigestHex,
      forecastGenerationIdentityDigestHex: source.forecast.forecastGenerationIdentityDigestHex,
      forecastContentDigestHex: source.forecast.forecastContentDigestHex,
      distributionSemanticDigestHex: source.forecast.distributionSemanticDigestHex,
      normalizationVersionDigestHex: source.forecast.normalizationVersionDigestHex,
      forecastAuthorityContentDigestHex: source.forecast.contentDigestHex,
      issuanceReceiptDigestHex: source.forecast.issuanceReceiptDigestHex,
      observedCanonicalSamplesDigestHex: input.observedCanonicalSamplesDigestHex,
      k: source.forecast.k,
      m: source.forecast.m,
      forecastAnchorClosedBarEpochMs: source.forecast.forecastAnchorClosedBarEpochMs,
    },
    scientificAdmission: source.scientificAdmission,
    payoff: {
      executionPayoffFunctionalVersion: EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
      anchorAuthorityDigestHex: source.anchorAuthority.contentDigestHex,
      policyInstanceId: source.policy.policyInstanceId,
      policyDigestHex: source.policy.contentDigestHex,
      preregistrationReceiptDigestHex: source.policy.preregistrationReceiptDigestHex,
      costAuthorityReceiptDigestHex: source.policy.costAuthorityReceiptDigestHex,
      liquidityCapacityAuthorityReceiptDigestHex:
        source.policy.liquidityCapacityAuthorityReceiptDigestHex,
      quantityRulesAuthorityReceiptDigestHex: source.policy.quantityRulesAuthorityReceiptDigestHex,
      componentUse: componentUse(source.policy),
    },
    candidate: {
      actionCandidate: "ENTER_LONG",
      inputEconomicSizeSetId: source.economicSizeSet.sizeSetId,
      inputEconomicSizeSetDigestHex: source.economicSizeSet.contentDigestHex,
      evaluatedExactQuantity: input.evaluatedExactQuantity,
      availableCashUsdt: source.cashAuthority.availableCashUsdt,
      cashAuthorityDigestHex: source.cashAuthority.contentDigestHex,
      cashAuthorityReceiptDigestHex: source.cashAuthority.authorityReceiptDigestHex,
      cashBaselineUsdt: "0",
    },
    authorityVerification: source.authorityVerification,
    evaluation: input.evaluation,
    scenarioContentDigests: input.scenarioResults.map((replica) =>
      replica.map((scenario) => scenario.contentDigestHex),
    ),
    scenarioResidualInventoryCount: input.scenarioResults
      .flat()
      .filter((scenario) => scenario.reasonCodes.includes("POST_EXIT_RESIDUAL_INVENTORY")).length,
    alternatives: [
      { action: "CASH", incrementalReturnUsdt: "0" },
      { action: "ENTER_LONG", evaluatedExactQuantity: input.evaluatedExactQuantity },
    ],
    selectedAction,
    verdict: input.decisionActionable ? "DECISION_ACTIONABLE" : "DECISION_NON_ACTIONABLE",
    decisionActionable: input.decisionActionable,
    economicallyAdmissibleExactQuantities:
      input.decisionActionable && input.evaluatedExactQuantity !== null
        ? [input.evaluatedExactQuantity]
        : [],
    reasonCodes,
  });
}

export function buildMalformedWhyNotCashReceiptV2(): WhyNotCashReceiptV2 {
  return withDigest({
    schemaVersion: WHY_NOT_CASH_RECEIPT_V2_SCHEMA_VERSION,
    evaluationContract: null,
    authorityBinding: null,
    forecast: null,
    scientificAdmission: null,
    payoff: null,
    candidate: null,
    authorityVerification: null,
    evaluation: null,
    scenarioContentDigests: [],
    scenarioResidualInventoryCount: 0,
    alternatives: [
      { action: "CASH", incrementalReturnUsdt: "0" },
      { action: "ENTER_LONG", evaluatedExactQuantity: null },
    ],
    selectedAction: "CASH",
    verdict: "DECISION_NON_ACTIONABLE",
    decisionActionable: false,
    economicallyAdmissibleExactQuantities: [],
    reasonCodes: ["EVALUATION_INPUT_MALFORMED", "DECISION_NON_ACTIONABLE"],
  });
}
