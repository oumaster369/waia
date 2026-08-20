import { describe, expect, it } from "vitest";

import {
  createDee649ExecutablePolicyInstanceV1,
  createForecastAnchorPriceAuthorityV1,
  createSingletonEconomicSizeSetV1,
  DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION,
  DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION,
  DEE649_INTERIM_POSITION_POLICY_ID,
  DEE649_ROUNDING_POLICY,
  DEE649_SLICE_ALLOCATION_POLICY,
  resolveDecisionEvaluationContractV1,
  validateDee649ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
} from "@/lib/trader/intelligence/decision-economics/dee649-contract-v1";
import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);

function policyDraft() {
  return {
    schemaVersion: DEE649_EXECUTABLE_POLICY_SCHEMA_VERSION,
    policyInstanceId: "development-candidate/test-only",
    interimPositionPolicyId: DEE649_INTERIM_POSITION_POLICY_ID,
    sliceAllocationPolicy: DEE649_SLICE_ALLOCATION_POLICY,
    roundingPolicy: DEE649_ROUNDING_POLICY,
    entrySliceOffsets: [1, 2, 3] as const,
    entrySliceWeights: ["0.25", "0.25", "0.5"],
    exitSliceOffsetsAfterHorizon: [1, 2] as const,
    exitSliceWeights: ["0.5", "0.5"],
    participationCapFraction: "0.1",
    quantityStep: "0.0001",
    minimumQuantity: "0.0001",
    minimumNotionalUsdt: "1",
    entryCosts: {
      feeBps: "1",
      spreadBps: "2",
      impactBps: "3",
      slippageBps: "4",
      conservativeStressBps: "5",
    },
    exitCosts: {
      feeBps: "6",
      spreadBps: "7",
      impactBps: "8",
      slippageBps: "9",
      conservativeStressBps: "10",
    },
    partialFillPolicy: "EXPLICIT_CAPACITY_BOUNDED_NO_TOP_UP" as const,
    unfilledEntryPolicy: "RETAIN_AS_CASH" as const,
    postExitResidualPolicy: "SIZE_ECONOMICALLY_INADMISSIBLE" as const,
    preregistrationReceiptDigestHex: DIGEST_A,
    costAuthorityReceiptDigestHex: DIGEST_B,
    liquidityCapacityAuthorityReceiptDigestHex: DIGEST_C,
    quantityRulesAuthorityReceiptDigestHex: DIGEST_D,
  };
}

describe("DEE-649 C1 contract and closed registry", () => {
  it("dispatches only the exact registered Forecast-family identity", () => {
    const identity = {
      targetRoleId: TARGET_ROLE_EXECUTION,
      representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
      componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
      outcomeVersion: OUTCOME_VERSION,
      modelTransformVersion: MODEL_TRANSFORM_VERSION,
      primaryHorizonMinutes: 30 as const,
      interimPositionPolicyId: DEE649_INTERIM_POSITION_POLICY_ID,
    };
    const resolved = resolveDecisionEvaluationContractV1(identity);
    expect(resolved.ok).toBe(true);

    const mismatch = resolveDecisionEvaluationContractV1({
      ...identity,
      modelTransformVersion: "unregistered-family/v1",
    } as unknown as typeof identity);
    expect(mismatch).toEqual({ ok: false, reasonCode: "FORECAST_CONTRACT_MISMATCH" });
  });

  it("seals an exact anchor authority and rejects a Forecast/qualified-close mismatch", () => {
    const authority = createForecastAnchorPriceAuthorityV1({
      schemaVersion: DEE649_ANCHOR_AUTHORITY_SCHEMA_VERSION,
      forecastAnchorClosedBarEpochMs: 1_725_000_000_000,
      qualifiedAnchorClosedBarEpochMs: 1_725_000_000_000,
      forecastAnchorClosePrice: "50000",
      qualifiedAnchorClosePrice: "50000",
      qualificationReceiptDigestHex: DIGEST_A,
    });
    expect(authority.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);

    expect(() =>
      createForecastAnchorPriceAuthorityV1({
        ...authority,
        qualifiedAnchorClosePrice: "50000.01",
        contentDigestHex: undefined,
      } as never),
    ).toThrow(/MISMATCH/);
  });

  it("requires a complete preregistered policy instance and detects digest changes", () => {
    const policy = createDee649ExecutablePolicyInstanceV1(policyDraft());
    expect(policy.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(validateDee649ExecutablePolicyInstanceV1(policy)).toEqual([]);

    expect(
      validateDee649ExecutablePolicyInstanceV1({
        ...policy,
        participationCapFraction: "0.2",
      }),
    ).toContain("contentDigestHex:MISMATCH");

    expect(() =>
      createDee649ExecutablePolicyInstanceV1({
        ...policyDraft(),
        costAuthorityReceiptDigestHex: "",
      }),
    ).toThrow(/costAuthorityReceiptDigestHex/);
  });

  it("requires contiguous 1..3 slice prefixes with explicit weights summing to one", () => {
    expect(() =>
      createDee649ExecutablePolicyInstanceV1({
        ...policyDraft(),
        entrySliceOffsets: [1, 3] as never,
        entrySliceWeights: ["0.5", "0.5"],
      }),
    ).toThrow(/OFFSETS_MUST_BE_CONTIGUOUS_PREFIX/);

    expect(() =>
      createDee649ExecutablePolicyInstanceV1({
        ...policyDraft(),
        exitSliceWeights: ["0.4", "0.4"],
      }),
    ).toThrow(/WEIGHTS_MUST_SUM_TO_ONE/);
  });

  it("seals exactly one Human-authorized quantity and rejects invented members", () => {
    const singleton = createSingletonEconomicSizeSetV1({
      sizeSetId: "human-exact-size/test-only",
      exactQuantity: "0.2",
      authorityReceiptDigestHex: DIGEST_A,
    });
    expect(singleton.exactQuantities).toEqual(["0.2"]);
    expect(validateEconomicAdmissibleSizeSetV1(singleton)).toEqual([]);

    expect(
      validateEconomicAdmissibleSizeSetV1({
        ...singleton,
        exactQuantities: ["0.1", "0.2"] as never,
      }),
    ).toContain("exactQuantities:NOT_SINGLETON");
  });
});
