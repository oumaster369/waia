import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import { DECIMAL_SCALE_FACTOR, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import {
  type Dee649ExecutablePolicyInstanceV1,
  type Dee649ReasonCode,
  type ForecastAnchorPriceAuthorityV1,
  type PerSideEconomicCostComponentsV1,
  validateDee649ExecutablePolicyInstanceV1,
  validateForecastAnchorPriceAuthorityV1,
} from "./dee649-contract-v1";

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
  reasonCodes: readonly Dee649ReasonCode[];
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
  primaryHorizonMinutes: 30 | 60;
  anchorAuthority: ForecastAnchorPriceAuthorityV1;
  policy: Dee649ExecutablePolicyInstanceV1;
  exactQuantity: string;
  availableCashUsdt: string;
  cashAuthorityReceiptDigestHex: string;
};

const BPS_DENOMINATOR_SCALED = 10_000n * DECIMAL_SCALE_FACTOR;

function isDigestHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

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
  if (!Number.isFinite(logReturn)) {
    throw new Error("FORECAST_SAMPLE_INVALID");
  }
  const reconstructed = Number(anchorPrice) * Math.exp(logReturn);
  if (!(reconstructed > 0) || !Number.isFinite(reconstructed)) {
    throw new Error("FORECAST_SAMPLE_INVALID");
  }
  return parseDecimal(quantizeScale8HalfUp(reconstructed));
}

function volumeFromSample(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("FORECAST_SAMPLE_INVALID");
  }
  return parseDecimal(quantizeScale8HalfUp(value));
}

function costAmounts(
  grossNotional: bigint,
  costs: PerSideEconomicCostComponentsV1,
): {
  amounts: EconomicCostAmountsV1;
  baseTotal: bigint;
  conservativeStress: bigint;
} {
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
  if (input.quantity < input.minimumQuantity) return false;
  return multiplyScaled(input.price, input.quantity) >= input.minimumNotional;
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
    if (entryCashRequired(quantity, input.price, input.costs) <= input.cashAvailable) {
      low = middle;
    } else {
      high = middle - 1n;
    }
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
  return {
    ...input,
    contentDigestHex: computeStableJsonDigest(input),
  };
}

function invalidScenario(input: {
  reasonCode: Dee649ReasonCode;
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

/**
 * Pure Decision-owned economic simulation for one 13-D scenario.
 * It models hypothetical fills only; it never submits, amends, or retries an order.
 */
export function executionPayoffFunctionalV2(
  input: ExecutionPayoffScenarioInputV2,
): ExecutionPayoffScenarioV2 {
  const policyErrors = validateDee649ExecutablePolicyInstanceV1(input.policy);
  if (policyErrors.length > 0) {
    const digestMismatch = policyErrors.includes("contentDigestHex:MISMATCH");
    const missingCostAuthority = policyErrors.some((error) =>
      error.startsWith("costAuthorityReceiptDigestHex:"),
    );
    const missingLiquidityAuthority = policyErrors.some((error) =>
      error.startsWith("liquidityCapacityAuthorityReceiptDigestHex:"),
    );
    const missingQuantityAuthority = policyErrors.some((error) =>
      error.startsWith("quantityRulesAuthorityReceiptDigestHex:"),
    );
    return invalidScenario({
      reasonCode: missingCostAuthority
        ? "COST_AUTHORITY_MISSING"
        : missingLiquidityAuthority
          ? "LIQUIDITY_CAPACITY_AUTHORITY_MISSING"
          : missingQuantityAuthority
            ? "QUANTITY_AUTHORITY_MISSING"
            : digestMismatch
              ? "POLICY_DIGEST_MISMATCH"
              : "EXECUTABLE_POLICY_INVALID",
      requestedQuantity: input.exactQuantity,
    });
  }
  const anchorErrors = validateForecastAnchorPriceAuthorityV1(input.anchorAuthority);
  if (anchorErrors.length > 0) {
    const mismatch = anchorErrors.some((error) => error.endsWith(":MISMATCH"));
    return invalidScenario({
      reasonCode: mismatch ? "ANCHOR_AUTHORITY_MISMATCH" : "ANCHOR_AUTHORITY_INVALID",
      requestedQuantity: input.exactQuantity,
    });
  }
  if (!isDigestHex(input.cashAuthorityReceiptDigestHex)) {
    return invalidScenario({
      reasonCode: "CASH_AUTHORITY_INVALID",
      requestedQuantity: input.exactQuantity,
      anchorPrice: input.anchorAuthority.qualifiedAnchorClosePrice,
    });
  }
  if (
    (input.primaryHorizonMinutes !== 30 && input.primaryHorizonMinutes !== 60) ||
    input.sample13d.length !== 13 ||
    input.sample13d.some((value) => !Number.isFinite(value))
  ) {
    return invalidScenario({
      reasonCode: "FORECAST_SAMPLE_INVALID",
      requestedQuantity: input.exactQuantity,
      anchorPrice: input.anchorAuthority.qualifiedAnchorClosePrice,
    });
  }

  let requestedQuantity: bigint;
  let availableCash: bigint;
  try {
    requestedQuantity = parseDecimal(input.exactQuantity);
    availableCash = parseDecimal(input.availableCashUsdt);
    if (
      requestedQuantity <= 0n ||
      availableCash < 0n ||
      formatDecimal(requestedQuantity) !== input.exactQuantity ||
      formatDecimal(availableCash) !== input.availableCashUsdt
    ) {
      throw new Error("invalid size/cash");
    }
  } catch {
    return invalidScenario({
      reasonCode: "ECONOMIC_SIZE_SET_INVALID",
      requestedQuantity: input.exactQuantity,
      anchorPrice: input.anchorAuthority.qualifiedAnchorClosePrice,
    });
  }

  const quantityStep = parseDecimal(input.policy.quantityStep);
  const minimumQuantity = parseDecimal(input.policy.minimumQuantity);
  const minimumNotional = parseDecimal(input.policy.minimumNotionalUsdt);
  const anchorPrice = parseDecimal(input.anchorAuthority.qualifiedAnchorClosePrice);
  if (
    requestedQuantity % quantityStep !== 0n ||
    requestedQuantity < minimumQuantity ||
    multiplyScaled(anchorPrice, requestedQuantity) < minimumNotional
  ) {
    return invalidScenario({
      reasonCode: "ECONOMIC_SIZE_SET_INVALID",
      requestedQuantity: input.exactQuantity,
      anchorPrice: input.anchorAuthority.qualifiedAnchorClosePrice,
    });
  }

  try {
    const participation = parseDecimal(input.policy.participationCapFraction);
    const horizonMarkPrice = priceFromReturn(
      input.anchorAuthority.qualifiedAnchorClosePrice,
      input.sample13d[3]!,
    );
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
      const price = priceFromReturn(
        input.anchorAuthority.qualifiedAnchorClosePrice,
        input.sample13d[index]!,
      );
      const volume = volumeFromSample(input.sample13d[7 + index]!);
      const capacityQuantity = floorToStep(multiplyScaled(volume, participation), quantityStep);
      const targetQuantity = entryTargets[index]!;
      let filledQuantity = minimum(targetQuantity, capacityQuantity);
      filledQuantity = affordableEntryQuantity({
        candidateQuantity: filledQuantity,
        quantityStep,
        price,
        cashAvailable: cash,
        costs: input.policy.entryCosts,
      });
      if (
        !fillMeetsMinimums({
          quantity: filledQuantity,
          price,
          minimumQuantity,
          minimumNotional,
        })
      ) {
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

    for (const [index, offsetAfterHorizon] of input.policy.exitSliceOffsetsAfterHorizon.entries()) {
      const price = priceFromReturn(
        input.anchorAuthority.qualifiedAnchorClosePrice,
        input.sample13d[4 + index]!,
      );
      const volume = volumeFromSample(input.sample13d[10 + index]!);
      const capacityQuantity = floorToStep(multiplyScaled(volume, participation), quantityStep);
      const targetQuantity = exitTargets[index]!;
      let filledQuantity = minimum(targetQuantity, capacityQuantity);
      if (
        !fillMeetsMinimums({
          quantity: filledQuantity,
          price,
          minimumQuantity,
          minimumNotional,
        })
      ) {
        filledQuantity = 0n;
      }
      const built = buildSlice({
        side: "EXIT_SELL",
        offsetMinutes: input.primaryHorizonMinutes + offsetAfterHorizon,
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
    const reasonCodes: Dee649ReasonCode[] = [];
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
  } catch {
    return invalidScenario({
      reasonCode: "FORECAST_SAMPLE_INVALID",
      requestedQuantity: input.exactQuantity,
      anchorPrice: input.anchorAuthority.qualifiedAnchorClosePrice,
    });
  }
}
