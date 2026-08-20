import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { DECIMAL_SCALE_FACTOR, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import {
  type CashEconomicAuthorityV1,
  type Dee659ExecutablePolicyInstanceV1,
  type EconomicAdmissibleSizeSetV1,
  type ForecastAnchorPriceAuthorityV1,
  type PerSideEconomicCostComponentsV1,
  validateCashEconomicAuthorityV1,
  validateDee659ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
  validateForecastAnchorPriceAuthorityV1,
} from "./dee659-execution-payoff-authorities-v1";
import {
  type Dee659AuthorityBindingV1,
  type Dee659ReasonCode,
  type ExecOpp13dForecastIdentityV1,
  type ExecutionPayoffAuthorityVerificationV1,
  resolveDecisionEvaluationContractV1,
  sameDee659AuthorityBindingV1,
  validateVerifiedDecisionEconomicAuthorityV1,
} from "./dee659-execution-payoff-contract-v1";

export const EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION = "execution-payoff-functional/v2" as const;

export type EconomicCostAmountsV1 = {
  feeUsdt: string;
  spreadUsdt: string;
  impactUsdt: string;
  slippageUsdt: string;
  baseTotalUsdt: string;
  conservativeStressUsdt: string;
};

export type EconomicFillSliceV1 = {
  side: "ENTRY_BUY" | "EXIT_SELL";
  offsetMinutes: number;
  targetQuantity: string;
  capacityQuantity: string;
  filledQuantity: string;
  grossPrice: string;
  grossNotionalUsdt: string;
  costs: EconomicCostAmountsV1;
  partial: boolean;
};

export type ExecutionPayoffScenarioV2 = {
  status: "ECONOMICALLY_ADMISSIBLE" | "ECONOMICALLY_INADMISSIBLE";
  payoffFunctionalVersion: typeof EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION;
  reasonCodes: readonly Dee659ReasonCode[];
  requestedQuantity: string;
  filledEntryQuantity: string;
  unfilledEntryQuantityRetainedAsCash: string;
  residualInventoryQuantity: string;
  anchorPrice: string;
  horizonTriggerMarkPrice: string;
  entrySlices: readonly EconomicFillSliceV1[];
  exitSlices: readonly EconomicFillSliceV1[];
  basePayoffUsdt: string;
  lowerPayoffUsdt: string;
  basePayoff: number;
  lowerPayoff: number;
  contentDigestHex: string;
};

export type ExecutionPayoffScenarioInputV2 = {
  sample13d: readonly number[];
  forecastIdentity: ExecOpp13dForecastIdentityV1;
  anchorAuthority: ForecastAnchorPriceAuthorityV1;
  policy: Dee659ExecutablePolicyInstanceV1;
  economicSizeSet: EconomicAdmissibleSizeSetV1;
  cashAuthority: CashEconomicAuthorityV1;
  authorityVerification: ExecutionPayoffAuthorityVerificationV1;
};

const BPS_DENOMINATOR_SCALED = 10_000n * DECIMAL_SCALE_FACTOR;

function multiplyScaled(left: bigint, right: bigint): bigint {
  return (left * right) / DECIMAL_SCALE_FACTOR;
}

function floorToStep(value: bigint, step: bigint): bigint {
  return (value / step) * step;
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function bpsAmountHalfUp(notional: bigint, bps: bigint): bigint {
  const product = notional * bps;
  return (product + BPS_DENOMINATOR_SCALED / 2n) / BPS_DENOMINATOR_SCALED;
}

function priceFromReturn(anchorPrice: string, logReturn: number): bigint {
  if (!Number.isFinite(logReturn)) throw new Error("FORECAST_SAMPLE_INVALID");
  const reconstructed = Number(anchorPrice) * Math.exp(logReturn);
  if (!(reconstructed > 0) || !Number.isFinite(reconstructed)) {
    throw new Error("FORECAST_SAMPLE_INVALID");
  }
  return parseDecimal(quantizeScale8HalfUp(reconstructed));
}

function volumeFromSample(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("FORECAST_SAMPLE_INVALID");
  return parseDecimal(quantizeScale8HalfUp(value));
}

function costAmounts(
  grossNotional: bigint,
  costs: PerSideEconomicCostComponentsV1,
): { amounts: EconomicCostAmountsV1; baseTotal: bigint; conservativeStress: bigint } {
  const fee = bpsAmountHalfUp(grossNotional, parseDecimal(costs.feeBps));
  const spread = bpsAmountHalfUp(grossNotional, parseDecimal(costs.spreadBps));
  const impact = bpsAmountHalfUp(grossNotional, parseDecimal(costs.impactBps));
  const slippage = bpsAmountHalfUp(grossNotional, parseDecimal(costs.slippageBps));
  const conservativeStress = bpsAmountHalfUp(
    grossNotional,
    parseDecimal(costs.conservativeStressBps),
  );
  const baseTotal = fee + spread + impact + slippage;
  return {
    amounts: {
      feeUsdt: formatDecimal(fee),
      spreadUsdt: formatDecimal(spread),
      impactUsdt: formatDecimal(impact),
      slippageUsdt: formatDecimal(slippage),
      baseTotalUsdt: formatDecimal(baseTotal),
      conservativeStressUsdt: formatDecimal(conservativeStress),
    },
    baseTotal,
    conservativeStress,
  };
}

function allocateSliceTargets(
  totalQuantity: bigint,
  weights: readonly string[],
  quantityStep: bigint,
): readonly bigint[] {
  let remaining = totalQuantity;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const target = minimum(
      floorToStep(multiplyScaled(totalQuantity, parseDecimal(weight)), quantityStep),
      remaining,
    );
    remaining -= target;
    return target;
  });
}

function fillMeetsMinimums(input: {
  quantity: bigint;
  price: bigint;
  minimumQuantity: bigint;
  minimumNotional: bigint;
}): boolean {
  return (
    input.quantity >= input.minimumQuantity &&
    multiplyScaled(input.price, input.quantity) >= input.minimumNotional
  );
}

function entryCashRequired(
  quantity: bigint,
  price: bigint,
  costs: PerSideEconomicCostComponentsV1,
): bigint {
  const grossNotional = multiplyScaled(price, quantity);
  return grossNotional + costAmounts(grossNotional, costs).baseTotal;
}

function affordableEntryQuantity(input: {
  candidateQuantity: bigint;
  quantityStep: bigint;
  price: bigint;
  cashAvailable: bigint;
  costs: PerSideEconomicCostComponentsV1;
}): bigint {
  let low = 0n;
  let high = input.candidateQuantity / input.quantityStep;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const quantity = middle * input.quantityStep;
    if (entryCashRequired(quantity, input.price, input.costs) <= input.cashAvailable) low = middle;
    else high = middle - 1n;
  }
  return low * input.quantityStep;
}

function buildSlice(input: {
  side: "ENTRY_BUY" | "EXIT_SELL";
  offsetMinutes: number;
  targetQuantity: bigint;
  capacityQuantity: bigint;
  filledQuantity: bigint;
  price: bigint;
  costs: PerSideEconomicCostComponentsV1;
}): {
  slice: EconomicFillSliceV1;
  baseCost: bigint;
  conservativeStress: bigint;
  grossNotional: bigint;
} {
  const grossNotional = multiplyScaled(input.price, input.filledQuantity);
  const cost = costAmounts(grossNotional, input.costs);
  return {
    slice: {
      side: input.side,
      offsetMinutes: input.offsetMinutes,
      targetQuantity: formatDecimal(input.targetQuantity),
      capacityQuantity: formatDecimal(input.capacityQuantity),
      filledQuantity: formatDecimal(input.filledQuantity),
      grossPrice: formatDecimal(input.price),
      grossNotionalUsdt: formatDecimal(grossNotional),
      costs: cost.amounts,
      partial: input.filledQuantity < input.targetQuantity,
    },
    baseCost: cost.baseTotal,
    conservativeStress: cost.conservativeStress,
    grossNotional,
  };
}

function scenarioResult(
  input: Omit<ExecutionPayoffScenarioV2, "contentDigestHex">,
): ExecutionPayoffScenarioV2 {
  return { ...input, contentDigestHex: computeStableJsonDigest(input) };
}

function invalidScenario(input: {
  reasonCode: Dee659ReasonCode;
  requestedQuantity?: string;
  anchorPrice?: string;
}): ExecutionPayoffScenarioV2 {
  return scenarioResult({
    status: "ECONOMICALLY_INADMISSIBLE",
    payoffFunctionalVersion: EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
    reasonCodes: [input.reasonCode],
    requestedQuantity: input.requestedQuantity ?? "0",
    filledEntryQuantity: "0",
    unfilledEntryQuantityRetainedAsCash: input.requestedQuantity ?? "0",
    residualInventoryQuantity: "0",
    anchorPrice: input.anchorPrice ?? "0",
    horizonTriggerMarkPrice: "0",
    entrySlices: [],
    exitSlices: [],
    basePayoffUsdt: "0",
    lowerPayoffUsdt: "0",
    basePayoff: 0,
    lowerPayoff: 0,
  });
}

function firstAuthorityFailure(input: ExecutionPayoffScenarioInputV2): Dee659ReasonCode | null {
  const policyErrors = validateDee659ExecutablePolicyInstanceV1(input.policy);
  if (policyErrors.length > 0) {
    if (policyErrors.some((error) => error.startsWith("costAuthorityReceiptDigestHex:"))) {
      return "COST_AUTHORITY_MISSING";
    }
    if (
      policyErrors.some((error) => error.startsWith("liquidityCapacityAuthorityReceiptDigestHex:"))
    ) {
      return "LIQUIDITY_CAPACITY_AUTHORITY_MISSING";
    }
    if (policyErrors.some((error) => error.startsWith("quantityRulesAuthorityReceiptDigestHex:"))) {
      return "QUANTITY_AUTHORITY_MISSING";
    }
    return policyErrors.includes("contentDigestHex:MISMATCH")
      ? "POLICY_DIGEST_MISMATCH"
      : "EXECUTABLE_POLICY_INVALID";
  }
  const anchorErrors = validateForecastAnchorPriceAuthorityV1(input.anchorAuthority);
  if (anchorErrors.length > 0) {
    return anchorErrors.some((error) => error.endsWith(":MISMATCH"))
      ? "ANCHOR_AUTHORITY_MISMATCH"
      : "ANCHOR_AUTHORITY_INVALID";
  }
  const sizeErrors = validateEconomicAdmissibleSizeSetV1(input.economicSizeSet);
  if (sizeErrors.length > 0) {
    return sizeErrors.includes("contentDigestHex:MISMATCH")
      ? "SIZE_SET_DIGEST_MISMATCH"
      : "ECONOMIC_SIZE_SET_INVALID";
  }
  if (validateCashEconomicAuthorityV1(input.cashAuthority).length > 0) {
    return "CASH_AUTHORITY_INVALID";
  }
  const authorities: readonly Dee659AuthorityBindingV1[] = [
    input.policy,
    input.economicSizeSet,
    input.cashAuthority,
  ];
  if (
    !authorities.every((authority) =>
      sameDee659AuthorityBindingV1(input.anchorAuthority, authority),
    )
  ) {
    return "INSTRUMENT_AUTHORITY_MISMATCH";
  }
  const checks = [
    {
      verification: input.authorityVerification.anchor,
      purpose: "ANCHOR_QUALIFICATION" as const,
      subjectContentDigestHex: input.anchorAuthority.contentDigestHex,
      authority: input.anchorAuthority,
      reason: "ANCHOR_AUTHORITY_NOT_VERIFIED" as const,
    },
    {
      verification: input.authorityVerification.executablePolicy,
      purpose: "EXECUTABLE_POLICY_PREREGISTRATION" as const,
      subjectContentDigestHex: input.policy.contentDigestHex,
      authority: input.policy,
      reason: "EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED" as const,
    },
    {
      verification: input.authorityVerification.economicSize,
      purpose: "ECONOMIC_SIZE_AUTHORIZATION" as const,
      subjectContentDigestHex: input.economicSizeSet.contentDigestHex,
      authority: input.economicSizeSet,
      reason: "ECONOMIC_SIZE_AUTHORITY_NOT_VERIFIED" as const,
    },
    {
      verification: input.authorityVerification.cash,
      purpose: "CASH_SNAPSHOT_AUTHORIZATION" as const,
      subjectContentDigestHex: input.cashAuthority.contentDigestHex,
      authority: input.cashAuthority,
      reason: "CASH_AUTHORITY_NOT_VERIFIED" as const,
    },
  ];
  for (const check of checks) {
    if (validateVerifiedDecisionEconomicAuthorityV1(check).length > 0) return check.reason;
  }
  return null;
}

/** Pure hypothetical scenario economics. It creates no Decision verdict or external effect. */
function executionPayoffFunctionalV2Internal(
  input: ExecutionPayoffScenarioInputV2,
): ExecutionPayoffScenarioV2 {
  const quantityText = input.economicSizeSet.exactQuantities[0] ?? "0";
  const anchorText = input.anchorAuthority.qualifiedAnchorClosePrice;
  if (!resolveDecisionEvaluationContractV1(input.forecastIdentity).ok) {
    return invalidScenario({
      reasonCode: "FORECAST_CONTRACT_MISMATCH",
      requestedQuantity: quantityText,
      anchorPrice: anchorText,
    });
  }
  const authorityFailure = firstAuthorityFailure(input);
  if (authorityFailure) {
    return invalidScenario({
      reasonCode: authorityFailure,
      requestedQuantity: quantityText,
      anchorPrice: anchorText,
    });
  }
  if (input.sample13d.length !== 13 || input.sample13d.some((value) => !Number.isFinite(value))) {
    return invalidScenario({
      reasonCode: "FORECAST_SAMPLE_INVALID",
      requestedQuantity: quantityText,
      anchorPrice: anchorText,
    });
  }

  const requestedQuantity = parseDecimal(quantityText);
  const availableCash = parseDecimal(input.cashAuthority.availableCashUsdt);
  const quantityStep = parseDecimal(input.policy.quantityStep);
  const minimumQuantity = parseDecimal(input.policy.minimumQuantity);
  const minimumNotional = parseDecimal(input.policy.minimumNotionalUsdt);
  const anchorPrice = parseDecimal(anchorText);
  if (
    requestedQuantity % quantityStep !== 0n ||
    requestedQuantity < minimumQuantity ||
    multiplyScaled(anchorPrice, requestedQuantity) < minimumNotional
  ) {
    return invalidScenario({
      reasonCode: "ECONOMIC_SIZE_SET_INVALID",
      requestedQuantity: quantityText,
      anchorPrice: anchorText,
    });
  }

  const participation = parseDecimal(input.policy.participationCapFraction);
  const horizonMarkPrice = priceFromReturn(anchorText, input.sample13d[3]!);
  const entryTargets = allocateSliceTargets(
    requestedQuantity,
    input.policy.entrySliceWeights,
    quantityStep,
  );
  const entrySlices: EconomicFillSliceV1[] = [];
  let cash = availableCash;
  let filledEntryQuantity = 0n;
  let totalConservativeStress = 0n;

  for (const [index, offset] of input.policy.entrySliceOffsets.entries()) {
    const price = priceFromReturn(anchorText, input.sample13d[index]!);
    const volume = volumeFromSample(input.sample13d[7 + index]!);
    const capacityQuantity = floorToStep(multiplyScaled(volume, participation), quantityStep);
    const targetQuantity = entryTargets[index]!;
    let filledQuantity = affordableEntryQuantity({
      candidateQuantity: minimum(targetQuantity, capacityQuantity),
      quantityStep,
      price,
      cashAvailable: cash,
      costs: input.policy.entryCosts,
    });
    if (!fillMeetsMinimums({ quantity: filledQuantity, price, minimumQuantity, minimumNotional })) {
      filledQuantity = 0n;
    }
    const built = buildSlice({
      side: "ENTRY_BUY",
      offsetMinutes: offset,
      targetQuantity,
      capacityQuantity,
      filledQuantity,
      price,
      costs: input.policy.entryCosts,
    });
    cash -= built.grossNotional + built.baseCost;
    filledEntryQuantity += filledQuantity;
    totalConservativeStress += built.conservativeStress;
    entrySlices.push(built.slice);
  }

  const exitTargets = allocateSliceTargets(
    filledEntryQuantity,
    input.policy.exitSliceWeights,
    quantityStep,
  );
  const exitSlices: EconomicFillSliceV1[] = [];
  let residualInventory = filledEntryQuantity;
  for (const [index, offset] of input.policy.exitSliceOffsetsAfterHorizon.entries()) {
    const price = priceFromReturn(anchorText, input.sample13d[4 + index]!);
    const volume = volumeFromSample(input.sample13d[10 + index]!);
    const capacityQuantity = floorToStep(multiplyScaled(volume, participation), quantityStep);
    const targetQuantity = exitTargets[index]!;
    let filledQuantity = minimum(targetQuantity, capacityQuantity);
    if (!fillMeetsMinimums({ quantity: filledQuantity, price, minimumQuantity, minimumNotional })) {
      filledQuantity = 0n;
    }
    const built = buildSlice({
      side: "EXIT_SELL",
      offsetMinutes: input.forecastIdentity.primaryHorizonMinutes + offset,
      targetQuantity,
      capacityQuantity,
      filledQuantity,
      price,
      costs: input.policy.exitCosts,
    });
    cash += built.grossNotional - built.baseCost;
    residualInventory -= filledQuantity;
    totalConservativeStress += built.conservativeStress;
    exitSlices.push(built.slice);
  }

  const basePayoff = cash - availableCash;
  const lowerPayoff = basePayoff - totalConservativeStress;
  const basePayoffNumber = Number(formatDecimal(basePayoff));
  const lowerPayoffNumber = Number(formatDecimal(lowerPayoff));
  if (!Number.isFinite(basePayoffNumber) || !Number.isFinite(lowerPayoffNumber)) {
    throw new Error("FORECAST_SAMPLE_INVALID");
  }
  const reasonCodes: Dee659ReasonCode[] = [];
  if (filledEntryQuantity === 0n) reasonCodes.push("NO_ENTRY_FILL");
  if (residualInventory > 0n) reasonCodes.push("POST_EXIT_RESIDUAL_INVENTORY");
  return scenarioResult({
    status: reasonCodes.length === 0 ? "ECONOMICALLY_ADMISSIBLE" : "ECONOMICALLY_INADMISSIBLE",
    payoffFunctionalVersion: EXECUTION_PAYOFF_FUNCTIONAL_V2_VERSION,
    reasonCodes,
    requestedQuantity: formatDecimal(requestedQuantity),
    filledEntryQuantity: formatDecimal(filledEntryQuantity),
    unfilledEntryQuantityRetainedAsCash: formatDecimal(requestedQuantity - filledEntryQuantity),
    residualInventoryQuantity: formatDecimal(residualInventory),
    anchorPrice: formatDecimal(anchorPrice),
    horizonTriggerMarkPrice: formatDecimal(horizonMarkPrice),
    entrySlices,
    exitSlices,
    basePayoffUsdt: formatDecimal(basePayoff),
    lowerPayoffUsdt: formatDecimal(lowerPayoff),
    basePayoff: basePayoffNumber,
    lowerPayoff: lowerPayoffNumber,
  });
}

export function executionPayoffFunctionalV2(
  input: ExecutionPayoffScenarioInputV2,
): ExecutionPayoffScenarioV2 {
  try {
    return executionPayoffFunctionalV2Internal(input);
  } catch {
    return invalidScenario({ reasonCode: "FORECAST_SAMPLE_INVALID" });
  }
}
