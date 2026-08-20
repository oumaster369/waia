import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import { assertLegacyStrategyFieldsNonAuthoritative } from "./decision-economics-v2";
import {
  executionPayoffFunctionalV2,
  type ExecutionPayoffScenarioV2,
} from "./execution-payoff-functional-v2";
import {
  type DecisionEconomicEvaluationInputV2,
  type DecisionEvaluationContractV2,
  type Dee660ReasonCode,
  resolveDecisionEvaluationContractV2,
} from "./dee660-decision-evaluation-contract-v1";
import {
  type CanonicalForecastSamplesV1,
  verifyForecastAndScientificAdmissionV1,
} from "./dee660-forecast-admission-v1";
import {
  aggregateDecisionReplicaPayoffsV1,
  type DecisionEvRangeV2,
} from "./dee660-replica-aggregation-v1";
import {
  buildMalformedWhyNotCashReceiptV2,
  buildDecisionEvaluationReceiptV1,
  buildWhyNotCashReceiptV2,
  type DecisionEvaluationReceiptV1,
  type WhyNotCashReceiptV2,
} from "./dee660-why-not-cash-receipt-v2";
import type { EconomicAdmissibleSizeSetV1 } from "./dee659-execution-payoff-authorities-v1";

export type DecisionEconomicEvaluationResultV2 = {
  decisionActionable: boolean;
  action: "ENTER_LONG" | "CASH";
  economicAdmissibleSizeSet: EconomicAdmissibleSizeSetV1 | null;
  evRange: DecisionEvRangeV2 | null;
  scenarioResults: readonly (readonly ExecutionPayoffScenarioV2[])[];
  receipt: WhyNotCashReceiptV2;
  decisionReceipt: DecisionEvaluationReceiptV1;
};

export type DecisionEvaluationSemanticMode = "HISTORICAL" | "PAPER" | "LIVE_EQUIVALENT";

function uniqueReasons(reasons: readonly Dee660ReasonCode[]): Dee660ReasonCode[] {
  return [...new Set(reasons)];
}

function observedSamplesDigest(
  input: DecisionEconomicEvaluationInputV2,
  canonicalSamples: CanonicalForecastSamplesV1 | null,
): string {
  return computeStableJsonDigest(canonicalSamples ?? input.forecast.replicaSamples);
}

function nonActionableResult(input: {
  evaluationInput: DecisionEconomicEvaluationInputV2;
  evaluationContract: DecisionEvaluationContractV2 | null;
  canonicalSamples: CanonicalForecastSamplesV1 | null;
  evaluatedExactQuantity: string | null;
  scenarioResults?: readonly (readonly ExecutionPayoffScenarioV2[])[];
  reasons: readonly Dee660ReasonCode[];
}): DecisionEconomicEvaluationResultV2 {
  const scenarioResults = input.scenarioResults ?? [];
  const receipt = buildWhyNotCashReceiptV2({
    evaluationInput: input.evaluationInput,
    evaluationContract: input.evaluationContract,
    observedCanonicalSamplesDigestHex: observedSamplesDigest(
      input.evaluationInput,
      input.canonicalSamples,
    ),
    evaluatedExactQuantity: input.evaluatedExactQuantity,
    scenarioResults,
    evaluation: null,
    decisionActionable: false,
    reasonCodes: uniqueReasons(input.reasons),
  });
  return {
    decisionActionable: false,
    action: "CASH",
    economicAdmissibleSizeSet: null,
    evRange: null,
    scenarioResults,
    receipt,
    decisionReceipt: buildDecisionEvaluationReceiptV1(receipt),
  };
}

function evaluateDecisionEconomicsV2Internal(
  input: DecisionEconomicEvaluationInputV2,
): DecisionEconomicEvaluationResultV2 {
  assertLegacyStrategyFieldsNonAuthoritative(input.legacyStrategyDiagnostics ?? {});
  const registry = resolveDecisionEvaluationContractV2(input.forecast.identity);
  const exactQuantity = input.economicSizeSet.exactQuantities[0] ?? null;
  if (!registry.ok) {
    return nonActionableResult({
      evaluationInput: input,
      evaluationContract: null,
      canonicalSamples: null,
      evaluatedExactQuantity: exactQuantity,
      reasons: [registry.reasonCode],
    });
  }

  const admission = verifyForecastAndScientificAdmissionV1(input);
  if (!admission.ok || exactQuantity === null) {
    return nonActionableResult({
      evaluationInput: input,
      evaluationContract: registry.contract,
      canonicalSamples: admission.ok ? admission.canonicalSamples : null,
      evaluatedExactQuantity: exactQuantity,
      reasons: admission.ok
        ? ["ECONOMIC_SIZE_SET_INVALID"]
        : exactQuantity === null
          ? [...admission.reasonCodes, "ECONOMIC_SIZE_SET_INVALID"]
          : admission.reasonCodes,
    });
  }

  const scenarioResults = admission.canonicalSamples.map((replica) =>
    replica.map((sample13d) =>
      executionPayoffFunctionalV2({
        sample13d,
        forecastIdentity: input.forecast.identity,
        anchorAuthority: input.anchorAuthority,
        policy: input.policy,
        economicSizeSet: input.economicSizeSet,
        cashAuthority: input.cashAuthority,
        authorityVerification: input.authorityVerification.executionPayoff,
      }),
    ),
  );
  const inadmissible = scenarioResults.flat().filter(
    (scenario) => scenario.status === "ECONOMICALLY_INADMISSIBLE",
  );
  if (inadmissible.length > 0) {
    return nonActionableResult({
      evaluationInput: input,
      evaluationContract: registry.contract,
      canonicalSamples: admission.canonicalSamples,
      evaluatedExactQuantity: exactQuantity,
      scenarioResults,
      reasons: uniqueReasons(inadmissible.flatMap((scenario) => scenario.reasonCodes)),
    });
  }

  let evRange: DecisionEvRangeV2;
  try {
    evRange = aggregateDecisionReplicaPayoffsV1({
      baseReplicaPayoffsScale8: scenarioResults.map((replica) =>
        replica.map((scenario) => scenario.basePayoffUsdt),
      ),
      lowerReplicaPayoffsScale8: scenarioResults.map((replica) =>
        replica.map((scenario) => scenario.lowerPayoffUsdt),
      ),
    });
  } catch {
    return nonActionableResult({
      evaluationInput: input,
      evaluationContract: registry.contract,
      canonicalSamples: admission.canonicalSamples,
      evaluatedExactQuantity: exactQuantity,
      scenarioResults,
      reasons: ["EV_RANGE_INVALID"],
    });
  }
  const finiteRange = [evRange.evLower, evRange.evBase, evRange.evUpper].every(Number.isFinite);
  const reasons: Dee660ReasonCode[] = [];
  if (!evRange.rangeValid || !finiteRange) reasons.push("EV_RANGE_INVALID");
  if (!evRange.evLowerPositive) reasons.push("EV_LOWER_NON_POSITIVE");
  const decisionActionable = reasons.length === 0 && evRange.evLowerPositive;
  const receipt = buildWhyNotCashReceiptV2({
    evaluationInput: input,
    evaluationContract: registry.contract,
    observedCanonicalSamplesDigestHex: observedSamplesDigest(input, admission.canonicalSamples),
    evaluatedExactQuantity: exactQuantity,
    scenarioResults,
    evaluation: evRange,
    decisionActionable,
    reasonCodes: reasons,
  });
  return {
    decisionActionable,
    action: decisionActionable ? "ENTER_LONG" : "CASH",
    economicAdmissibleSizeSet: decisionActionable ? input.economicSizeSet : null,
    evRange,
    scenarioResults,
    receipt,
    decisionReceipt: buildDecisionEvaluationReceiptV1(receipt),
  };
}

export function evaluateDecisionEconomicsV2(
  input: DecisionEconomicEvaluationInputV2,
): DecisionEconomicEvaluationResultV2 {
  try {
    return evaluateDecisionEconomicsV2Internal(input);
  } catch {
    const receipt = buildMalformedWhyNotCashReceiptV2();
    return {
      decisionActionable: false,
      action: "CASH",
      economicAdmissibleSizeSet: null,
      evRange: null,
      scenarioResults: [],
      receipt,
      decisionReceipt: buildDecisionEvaluationReceiptV1(receipt),
    };
  }
}

/** Semantic-mode labels cannot alter the pure Decision economics contract. */
export function evaluateDecisionEconomicsV2ForSemanticMode(
  input: DecisionEconomicEvaluationInputV2,
  mode: DecisionEvaluationSemanticMode,
): DecisionEconomicEvaluationResultV2 {
  void mode;
  return evaluateDecisionEconomicsV2(input);
}
