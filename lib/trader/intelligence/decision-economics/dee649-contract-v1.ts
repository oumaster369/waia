import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { DECIMAL_SCALE_FACTOR, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";

export const DEE649_DECISION_ECONOMICS_CONTRACT_VERSION = "dee649-decision-economics/v1" as const;
export const DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION =
  "dee649-executable-policy-instance/v1" as const;
export const DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION =
  "dee649-forecast-anchor-authority/v1" as const;
export const DEE649_SIZE_SET_SCHEMA_VERSION = "dee649-economic-size-set/v1" as const;
export const DEE649_DECISION_EVALUATION_CONTRACT_ID =
  "exec-opp-13d-fixed-horizon-singleton/type7-v1" as const;
export const DEE649_INTERIM_POSITION_POLICY_ID =
  "fixed-horizon-qualification/unrepresentable-normal-exits-disabled/v1" as const;
export const DEE649_SLICE_ALLOCATION_POLICY =
  "explicit-weights-last-slice-remainder-no-top-up/v1" as const;
export const DEE649_ROUNDING_POLICY = "scale8-floor-step-truncate-half-up/v1" as const;

export type Dee649ReasonCode =
  | "ANCHOR_AUTHORITY_INVALID"
  | "ANCHOR_AUTHORITY_MISMATCH"
  | "CASH_AUTHORITY_INVALID"
  | "COST_AUTHORITY_MISSING"
  | "DECISION_NON_ACTIONABLE"
  | "ECONOMIC_SIZE_SET_INVALID"
  | "EV_LOWER_NON_POSITIVE"
  | "EV_RANGE_INVALID"
  | "EXECUTABLE_POLICY_INVALID"
  | "FORECAST_AUTHORITY_INVALID"
  | "FORECAST_CONTRACT_MISMATCH"
  | "FORECAST_SAMPLE_INVALID"
  | "INSTRUMENT_AUTHORITY_MISMATCH"
  | "LIQUIDITY_CAPACITY_AUTHORITY_MISSING"
  | "NO_ENTRY_FILL"
  | "POLICY_DIGEST_MISMATCH"
  | "POST_EXIT_RESIDUAL_INVENTORY"
  | "QUANTITY_AUTHORITY_MISSING"
  | "SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED"
  | "SIZE_SET_DIGEST_MISMATCH";

export type ExecOpp13dForecastIdentityV1 = {
  targetRoleId: typeof TARGET_ROLE_EXECUTION;
  representationKind: typeof REPRESENTATION_SAMPLE_ENSEMBLE;
  componentLayoutVersion: typeof COMPONENT_LAYOUT_VERSION;
  outcomeVersion: typeof OUTCOME_VERSION;
  modelTransformVersion: typeof MODEL_TRANSFORM_VERSION;
  primaryHorizonMinutes: 30 | 60;
  interimPositionPolicyId: typeof DEE649_INTERIM_POSITION_POLICY_ID;
};

export type DecisionEvaluationContractV1 = {
  contractId: typeof DEE649_DECISION_EVALUATION_CONTRACT_ID;
  schemaVersion: typeof DEE649_DECISION_ECONOMICS_CONTRACT_VERSION;
  evaluationMethod: "TYPE7_Q10_LOWER_Q50_BASE_Q90_BASE";
  cashBaseline: "ZERO_INCREMENTAL_RETURN";
  sizeSetShape: "SINGLETON_EXACT_QUANTITY";
  componentUsage: {
    entryFillReturnIndices: readonly [0, 1, 2];
    horizonTriggerReturnIndex: 3;
    exitFillReturnIndices: readonly [4, 5, 6];
    entryCapacityVolumeIndices: readonly [7, 8, 9];
    exitCapacityVolumeIndices: readonly [10, 11, 12];
    horizonTriggerRole: "MANDATORY_EXIT_TRIGGER_MARK_NOT_EXECUTABLE_FILL";
  };
};

export type DecisionEvaluationRegistryResolution =
  | { ok: true; contract: DecisionEvaluationContractV1 }
  | { ok: false; reasonCode: "FORECAST_CONTRACT_MISMATCH" };

export type ForecastAnchorPriceAuthorityV1 = {
  schemaVersion: typeof DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION;
  venue: string;
  market: "SPOT";
  symbol: string;
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

export type Dee649ExecutablePolicyInstanceV1 = {
  schemaVersion: typeof DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION;
  policyInstanceId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  interimPositionPolicyId: typeof DEE649_INTERIM_POSITION_POLICY_ID;
  sliceAllocationPolicy: typeof DEE649_SLICE_ALLOCATION_POLICY;
  roundingPolicy: typeof DEE649_ROUNDING_POLICY;
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

export type Dee649ExecutablePolicyDraftV1 = Omit<
  Dee649ExecutablePolicyInstanceV1,
  "contentDigestHex"
>;

export type EconomicAdmissibleSizeSetV1 = {
  schemaVersion: typeof DEE649_SIZE_SET_SCHEMA_VERSION;
  sizeSetId: string;
  symbol: string;
  unit: "BASE_ASSET_QUANTITY";
  exactQuantities: readonly [string];
  authorityReceiptDigestHex: string;
  contentDigestHex: string;
};

function isDigestHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function normalizeScale8(value: string): string {
  return formatDecimal(parseDecimal(value));
}

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
  if (!isDigestHex(value)) errors.push(`${field}:INVALID_DIGEST`);
}

function requireScale8(
  value: string,
  field: string,
  errors: string[],
  predicate: (scaled: bigint) => boolean,
): void {
  try {
    const scaled = parseDecimal(value);
    if (!predicate(scaled)) errors.push(`${field}:OUT_OF_RANGE`);
    if (formatDecimal(scaled) !== value) errors.push(`${field}:NON_CANONICAL`);
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
    const offset = input.offsets[index];
    if (offset !== index + 1) {
      input.errors.push(`${input.field}:OFFSETS_MUST_BE_CONTIGUOUS_PREFIX`);
      break;
    }
  }
  let sum = 0n;
  for (const [index, weight] of input.weights.entries()) {
    try {
      const scaled = parseDecimal(weight);
      if (scaled <= 0n) input.errors.push(`${input.field}.weights[${index}]:NON_POSITIVE`);
      if (formatDecimal(scaled) !== weight) {
        input.errors.push(`${input.field}.weights[${index}]:NON_CANONICAL`);
      }
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

function anchorDigestPayload(
  input: Omit<ForecastAnchorPriceAuthorityV1, "contentDigestHex">,
): unknown {
  return input;
}

export function createForecastAnchorPriceAuthorityV1(
  input: Omit<ForecastAnchorPriceAuthorityV1, "contentDigestHex">,
): ForecastAnchorPriceAuthorityV1 {
  const candidate = {
    ...input,
    contentDigestHex: computeStableJsonDigest(anchorDigestPayload(input)),
  };
  const errors = validateForecastAnchorPriceAuthorityV1(candidate);
  if (errors.length > 0) {
    throw new Error(`[dee649-anchor-authority] ${errors.join(",")}`);
  }
  return candidate;
}

export function validateForecastAnchorPriceAuthorityV1(
  input: ForecastAnchorPriceAuthorityV1,
): readonly string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  requireNonEmpty(input.venue, "venue", errors);
  if (input.market !== "SPOT") errors.push("market:MISMATCH");
  requireNonEmpty(input.symbol, "symbol", errors);
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
      normalizeScale8(input.forecastAnchorClosePrice) !==
      normalizeScale8(input.qualifiedAnchorClosePrice)
    ) {
      errors.push("anchorClosePrice:MISMATCH");
    }
  } catch {
    // Scale errors are already recorded above.
  }
  requireDigest(input.qualificationReceiptDigestHex, "qualificationReceiptDigestHex", errors);
  requireDigest(input.contentDigestHex, "contentDigestHex", errors);
  const payload = omitContentDigest(input);
  if (computeStableJsonDigest(anchorDigestPayload(payload)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}

function policyDigestPayload(input: Dee649ExecutablePolicyDraftV1): unknown {
  return input;
}

export function createDee649ExecutablePolicyInstanceV1(
  input: Dee649ExecutablePolicyDraftV1,
): Dee649ExecutablePolicyInstanceV1 {
  const candidate = {
    ...input,
    contentDigestHex: computeStableJsonDigest(policyDigestPayload(input)),
  };
  const errors = validateDee649ExecutablePolicyInstanceV1(candidate);
  if (errors.length > 0) {
    throw new Error(`[dee649-executable-policy] ${errors.join(",")}`);
  }
  return candidate;
}

export function validateDee649ExecutablePolicyInstanceV1(
  input: Dee649ExecutablePolicyInstanceV1,
): readonly string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  requireNonEmpty(input.policyInstanceId, "policyInstanceId", errors);
  requireNonEmpty(input.venue, "venue", errors);
  if (input.market !== "SPOT") errors.push("market:MISMATCH");
  requireNonEmpty(input.symbol, "symbol", errors);
  requireNonEmpty(input.baseAsset, "baseAsset", errors);
  if (input.quoteAsset !== "USDT") errors.push("quoteAsset:MISMATCH");
  if (input.interimPositionPolicyId !== DEE649_INTERIM_POSITION_POLICY_ID) {
    errors.push("interimPositionPolicyId:MISMATCH");
  }
  if (input.sliceAllocationPolicy !== DEE649_SLICE_ALLOCATION_POLICY) {
    errors.push("sliceAllocationPolicy:MISMATCH");
  }
  if (input.roundingPolicy !== DEE649_ROUNDING_POLICY) {
    errors.push("roundingPolicy:MISMATCH");
  }
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
  const payload = omitContentDigest(input);
  if (computeStableJsonDigest(policyDigestPayload(payload)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}

function sizeSetDigestPayload(
  input: Omit<EconomicAdmissibleSizeSetV1, "contentDigestHex">,
): unknown {
  return input;
}

export function createSingletonEconomicSizeSetV1(
  input: Omit<
    EconomicAdmissibleSizeSetV1,
    "schemaVersion" | "exactQuantities" | "contentDigestHex"
  > & { exactQuantity: string },
): EconomicAdmissibleSizeSetV1 {
  const payload: Omit<EconomicAdmissibleSizeSetV1, "contentDigestHex"> = {
    schemaVersion: DEE649_SIZE_SET_SCHEMA_VERSION,
    sizeSetId: input.sizeSetId,
    symbol: input.symbol,
    unit: input.unit,
    exactQuantities: [input.exactQuantity],
    authorityReceiptDigestHex: input.authorityReceiptDigestHex,
  };
  const candidate = {
    ...payload,
    contentDigestHex: computeStableJsonDigest(sizeSetDigestPayload(payload)),
  };
  const errors = validateEconomicAdmissibleSizeSetV1(candidate);
  if (errors.length > 0) throw new Error(`[dee649-size-set] ${errors.join(",")}`);
  return candidate;
}

export function validateEconomicAdmissibleSizeSetV1(
  input: EconomicAdmissibleSizeSetV1,
): readonly string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== DEE649_SIZE_SET_SCHEMA_VERSION) errors.push("schemaVersion:MISMATCH");
  requireNonEmpty(input.sizeSetId, "sizeSetId", errors);
  requireNonEmpty(input.symbol, "symbol", errors);
  if (input.unit !== "BASE_ASSET_QUANTITY") errors.push("unit:MISMATCH");
  if (input.exactQuantities.length !== 1) errors.push("exactQuantities:NOT_SINGLETON");
  const quantity = input.exactQuantities[0];
  if (quantity === undefined) {
    errors.push("exactQuantities:MISSING");
  } else {
    requireScale8(quantity, "exactQuantities[0]", errors, (v) => v > 0n);
  }
  requireDigest(input.authorityReceiptDigestHex, "authorityReceiptDigestHex", errors);
  requireDigest(input.contentDigestHex, "contentDigestHex", errors);
  const payload = omitContentDigest(input);
  if (computeStableJsonDigest(sizeSetDigestPayload(payload)) !== input.contentDigestHex) {
    errors.push("contentDigestHex:MISMATCH");
  }
  return errors;
}

const REGISTERED_CONTRACT: DecisionEvaluationContractV1 = {
  contractId: DEE649_DECISION_EVALUATION_CONTRACT_ID,
  schemaVersion: DEE649_DECISION_ECONOMICS_CONTRACT_VERSION,
  evaluationMethod: "TYPE7_Q10_LOWER_Q50_BASE_Q90_BASE",
  cashBaseline: "ZERO_INCREMENTAL_RETURN",
  sizeSetShape: "SINGLETON_EXACT_QUANTITY",
  componentUsage: {
    entryFillReturnIndices: [0, 1, 2],
    horizonTriggerReturnIndex: 3,
    exitFillReturnIndices: [4, 5, 6],
    entryCapacityVolumeIndices: [7, 8, 9],
    exitCapacityVolumeIndices: [10, 11, 12],
    horizonTriggerRole: "MANDATORY_EXIT_TRIGGER_MARK_NOT_EXECUTABLE_FILL",
  },
};

function forecastRegistryKey(identity: ExecOpp13dForecastIdentityV1): string {
  return canonicalJsonString(identity);
}

const CLOSED_REGISTRY = new Map<string, DecisionEvaluationContractV1>(
  ([30, 60] as const).map((primaryHorizonMinutes) => [
    forecastRegistryKey({
      targetRoleId: TARGET_ROLE_EXECUTION,
      representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
      componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
      outcomeVersion: OUTCOME_VERSION,
      modelTransformVersion: MODEL_TRANSFORM_VERSION,
      primaryHorizonMinutes,
      interimPositionPolicyId: DEE649_INTERIM_POSITION_POLICY_ID,
    }),
    REGISTERED_CONTRACT,
  ]),
);

export function resolveDecisionEvaluationContractV1(
  identity: ExecOpp13dForecastIdentityV1,
): DecisionEvaluationRegistryResolution {
  const contract = CLOSED_REGISTRY.get(forecastRegistryKey(identity));
  return contract
    ? { ok: true, contract }
    : { ok: false, reasonCode: "FORECAST_CONTRACT_MISMATCH" };
}
