import { DECIMAL_SCALE_FACTOR, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import {
  DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
  DEE659_CASH_AUTHORITY_SCHEMA_VERSION,
  DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION,
  DEE659_INTERIM_POSITION_POLICY_ID,
  DEE659_ROUNDING_POLICY,
  DEE659_SIZE_SET_SCHEMA_VERSION,
  DEE659_SLICE_ALLOCATION_POLICY,
  type Dee659AuthorityBindingV1,
  isDee659DigestHex,
  validateDee659AuthorityBindingV1,
} from "./dee659-execution-payoff-contract-v1";

export type ForecastAnchorPriceAuthorityV1 = Dee659AuthorityBindingV1 & {
  schemaVersion: typeof DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION;
  forecastAnchorClosedBarEpochMs: number;
  qualifiedAnchorClosedBarEpochMs: number;
  forecastAnchorClosePrice: string;
  qualifiedAnchorClosePrice: string;
  qualificationReceiptDigestHex: string;
  contentDigestHex: string;
};

export type PerSideEconomicCostComponentsV1 = {
  feeBps: string;
  spreadBps: string;
  impactBps: string;
  slippageBps: string;
  conservativeStressBps: string;
};

export type Dee659ExecutablePolicyInstanceV1 = Dee659AuthorityBindingV1 & {
  schemaVersion: typeof DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION;
  policyInstanceId: string;
  interimPositionPolicyId: typeof DEE659_INTERIM_POSITION_POLICY_ID;
  sliceAllocationPolicy: typeof DEE659_SLICE_ALLOCATION_POLICY;
  roundingPolicy: typeof DEE659_ROUNDING_POLICY;
  entrySliceOffsets: readonly (1 | 2 | 3)[];
  entrySliceWeights: readonly string[];
  exitSliceOffsetsAfterHorizon: readonly (1 | 2 | 3)[];
  exitSliceWeights: readonly string[];
  participationCapFraction: string;
  quantityStep: string;
  minimumQuantity: string;
  minimumNotionalUsdt: string;
  entryCosts: PerSideEconomicCostComponentsV1;
  exitCosts: PerSideEconomicCostComponentsV1;
  partialFillPolicy: "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP";
  unfilledEntryPolicy: "RETAIN_AS_CASH";
  postExitResidualPolicy: "SIZE_ECONOMICALLY_INADMISSIBLE";
  preregistrationReceiptDigestHex: string;
  costAuthorityReceiptDigestHex: string;
  liquidityCapacityAuthorityReceiptDigestHex: string;
  quantityRulesAuthorityReceiptDigestHex: string;
  contentDigestHex: string;
};

export type Dee659ExecutablePolicyDraftV1 = Omit<
  Dee659ExecutablePolicyInstanceV1,
  "contentDigestHex"
>;

export type EconomicAdmissibleSizeSetV1 = Dee659AuthorityBindingV1 & {
  schemaVersion: typeof DEE659_SIZE_SET_SCHEMA_VERSION;
  sizeSetId: string;
  unit: "BASE_ASSET_QUANTITY";
  exactQuantities: readonly [string];
  authorityReceiptDigestHex: string;
  contentDigestHex: string;
};

export type CashEconomicAuthorityV1 = Dee659AuthorityBindingV1 & {
  schemaVersion: typeof DEE659_CASH_AUTHORITY_SCHEMA_VERSION;
  availableCashUsdt: string;
  authorityReceiptDigestHex: string;
  contentDigestHex: string;
};

function omitContentDigest<T extends { contentDigestHex: string }>(
  input: T,
): Omit<T, "contentDigestHex"> {
  const { contentDigestHex, ...payload } = input;
  void contentDigestHex;
  return payload;
}

function requireNonEmpty(value: string, field: string, errors: string[]): void {
  if (value.trim() === "") errors.push(`${field}:EMPTY`);
}

function requireDigest(value: string, field: string, errors: string[]): void {
  if (!isDee659DigestHex(value)) errors.push(`${field}:INVALID_DIGEST`);
}

function requireScale8(
  value: string,
  field: string,
  errors: string[],
  predicate: (scaled: bigint) => boolean,
): void {
  try {
    if (!predicate(parseDecimal(value))) errors.push(`${field}:OUT_OF_RANGE`);
  } catch {
    errors.push(`${field}:INVALID_SCALE8`);
  }
}

function validateSliceDefinition(input: {
  offsets: readonly number[];
  weights: readonly string[];
  field: string;
  errors: string[];
}): void {
  if (input.offsets.length < 1 || input.offsets.length > 3) {
    input.errors.push(`${input.field}:SLICE_COUNT_OUT_OF_RANGE`);
    return;
  }
  if (input.offsets.length !== input.weights.length) {
    input.errors.push(`${input.field}:OFFSET_WEIGHT_LENGTH_MISMATCH`);
    return;
  }
  for (let index = 0; index < input.offsets.length; index += 1) {
    if (input.offsets[index] !== index + 1) {
      input.errors.push(`${input.field}:OFFSETS_MUST_BE_CONTIGUOUS_PREFIX`);
      break;
    }
  }
  let sum = 0n;
  for (const [index, weight] of input.weights.entries()) {
    try {
      const scaled = parseDecimal(weight);
      if (scaled <= 0n) input.errors.push(`${input.field}.weights[${index}]:NON_POSITIVE`);
      sum += scaled;
    } catch {
      input.errors.push(`${input.field}.weights[${index}]:INVALID_SCALE8`);
    }
  }
  if (sum !== DECIMAL_SCALE_FACTOR) input.errors.push(`${input.field}:WEIGHTS_MUST_SUM_TO_ONE`);
}

function validateCosts(
  costs: PerSideEconomicCostComponentsV1,
  side: "entry" | "exit",
  errors: string[],
): void {
  for (const [field, value] of Object.entries(costs)) {
    requireScale8(value, `${side}Costs.${field}`, errors, (scaled) => scaled >= 0n);
  }
}

export function createForecastAnchorPriceAuthorityV1(
  input: Omit<ForecastAnchorPriceAuthorityV1, "contentDigestHex">,
): ForecastAnchorPriceAuthorityV1 {
  const candidate = { ...input, contentDigestHex: computeStableJsonDigest(input) };
  const errors = validateForecastAnchorPriceAuthorityV1(candidate);
  if (errors.length > 0) throw new Error(`[dee659-anchor-authority] ${errors.join(",")}`);
  return candidate;
}

export function validateForecastAnchorPriceAuthorityV1(
  input: ForecastAnchorPriceAuthorityV1,
): readonly string[] {
  const errors = [...validateDee659AuthorityBindingV1(input)];
  if (input.schemaVersion !== DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  if (
    !Number.isSafeInteger(input.forecastAnchorClosedBarEpochMs) ||
    input.forecastAnchorClosedBarEpochMs <= 0
  ) {
    errors.push("forecastAnchorClosedBarEpochMs:INVALID");
  }
  if (
    !Number.isSafeInteger(input.qualifiedAnchorClosedBarEpochMs) ||
    input.qualifiedAnchorClosedBarEpochMs <= 0
  ) {
    errors.push("qualifiedAnchorClosedBarEpochMs:INVALID");
  }
  if (input.forecastAnchorClosedBarEpochMs !== input.qualifiedAnchorClosedBarEpochMs) {
    errors.push("anchorClosedBarEpochMs:MISMATCH");
  }
  requireScale8(input.forecastAnchorClosePrice, "forecastAnchorClosePrice", errors, (v) => v > 0n);
  requireScale8(
    input.qualifiedAnchorClosePrice,
    "qualifiedAnchorClosePrice",
    errors,
    (v) => v > 0n,
  );
  try {
    if (
      formatDecimal(parseDecimal(input.forecastAnchorClosePrice)) !==
      formatDecimal(parseDecimal(input.qualifiedAnchorClosePrice))
    ) {
      errors.push("anchorClosePrice:MISMATCH");
    }
  } catch {
    // Scale errors are already recorded above.
  }
  requireDigest(input.qualificationReceiptDigestHex, "qualificationReceiptDigestHex", errors);
  requireDigest(input.contentDigestHex, "contentDigestHex", errors);
  if (computeStableJsonDigest(omitContentDigest(input)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}

export function createDee659ExecutablePolicyInstanceV1(
  input: Dee659ExecutablePolicyDraftV1,
): Dee659ExecutablePolicyInstanceV1 {
  const candidate = { ...input, contentDigestHex: computeStableJsonDigest(input) };
  const errors = validateDee659ExecutablePolicyInstanceV1(candidate);
  if (errors.length > 0) throw new Error(`[dee659-executable-policy] ${errors.join(",")}`);
  return candidate;
}

export function validateDee659ExecutablePolicyInstanceV1(
  input: Dee659ExecutablePolicyInstanceV1,
): readonly string[] {
  const errors = [...validateDee659AuthorityBindingV1(input)];
  if (input.schemaVersion !== DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  requireNonEmpty(input.policyInstanceId, "policyInstanceId", errors);
  if (input.interimPositionPolicyId !== DEE659_INTERIM_POSITION_POLICY_ID) {
    errors.push("interimPositionPolicyId:MISMATCH");
  }
  if (input.sliceAllocationPolicy !== DEE659_SLICE_ALLOCATION_POLICY) {
    errors.push("sliceAllocationPolicy:MISMATCH");
  }
  if (input.roundingPolicy !== DEE659_ROUNDING_POLICY) errors.push("roundingPolicy:MISMATCH");
  if (input.partialFillPolicy !== "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP") {
    errors.push("partialFillPolicy:MISMATCH");
  }
  if (input.unfilledEntryPolicy !== "RETAIN_AS_CASH") {
    errors.push("unfilledEntryPolicy:MISMATCH");
  }
  if (input.postExitResidualPolicy !== "SIZE_ECONOMICALLY_INADMISSIBLE") {
    errors.push("postExitResidualPolicy:MISMATCH");
  }
  validateSliceDefinition({
    offsets: input.entrySliceOffsets,
    weights: input.entrySliceWeights,
    field: "entrySlices",
    errors,
  });
  validateSliceDefinition({
    offsets: input.exitSliceOffsetsAfterHorizon,
    weights: input.exitSliceWeights,
    field: "exitSlices",
    errors,
  });
  requireScale8(
    input.participationCapFraction,
    "participationCapFraction",
    errors,
    (v) => v > 0n && v <= DECIMAL_SCALE_FACTOR,
  );
  requireScale8(input.quantityStep, "quantityStep", errors, (v) => v > 0n);
  requireScale8(input.minimumQuantity, "minimumQuantity", errors, (v) => v > 0n);
  requireScale8(input.minimumNotionalUsdt, "minimumNotionalUsdt", errors, (v) => v >= 0n);
  validateCosts(input.entryCosts, "entry", errors);
  validateCosts(input.exitCosts, "exit", errors);
  requireDigest(input.preregistrationReceiptDigestHex, "preregistrationReceiptDigestHex", errors);
  requireDigest(input.costAuthorityReceiptDigestHex, "costAuthorityReceiptDigestHex", errors);
  requireDigest(
    input.liquidityCapacityAuthorityReceiptDigestHex,
    "liquidityCapacityAuthorityReceiptDigestHex",
    errors,
  );
  requireDigest(
    input.quantityRulesAuthorityReceiptDigestHex,
    "quantityRulesAuthorityReceiptDigestHex",
    errors,
  );
  requireDigest(input.contentDigestHex, "contentDigestHex", errors);
  if (computeStableJsonDigest(omitContentDigest(input)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}

export function createSingletonEconomicSizeSetV1(
  input: Omit<
    EconomicAdmissibleSizeSetV1,
    "schemaVersion" | "exactQuantities" | "contentDigestHex"
  > & {
    exactQuantity: string;
  },
): EconomicAdmissibleSizeSetV1 {
  const { exactQuantity, ...authority } = input;
  const payload: Omit<EconomicAdmissibleSizeSetV1, "contentDigestHex"> = {
    ...authority,
    schemaVersion: DEE659_SIZE_SET_SCHEMA_VERSION,
    exactQuantities: [exactQuantity],
  };
  const candidate = { ...payload, contentDigestHex: computeStableJsonDigest(payload) };
  const errors = validateEconomicAdmissibleSizeSetV1(candidate);
  if (errors.length > 0) throw new Error(`[dee659-size-set] ${errors.join(",")}`);
  return candidate;
}

export function validateEconomicAdmissibleSizeSetV1(
  input: EconomicAdmissibleSizeSetV1,
): readonly string[] {
  const errors = [...validateDee659AuthorityBindingV1(input)];
  if (input.schemaVersion !== DEE659_SIZE_SET_SCHEMA_VERSION) errors.push("schemaVersion:MISMATCH");
  requireNonEmpty(input.sizeSetId, "sizeSetId", errors);
  if (input.unit !== "BASE_ASSET_QUANTITY") errors.push("unit:MISMATCH");
  if (input.exactQuantities.length !== 1) errors.push("exactQuantities:NOT_SINGLETON");
  const quantity = input.exactQuantities[0];
  if (quantity === undefined) errors.push("exactQuantities:MISSING");
  else requireScale8(quantity, "exactQuantities[0]", errors, (v) => v > 0n);
  requireDigest(input.authorityReceiptDigestHex, "authorityReceiptDigestHex", errors);
  requireDigest(input.contentDigestHex, "contentDigestHex", errors);
  if (computeStableJsonDigest(omitContentDigest(input)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}

export function createCashEconomicAuthorityV1(
  input: Omit<CashEconomicAuthorityV1, "schemaVersion" | "contentDigestHex">,
): CashEconomicAuthorityV1 {
  const payload = { ...input, schemaVersion: DEE659_CASH_AUTHORITY_SCHEMA_VERSION };
  const candidate = { ...payload, contentDigestHex: computeStableJsonDigest(payload) };
  const errors = validateCashEconomicAuthorityV1(candidate);
  if (errors.length > 0) throw new Error(`[dee659-cash-authority] ${errors.join(",")}`);
  return candidate;
}

export function validateCashEconomicAuthorityV1(input: CashEconomicAuthorityV1): readonly string[] {
  const errors = [...validateDee659AuthorityBindingV1(input)];
  if (input.schemaVersion !== DEE659_CASH_AUTHORITY_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  requireScale8(input.availableCashUsdt, "availableCashUsdt", errors, (v) => v >= 0n);
  requireDigest(input.authorityReceiptDigestHex, "authorityReceiptDigestHex", errors);
  requireDigest(input.contentDigestHex, "contentDigestHex", errors);
  if (computeStableJsonDigest(omitContentDigest(input)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}
