import { describe, expect, it } from "vitest";

import {
  createCashEconomicAuthorityV1,
  createDee659ExecutablePolicyInstanceV1,
  createForecastAnchorPriceAuthorityV1,
  validateDee659ExecutablePolicyInstanceV1,
  validateEconomicAdmissibleSizeSetV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-authorities-v1";
import {
  DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
  resolveDecisionEvaluationContractV1,
  validateVerifiedDecisionEconomicAuthorityV1,
} from "@/lib/trader/intelligence/decision-economics/dee659-execution-payoff-contract-v1";
import { executionPayoffFunctionalV2 } from "@/lib/trader/intelligence/decision-economics/execution-payoff-functional-v2";
import { parseDecimal } from "@/lib/trader/risk/numeric";
import {
  DEE659_TEST_DIGEST_A,
  dee659Sample13d,
  dee659TestAnchor,
  dee659TestAuthorityBinding,
  dee659TestAuthorityVerification,
  dee659TestCash,
  dee659TestForecastIdentity,
  dee659TestPolicy,
  dee659TestSize,
} from "@/tests/unit/helpers/dee659-execution-payoff-fixtures";

type EvaluationInput = Parameters<typeof executionPayoffFunctionalV2>[0];

function evaluate(overrides: Partial<EvaluationInput> = {}) {
  const anchorAuthority = overrides.anchorAuthority ?? dee659TestAnchor();
  const policy = overrides.policy ?? dee659TestPolicy();
  const economicSizeSet = overrides.economicSizeSet ?? dee659TestSize();
  const cashAuthority = overrides.cashAuthority ?? dee659TestCash();
  return executionPayoffFunctionalV2({
    sample13d: dee659Sample13d(),
    forecastIdentity: dee659TestForecastIdentity(),
    anchorAuthority,
    policy,
    economicSizeSet,
    cashAuthority,
    authorityVerification:
      overrides.authorityVerification ??
      dee659TestAuthorityVerification({
        anchor: anchorAuthority,
        policy,
        size: economicSizeSet,
        cash: cashAuthority,
      }),
    ...overrides,
  });
}

describe("DEE-659 executable economic contract", () => {
  it("dispatches only the exact registered Forecast-family identity", () => {
    const identity = dee659TestForecastIdentity(30);
    expect(resolveDecisionEvaluationContractV1(identity)).toMatchObject({ ok: true });
    expect(
      resolveDecisionEvaluationContractV1({
        ...identity,
        modelTransformVersion: "unregistered-family/v1",
      } as unknown as typeof identity),
    ).toEqual({ ok: false, reasonCode: "FORECAST_CONTRACT_MISMATCH" });
    expect(
      evaluate({
        forecastIdentity: {
          ...identity,
          primaryHorizonMinutes: 45,
        } as unknown as typeof identity,
      }).reasonCodes,
    ).toEqual(["FORECAST_CONTRACT_MISMATCH"]);
  });

  it("content-addresses the exact anchor and rejects a qualified-close mismatch", () => {
    const authority = dee659TestAnchor("50000");
    expect(authority.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      createForecastAnchorPriceAuthorityV1({
        ...dee659TestAuthorityBinding(),
        schemaVersion: DEE659_ANCHOR_AUTHORITY_SCHEMA_VERSION,
        forecastAnchorClosedBarEpochMs: authority.forecastAnchorClosedBarEpochMs,
        qualifiedAnchorClosedBarEpochMs: authority.qualifiedAnchorClosedBarEpochMs,
        forecastAnchorClosePrice: "50000",
        qualifiedAnchorClosePrice: "50000.01",
        qualificationReceiptDigestHex: DEE659_TEST_DIGEST_A,
      }),
    ).toThrow(/MISMATCH/);
  });

  it("requires complete policy authorities, exact slices, and a stable digest", () => {
    const policy = dee659TestPolicy();
    expect(validateDee659ExecutablePolicyInstanceV1(policy)).toEqual([]);
    expect(
      validateDee659ExecutablePolicyInstanceV1({
        ...policy,
        participationCapFraction: "0.2",
      }),
    ).toContain("contentDigestHex:MISMATCH");
    expect(() =>
      createDee659ExecutablePolicyInstanceV1({
        ...policy,
        costAuthorityReceiptDigestHex: "",
      }),
    ).toThrow(/costAuthorityReceiptDigestHex/);
    expect(() => dee659TestPolicy({ entrySliceOffsets: [1, 3] as never })).toThrow(
      /OFFSETS_MUST_BE_CONTIGUOUS_PREFIX/,
    );
    expect(() => dee659TestPolicy({ exitSliceWeights: ["0.4", "0.4"] })).toThrow(
      /WEIGHTS_MUST_SUM_TO_ONE/,
    );
  });

  it("seals one exact quantity and an explicit non-negative CASH snapshot", () => {
    const size = dee659TestSize("0.2");
    const cash = dee659TestCash("123.45000000");
    expect(size.exactQuantities).toEqual(["0.2"]);
    expect(validateEconomicAdmissibleSizeSetV1(size)).toEqual([]);
    expect(cash.availableCashUsdt).toBe("123.45000000");
    expect(
      validateEconomicAdmissibleSizeSetV1({
        ...size,
        exactQuantities: ["0.1", "0.2"] as never,
      }),
    ).toContain("exactQuantities:NOT_SINGLETON");
    expect(() =>
      createCashEconomicAuthorityV1({
        ...dee659TestAuthorityBinding(),
        availableCashUsdt: "-0.01",
        authorityReceiptDigestHex: DEE659_TEST_DIGEST_A,
      }),
    ).toThrow(/availableCashUsdt/);
  });

  it("does not treat raw digests as verified subject-bound authority", () => {
    const anchor = dee659TestAnchor();
    const policy = dee659TestPolicy();
    const size = dee659TestSize();
    const cash = dee659TestCash();
    const verification = dee659TestAuthorityVerification({ anchor, policy, size, cash });
    expect(
      validateVerifiedDecisionEconomicAuthorityV1({
        verification: verification.anchor,
        purpose: "ANCHOR_QUALIFICATION",
        subjectContentDigestHex: anchor.contentDigestHex,
        authority: anchor,
      }),
    ).toEqual([]);
    expect(
      evaluate({
        anchorAuthority: anchor,
        policy,
        economicSizeSet: size,
        cashAuthority: cash,
        authorityVerification: {
          ...verification,
          anchor: { ...verification.anchor, verified: false },
        },
      }).reasonCodes,
    ).toEqual(["ANCHOR_AUTHORITY_NOT_VERIFIED"]);
    expect(
      evaluate({
        authorityVerification: {
          ...verification,
          executablePolicy: {
            ...verification.executablePolicy,
            subjectContentDigestHex: "f".repeat(64),
          },
        },
      }).reasonCodes,
    ).toEqual(["EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED"]);
  });

  it("rejects a valid but cross-account economic authority bundle", () => {
    const otherBinding = dee659TestAuthorityBinding({
      accountId: "00000000-0000-4000-8000-000000000099",
    });
    const cashAuthority = createCashEconomicAuthorityV1({
      ...otherBinding,
      availableCashUsdt: "200",
      authorityReceiptDigestHex: DEE659_TEST_DIGEST_A,
    });
    expect(evaluate({ cashAuthority }).reasonCodes).toEqual(["INSTRUMENT_AUTHORITY_MISMATCH"]);
  });
});

describe("DEE-659 ExecutionPayoffFunctionalV2", () => {
  it("preserves negative outcomes and applies separate conservative stress", () => {
    const result = evaluate({
      policy: dee659TestPolicy({
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
      }),
      sample13d: dee659Sample13d({ exitPrices: [90, 90, 90] }),
    });
    expect(result.status).toBe("ECONOMICALLY_ADMISSIBLE");
    expect(result.basePayoffUsdt).toBe("-10.37");
    expect(result.lowerPayoffUsdt).toBe("-10.51");
    expect(result.lowerPayoff).toBeLessThan(result.basePayoff);
    expect(result.entrySlices[0]?.costs).toMatchObject({
      feeUsdt: expect.any(String),
      spreadUsdt: expect.any(String),
      impactUsdt: expect.any(String),
      slippageUsdt: expect.any(String),
      conservativeStressUsdt: expect.any(String),
    });
  });

  it("proves lower <= base across positive, flat, and losing boundary scenarios", () => {
    for (const entryPrice of [80, 100, 120]) {
      for (const exitPrice of [80, 100, 120]) {
        const result = evaluate({
          policy: dee659TestPolicy({
            entryCosts: {
              feeBps: "1",
              spreadBps: "1",
              impactBps: "1",
              slippageBps: "1",
              conservativeStressBps: "2",
            },
            exitCosts: {
              feeBps: "1",
              spreadBps: "1",
              impactBps: "1",
              slippageBps: "1",
              conservativeStressBps: "2",
            },
          }),
          sample13d: dee659Sample13d({
            entryPrices: [entryPrice, entryPrice, entryPrice],
            exitPrices: [exitPrice, exitPrice, exitPrice],
          }),
        });
        expect(parseDecimal(result.lowerPayoffUsdt)).toBeLessThanOrEqual(
          parseDecimal(result.basePayoffUsdt),
        );
        if (parseDecimal(result.basePayoffUsdt) < 0n) {
          expect(parseDecimal(result.lowerPayoffUsdt)).toBeLessThan(0n);
        }
      }
    }
  });

  it("rounds each per-side cost component HALF_UP at scale-8", () => {
    const oneBps = {
      feeBps: "1",
      spreadBps: "0",
      impactBps: "0",
      slippageBps: "0",
      conservativeStressBps: "0",
    };
    const policy = dee659TestPolicy({
      entrySliceOffsets: [1],
      entrySliceWeights: ["1"],
      exitSliceOffsetsAfterHorizon: [1],
      exitSliceWeights: ["1"],
      participationCapFraction: "1",
      quantityStep: "0.00000001",
      minimumQuantity: "0.00000001",
      minimumNotionalUsdt: "0",
      entryCosts: oneBps,
      exitCosts: oneBps,
    });
    const result = evaluate({ policy, economicSizeSet: dee659TestSize("0.0000005") });
    expect(result.entrySlices[0]?.costs.feeUsdt).toBe("0.00000001");
    expect(result.exitSlices[0]?.costs.feeUsdt).toBe("0.00000001");
    expect(result.basePayoffUsdt).toBe("-0.00000002");
  });

  it("retains underfilled entry CASH and never tops up later slices", () => {
    const result = evaluate({
      sample13d: dee659Sample13d({ entryVolumes: [2, 100, 100] }),
    });
    expect(result.entrySlices.map((slice) => slice.targetQuantity)).toEqual(["0.5", "0.5"]);
    expect(result.entrySlices.map((slice) => slice.filledQuantity)).toEqual(["0.2", "0.5"]);
    expect(result.filledEntryQuantity).toBe("0.7");
    expect(result.unfilledEntryQuantityRetainedAsCash).toBe("0.3");
  });

  it("limits entries by sealed CASH and floors quantities to the sealed step", () => {
    const cashLimited = evaluate({ cashAuthority: dee659TestCash("60") });
    expect(cashLimited.entrySlices.map((slice) => slice.filledQuantity)).toEqual(["0.5", "0.1"]);
    const stepped = evaluate({
      policy: dee659TestPolicy({
        entrySliceWeights: ["0.33", "0.67"],
        exitSliceWeights: ["0.33", "0.67"],
      }),
      sample13d: dee659Sample13d({ entryVolumes: [3.9, 100, 100] }),
    });
    expect(stepped.entrySlices[0]).toMatchObject({
      targetQuantity: "0.3",
      capacityQuantity: "0.3",
      filledQuantity: "0.3",
    });
  });

  it("resolves no-fill to CASH and rejects post-exit residual inventory", () => {
    const noFill = evaluate({ policy: dee659TestPolicy({ minimumNotionalUsdt: "60" }) });
    expect(noFill.status).toBe("ECONOMICALLY_INADMISSIBLE");
    expect(noFill.reasonCodes).toEqual(["NO_ENTRY_FILL"]);
    expect(noFill.basePayoffUsdt).toBe("0");
    const residual = evaluate({
      sample13d: dee659Sample13d({ exitVolumes: [2, 2, 100] }),
    });
    expect(residual.reasonCodes).toEqual(["POST_EXIT_RESIDUAL_INVENTORY"]);
    expect(residual.residualInventoryQuantity).toBe("0.6");
  });

  it("uses selected price/capacity components while R_h remains only a trigger mark", () => {
    const baseline = evaluate();
    expect(
      evaluate({ sample13d: dee659Sample13d({ exitPrices: [110, 100, 100] }) }).basePayoff,
    ).not.toBe(baseline.basePayoff);
    expect(
      evaluate({ sample13d: dee659Sample13d({ entryPrices: [100, 110, 100] }) }).basePayoff,
    ).not.toBe(baseline.basePayoff);
    expect(
      evaluate({ sample13d: dee659Sample13d({ entryVolumes: [2, 100, 100] }) }).filledEntryQuantity,
    ).not.toBe(baseline.filledEntryQuantity);
    expect(evaluate({ sample13d: dee659Sample13d({ exitVolumes: [100, 2, 100] }) }).status).toBe(
      "ECONOMICALLY_INADMISSIBLE",
    );
    const differentMark = evaluate({ sample13d: dee659Sample13d({ horizonPrice: 80 }) });
    expect(differentMark.basePayoff).toBe(baseline.basePayoff);
    expect(differentMark.horizonTriggerMarkPrice).toBe("80");
    expect(differentMark.contentDigestHex).not.toBe(baseline.contentDigestHex);
  });

  it("fails closed on malformed samples, missing authority, and off-step size", () => {
    const policy = dee659TestPolicy();
    expect(
      evaluate({
        policy: { ...policy, liquidityCapacityAuthorityReceiptDigestHex: "" },
      }).reasonCodes,
    ).toEqual(["LIQUIDITY_CAPACITY_AUTHORITY_MISSING"]);
    expect(evaluate({ sample13d: [0] }).reasonCodes).toEqual(["FORECAST_SAMPLE_INVALID"]);
    expect(evaluate({ economicSizeSet: dee659TestSize("0.15") }).reasonCodes).toEqual([
      "ECONOMIC_SIZE_SET_INVALID",
    ]);
  });

  it("is deterministic for identical sealed inputs", () => {
    expect(evaluate()).toEqual(evaluate());
  });
});
