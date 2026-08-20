import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { canonicalJsonString, computeStableJsonDigest } from "@/lib/trader/research/digest";

export const DEE659_DECISION_ECONOMICS_CONTRACT_VERSION =
  "dee659-decision-economics-contract/v1" as const;
export const DEE659_EXECUTABLE_POLICY_SCHEMA_VERSION =
  "dee659-executable-policy-instance/v1" as const;
export const DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION =
  "dee659-forecast-anchor-authority/v1" as const;
export const DEE659_SIZE_SET_SCHEMA_VERSION = "dee659-economic-size-set/v1" as const;
export const DEE659_CASH_AUTHORITY_SCHEMA_VERSION = "dee659-cash-authority/v1" as const;
export const DEE659_AUTHORITY_VERIFICATION_SCHEMA_VERSION =
  "dee659-authority-verification/v1" as const;
export const DEE659_DECISION_EVALUATION_CONTRACT_ID =
  "exec-opp-13d-fixed-horizon-singleton/type7-v1" as const;
export const DEE659_INTERIM_POSITION_POLICY_ID =
  "fixed-horizon-qualification/unrepresentable-normal-exits-disabled/v1" as const;
export const DEE659_SLICE_ALLOCATION_POLICY =
  "explicit-weights-last-slice-remainder-no-top-up/v1" as const;
export const DEE659_ROUNDING_POLICY = "scale8-floor-step-truncate-half-up/v1" as const;

export type Dee659ReasonCode =
  | "ANCHOR_AUTHORITY_INVALID"
  | "ANCHOR_AUTHORITY_MISMATCH"
  | "ANCHOR_AUTHORITY_NOT_VERIFIED"
  | "CASH_AUTHORITY_INVALID"
  | "CASH_AUTHORITY_NOT_VERIFIED"
  | "COST_AUTHORITY_MISSING"
  | "ECONOMIC_SIZE_SET_INVALID"
  | "ECONOMIC_SIZE_AUTHORITY_NOT_VERIFIED"
  | "EXECUTABLE_POLICY_INVALID"
  | "EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED"
  | "FORECAST_CONTRACT_MISMATCH"
  | "FORECAST_SAMPLE_INVALID"
  | "INSTRUMENT_AUTHORITY_MISMATCH"
  | "LIQUIDITY_CAPACITY_AUTHORITY_MISSING"
  | "NO_ENTRY_FILL"
  | "POLICY_DIGEST_MISMATCH"
  | "POST_EXIT_RESIDUAL_INVENTORY"
  | "QUANTITY_AUTHORITY_MISSING"
  | "SIZE_SET_DIGEST_MISMATCH";

export type Dee659AuthorityBindingV1 = {
  organizationId: string;
  accountId: string;
  venue: string;
  market: "SPOT";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  instrumentIdentityDigestHex: string;
};

export type ExecOpp13dForecastIdentityV1 = {
  targetRoleId: typeof TARGET_ROLE_EXECUTION;
  representationKind: typeof REPRESENTATION_SAMPLE_ENSEMBLE;
  componentLayoutVersion: typeof COMPONENT_LAYOUT_VERSION;
  outcomeVersion: typeof OUTCOME_VERSION;
  modelTransformVersion: typeof MODEL_TRANSFORM_VERSION;
  primaryHorizonMinutes: 30 | 60;
  interimPositionPolicyId: typeof DEE659_INTERIM_POSITION_POLICY_ID;
};

export type DecisionEvaluationContractV1 = {
  contractId: typeof DEE659_DECISION_EVALUATION_CONTRACT_ID;
  schemaVersion: typeof DEE659_DECISION_ECONOMICS_CONTRACT_VERSION;
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

export type VerifiedDecisionEconomicAuthorityV1 = {
  schemaVersion: typeof DEE659_AUTHORITY_VERIFICATION_SCHEMA_VERSION;
  verified: boolean;
  purpose:
    | "ANCHOR_QUALIFICATION"
    | "EXECUTABLE_POLICY_PREREGISTRATION"
    | "ECONOMIC_SIZE_AUTHORIZATION"
    | "CASH_SNAPSHOT_AUTHORIZATION";
  organizationId: string;
  accountId: string;
  instrumentIdentityDigestHex: string;
  subjectContentDigestHex: string;
  verificationReceiptDigestHex: string;
};

export type ExecutionPayoffAuthorityVerificationV1 = {
  anchor: VerifiedDecisionEconomicAuthorityV1;
  executablePolicy: VerifiedDecisionEconomicAuthorityV1;
  economicSize: VerifiedDecisionEconomicAuthorityV1;
  cash: VerifiedDecisionEconomicAuthorityV1;
};

export function isDee659DigestHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function computeDee659InstrumentIdentityDigestV1(
  input: Omit<Dee659AuthorityBindingV1, "instrumentIdentityDigestHex">,
): string {
  return computeStableJsonDigest({ schemaVersion: "dee659-authority-binding/v1", ...input });
}

function bindingPayload(
  input: Dee659AuthorityBindingV1,
): Omit<Dee659AuthorityBindingV1, "instrumentIdentityDigestHex"> {
  return {
    organizationId: input.organizationId,
    accountId: input.accountId,
    venue: input.venue,
    market: input.market,
    symbol: input.symbol,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
  };
}

export function validateDee659AuthorityBindingV1(
  input: Dee659AuthorityBindingV1,
): readonly string[] {
  const errors: string[] = [];
  if (input.organizationId.trim() === "") errors.push("organizationId:EMPTY");
  if (input.accountId.trim() === "") errors.push("accountId:EMPTY");
  if (input.venue.trim() === "") errors.push("venue:EMPTY");
  if (input.market !== "SPOT") errors.push("market:MISMATCH");
  if (input.symbol.trim() === "") errors.push("symbol:EMPTY");
  if (input.baseAsset.trim() === "") errors.push("baseAsset:EMPTY");
  if (input.quoteAsset !== "USDT") errors.push("quoteAsset:MISMATCH");
  if (input.symbol !== `${input.baseAsset}${input.quoteAsset}`) {
    errors.push("symbol:BASE_QUOTE_MISMATCH");
  }
  if (!isDee659DigestHex(input.instrumentIdentityDigestHex)) {
    errors.push("instrumentIdentityDigestHex:INVALID_DIGEST");
  } else if (
    computeDee659InstrumentIdentityDigestV1(bindingPayload(input)) !==
    input.instrumentIdentityDigestHex
  ) {
    errors.push("instrumentIdentityDigestHex:MISMATCH");
  }
  return errors;
}

export function sameDee659AuthorityBindingV1(
  expected: Dee659AuthorityBindingV1,
  actual: Dee659AuthorityBindingV1,
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

export function validateVerifiedDecisionEconomicAuthorityV1(input: {
  verification: VerifiedDecisionEconomicAuthorityV1;
  purpose: VerifiedDecisionEconomicAuthorityV1["purpose"];
  subjectContentDigestHex: string;
  authority: Dee659AuthorityBindingV1;
}): readonly string[] {
  const errors: string[] = [];
  const verification = input.verification;
  if (verification.schemaVersion !== DEE659_AUTHORITY_VERIFICATION_SCHEMA_VERSION) {
    errors.push("schemaVersion:MISMATCH");
  }
  if (!verification.verified) errors.push("verified:FALSE");
  if (verification.purpose !== input.purpose) errors.push("purpose:MISMATCH");
  if (verification.organizationId !== input.authority.organizationId) {
    errors.push("organizationId:MISMATCH");
  }
  if (verification.accountId !== input.authority.accountId) errors.push("accountId:MISMATCH");
  if (verification.instrumentIdentityDigestHex !== input.authority.instrumentIdentityDigestHex) {
    errors.push("instrumentIdentityDigestHex:MISMATCH");
  }
  if (
    !isDee659DigestHex(verification.subjectContentDigestHex) ||
    verification.subjectContentDigestHex !== input.subjectContentDigestHex
  ) {
    errors.push("subjectContentDigestHex:MISMATCH");
  }
  if (!isDee659DigestHex(verification.verificationReceiptDigestHex)) {
    errors.push("verificationReceiptDigestHex:INVALID_DIGEST");
  }
  return errors;
}

const REGISTERED_CONTRACT: DecisionEvaluationContractV1 = {
  contractId: DEE659_DECISION_EVALUATION_CONTRACT_ID,
  schemaVersion: DEE659_DECISION_ECONOMICS_CONTRACT_VERSION,
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

function registryKey(identity: ExecOpp13dForecastIdentityV1): string {
  return canonicalJsonString(identity);
}

const CLOSED_REGISTRY = new Map<string, DecisionEvaluationContractV1>(
  ([30, 60] as const).map((primaryHorizonMinutes) => [
    registryKey({
      targetRoleId: TARGET_ROLE_EXECUTION,
      representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
      componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
      outcomeVersion: OUTCOME_VERSION,
      modelTransformVersion: MODEL_TRANSFORM_VERSION,
      primaryHorizonMinutes,
      interimPositionPolicyId: DEE659_INTERIM_POSITION_POLICY_ID,
    }),
    REGISTERED_CONTRACT,
  ]),
);

export function resolveDecisionEvaluationContractV1(
  identity: ExecOpp13dForecastIdentityV1,
): DecisionEvaluationRegistryResolution {
  const contract = CLOSED_REGISTRY.get(registryKey(identity));
  return contract
    ? { ok: true, contract }
    : { ok: false, reasonCode: "FORECAST_CONTRACT_MISMATCH" };
}
