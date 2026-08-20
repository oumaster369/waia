import {
  createCashEconomicAuthorityV1,
  createDee659ExecutablePolicyInstanceV1,
  createForecastAnchorPriceAuthorityV1,
  createSingletonEconomicSizeSetV1,
  type Dee659ExecutablePolicyDraftV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import {
  DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
  DEE659_AUTHORITY_VERIFICATION_SCHEMA_VERSION,
  DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION,
  DEE659_INTERIM_POSITION_POLICY_ID,
  DEE659_ROUNDING_POLICY,
  DEE659_SLICE_ALLOCATION_POLICY,
  computeDee659InstrumentIdentityDigestV1,
  type ExecutionPayoffAuthorityVerificationV1,
  type VerifiedDecisionEconomicAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-contract-v1";
import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

export const DEE659_TEST_DIGEST_A = "a".repeat(64);
export const DEE659_TEST_DIGEST_B = "b".repeat(64);
export const DEE659_TEST_DIGEST_C = "c".repeat(64);
export const DEE659_TEST_DIGEST_D = "d".repeat(64);

export function dee659TestAuthorityBinding(
  overrides: Partial<{
    organizationId: string;
    accountId: string;
    venue: string;
    market: "SPOT";
    symbol: string;
    baseAsset: string;
    quoteAsset: "USDT";
  }> = {},
) {
  const identity = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    accountId: "00000000-0000-4000-8000-000000000003",
    venue: "HTX",
    market: "SPOT" as const,
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT" as const,
    ...overrides,
  };
  return {
    ...identity,
    instrumentIdentityDigestHex: computeDee659InstrumentIdentityDigestV1(identity),
  };
}

export function dee659TestForecastIdentity(primaryHorizonMinutes: 30 | 60 = 30) {
  return {
    targetRoleId: TARGET_ROLE_EXECUTION,
    representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
    componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
    outcomeVersion: OUTCOME_VERSION,
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    primaryHorizonMinutes,
    interimPositionPolicyId: DEE659_INTERIM_POSITION_POLICY_ID,
  };
}

export function dee659TestAnchor(closePrice = "100") {
  return createForecastAnchorPriceAuthorityV1({
    ...dee659TestAuthorityBinding(),
    schemaVersion: DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
    forecastAnchorClosedBarEpochMs: 1_725_000_000_000,
    qualifiedAnchorClosedBarEpochMs: 1_725_000_000_000,
    forecastAnchorClosePrice: closePrice,
    qualifiedAnchorClosePrice: closePrice,
    qualificationReceiptDigestHex: DEE659_TEST_DIGEST_A,
  });
}

export function dee659TestPolicy(overrides: Partial<Dee659ExecutablePolicyDraftV1> = {}) {
  return createDee659ExecutablePolicyInstanceV1({
    ...dee659TestAuthorityBinding(),
    schemaVersion: DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION,
    policyInstanceId: "development-candidate/test-only",
    interimPositionPolicyId: DEE659_INTERIM_POSITION_POLICY_ID,
    sliceAllocationPolicy: DEE659_SLICE_ALLOCATION_POLICY,
    roundingPolicy: DEE659_ROUNDING_POLICY,
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
    preregistrationReceiptDigestHex: DEE659_TEST_DIGEST_A,
    costAuthorityReceiptDigestHex: DEE659_TEST_DIGEST_B,
    liquidityCapacityAuthorityReceiptDigestHex: DEE659_TEST_DIGEST_C,
    quantityRulesAuthorityReceiptDigestHex: DEE659_TEST_DIGEST_D,
    ...overrides,
  });
}

export function dee659TestSize(exactQuantity = "1") {
  return createSingletonEconomicSizeSetV1({
    ...dee659TestAuthorityBinding(),
    sizeSetId: "human-exact-size/test-only",
    unit: "BASE_ASSET_QUANTITY",
    exactQuantity,
    authorityReceiptDigestHex: DEE659_TEST_DIGEST_A,
  });
}

export function dee659TestCash(availableCashUsdt = "200") {
  return createCashEconomicAuthorityV1({
    ...dee659TestAuthorityBinding(),
    availableCashUsdt,
    authorityReceiptDigestHex: DEE659_TEST_DIGEST_A,
  });
}

function verified(
  purpose: VerifiedDecisionEconomicAuthorityV1["purpose"],
  subjectContentDigestHex: string,
): VerifiedDecisionEconomicAuthorityV1 {
  const binding = dee659TestAuthorityBinding();
  return {
    schemaVersion: DEE659_AUTHORITY_VERIFICATION_SCHEMA_VERSION,
    verified: true,
    purpose,
    organizationId: binding.organizationId,
    accountId: binding.accountId,
    instrumentIdentityDigestHex: binding.instrumentIdentityDigestHex,
    subjectContentDigestHex,
    verificationReceiptDigestHex: DEE659_TEST_DIGEST_D,
  };
}

export function dee659TestAuthorityVerification(input: {
  anchor: ReturnType<typeof dee659TestAnchor>;
  policy: ReturnType<typeof dee659TestPolicy>;
  size: ReturnType<typeof dee659TestSize>;
  cash: ReturnType<typeof dee659TestCash>;
}): ExecutionPayoffAuthorityVerificationV1 {
  return {
    anchor: verified("ANCHOR_QUALIFICATION", input.anchor.contentDigestHex),
    executablePolicy: verified("EXECUTABLE_POLICY_PREREGISTRATION", input.policy.contentDigestHex),
    economicSize: verified("ECONOMIC_SIZE_AUTHORIZATION", input.size.contentDigestHex),
    cash: verified("CASH_SNAPSHOT_AUTHORIZATION", input.cash.contentDigestHex),
  };
}

function logReturn(price: number, anchor: number): number {
  return Math.log(price / anchor);
}

export function dee659Sample13d(
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
  return [
    ...entry.map((price) => logReturn(price, anchor)),
    logReturn(input.horizonPrice ?? 100, anchor),
    ...exit.map((price) => logReturn(price, anchor)),
    ...(input.entryVolumes ?? [100, 100, 100]),
    ...(input.exitVolumes ?? [100, 100, 100]),
  ];
}
