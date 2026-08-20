import {
  createDee649ExecutablePolicyInstanceV1,
  createForecastAnchorPriceAuthorityV1,
  DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION,
  DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION,
  DEE649_INTERIM_POSITION_POLICY_ID,
  DEE649_ROUNDING_POLICY,
  DEE649_SLICE_ALLOCATION_POLICY,
  type Dee649ExecutablePolicyDraftV1,
  type ForecastAnchorPriceAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee649-contract-v1";

export const DEE649_TEST_DIGEST_A = "a".repeat(64);
export const DEE649_TEST_DIGEST_B = "b".repeat(64);
export const DEE649_TEST_DIGEST_C = "c".repeat(64);
export const DEE649_TEST_DIGEST_D = "d".repeat(64);

export function dee649TestAnchor(closePrice = "100"): ForecastAnchorPriceAuthorityV1 {
  return createForecastAnchorPriceAuthorityV1({
    schemaVersion: DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION,
    forecastAnchorClosedBarEpochMs: 1_725_000_000_000,
    qualifiedAnchorClosedBarEpochMs: 1_725_000_000_000,
    forecastAnchorClosePrice: closePrice,
    qualifiedAnchorClosePrice: closePrice,
    qualificationReceiptDigestHex: DEE649_TEST_DIGEST_A,
  });
}

export function dee649TestPolicy(overrides: Partial<Dee649ExecutablePolicyDraftV1> = {}) {
  const draft: Dee649ExecutablePolicyDraftV1 = {
    schemaVersion: DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION,
    policyInstanceId: "development-candidate/test-only",
    interimPositionPolicyId: DEE649_INTERIM_POSITION_POLICY_ID,
    sliceAllocationPolicy: DEE649_SLICE_ALLOCATION_POLICY,
    roundingPolicy: DEE649_ROUNDING_POLICY,
    entrySliceOffsets: [1, 2],
    entrySliceWeights: ["0.5", "0.5"],
    exitSliceOffsetsAfterHorizon: [1, 2],
    exitSliceWeights: ["0.5", "0.5"],
    participationCapFraction: "0.1",
    quantityStep: "0.1",
    minimumQuantity: "0.1",
    minimumNotionalUsdt: "1",
    entryCosts: {
      feeBps: "0",
      spreadBps: "0",
      impactBps: "0",
      slippageBps: "0",
      conservativeStressBps: "0",
    },
    exitCosts: {
      feeBps: "0",
      spreadBps: "0",
      impactBps: "0",
      slippageBps: "0",
      conservativeStressBps: "0",
    },
    partialFillPolicy: "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP",
    unfilledEntryPolicy: "RETAIN_AS_CASH",
    postExitResidualPolicy: "SIZE_ECONOMICALLY_INADMISSIBLE",
    preregistrationReceiptDigestHex: DEE649_TEST_DIGEST_A,
    costAuthorityReceiptDigestHex: DEE649_TEST_DIGEST_B,
    liquidityCapacityAuthorityReceiptDigestHex: DEE649_TEST_DIGEST_C,
    quantityRulesAuthorityReceiptDigestHex: DEE649_TEST_DIGEST_D,
    ...overrides,
  };
  return createDee649ExecutablePolicyInstanceV1(draft);
}

function logReturn(price: number, anchor: number): number {
  return Math.log(price / anchor);
}

export function dee649Sample13d(
  input: {
    anchorPrice?: number;
    entryPrices?: readonly [number, number, number];
    horizonPrice?: number;
    exitPrices?: readonly [number, number, number];
    entryVolumes?: readonly [number, number, number];
    exitVolumes?: readonly [number, number, number];
  } = {},
): readonly number[] {
  const anchor = input.anchorPrice ?? 100;
  const entry = input.entryPrices ?? [100, 100, 100];
  const exit = input.exitPrices ?? [100, 100, 100];
  const entryVolumes = input.entryVolumes ?? [100, 100, 100];
  const exitVolumes = input.exitVolumes ?? [100, 100, 100];
  return [
    logReturn(entry[0], anchor),
    logReturn(entry[1], anchor),
    logReturn(entry[2], anchor),
    logReturn(input.horizonPrice ?? 100, anchor),
    logReturn(exit[0], anchor),
    logReturn(exit[1], anchor),
    logReturn(exit[2], anchor),
    ...entryVolumes,
    ...exitVolumes,
  ];
}
