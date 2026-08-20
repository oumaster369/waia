import { describe, expect, it } from "vitest";

import {
  computeExactDecisionEvRangeFromPayoffsV1,
  evaluateDecisionEconomicsV2,
  type DecisionEconomicEvaluationInputV2,
} from "@/lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2";
import { createSingletonEconomicSizeSetV1 } from "@/lib/trader/intelligence/decision-economics/dee649-contract-v1";
import {
  DEE649_TEST_DIGEST_A,
  DEE649_TEST_DIGEST_B,
  DEE649_TEST_DIGEST_D,
  dee649Sample13d,
  dee649TestAuthorityBinding,
  dee649TestAnchor,
  dee649TestForecast,
  dee649TestPolicy,
} from "@/tests/unit/helpers/dee649-decision-economics-fixtures";

function evaluationInput(
  overrides: Partial<DecisionEconomicEvaluationInputV2> = {},
): DecisionEconomicEvaluationInputV2 {
  const positiveSample = dee649Sample13d({ exitPrices: [110, 110, 110] });
  return {
    forecast: dee649TestForecast([
      [positiveSample, positiveSample],
      [positiveSample, positiveSample],
      [positiveSample, positiveSample],
    ]),
    anchorAuthority: dee649TestAnchor(),
    policy: dee649TestPolicy({
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
    economicSizeSet: createSingletonEconomicSizeSetV1({
      ...dee649TestAuthorityBinding(),
      sizeSetId: "human-exact-size/test-only",
      symbol: "BTCUSDT",
      unit: "BASE_ASSET_QUANTITY",
      exactQuantity: "1",
      authorityReceiptDigestHex: DEE649_TEST_DIGEST_D,
    }),
    cashAuthority: {
      ...dee649TestAuthorityBinding(),
      availableCashUsdt: "200",
      authorityReceiptDigestHex: DEE649_TEST_DIGEST_A,
    },
    authorityVerification: {
      forecastAuthorityVerified: true,
      anchorAuthorityVerified: true,
      executablePolicyAuthorityVerified: true,
      economicSizeAuthorityVerified: true,
      cashAuthorityVerified: true,
    },
    scientificAdmissionVerified: true,
    scientificAdmissionReceiptDigestHex: DEE649_TEST_DIGEST_B,
    ...overrides,
  };
}

describe("DEE-649 C3 closed Decision evaluator and WhyNotCashReceiptV2", () => {
  it("qualifies only the exact singleton when conservative EV beats CASH", () => {
    const input = evaluationInput();
    const result = evaluateDecisionEconomicsV2(input);

    expect(result.decisionActionable).toBe(true);
    expect(result.action).toBe("ENTER_LONG");
    expect(result.economicAdmissibleSizeSet).toBe(input.economicSizeSet);
    expect(result.evRange?.evLower).toBeGreaterThan(0);
    expect(result.receipt).toMatchObject({
      cashBaselineUsdt: "0",
      verdict: "DECISION_ACTIONABLE",
      evaluatedExactQuantity: "1",
      economicallyAdmissibleExactQuantities: ["1"],
      reasonCodes: [],
      executionPayoffFunctionalVersion: "execution-payoff-functional/v2",
      forecastComponentUse: {
        executableEntryReturnIndices: [0, 1],
        structuralHorizonTriggerReturnIndex: 3,
        executableExitReturnIndices: [4, 5],
        executableEntryVolumeIndices: [7, 8],
        executableExitVolumeIndices: [10, 11],
        unusedByPolicyIndices: [2, 6, 9, 12],
        horizonTriggerIsExecutableFillPrice: false,
      },
    });
    expect(result.receipt.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("selects CASH and preserves negative lower/base economics", () => {
    const negative = dee649Sample13d({ exitPrices: [80, 80, 80] });
    const base = evaluationInput();
    const result = evaluateDecisionEconomicsV2({
      ...base,
      forecast: dee649TestForecast([[[...negative]], [[...negative]]]),
    });

    expect(result.decisionActionable).toBe(false);
    expect(result.action).toBe("CASH");
    expect(result.economicAdmissibleSizeSet).toBeNull();
    expect(result.evRange?.evBase).toBeLessThan(0);
    expect(result.evRange?.evLower).toBeLessThan(result.evRange!.evBase);
    expect(result.receipt.reasonCodes).toContain("EV_LOWER_NON_POSITIVE");
  });

  it("fails the size closed when any scenario leaves residual inventory", () => {
    const residual = dee649Sample13d({
      exitPrices: [110, 110, 110],
      exitVolumes: [2, 2, 100],
    });
    const base = evaluationInput();
    const result = evaluateDecisionEconomicsV2({
      ...base,
      forecast: dee649TestForecast([[residual]]),
    });

    expect(result.evRange).toBeNull();
    expect(result.economicAdmissibleSizeSet).toBeNull();
    expect(result.receipt.reasonCodes).toContain("POST_EXIT_RESIDUAL_INVENTORY");
    expect(result.receipt.scenarioResidualInventoryCount).toBe(1);
  });

  it("fails closed on an unknown Forecast family instead of choosing an evaluator ad hoc", () => {
    const base = evaluationInput();
    const result = evaluateDecisionEconomicsV2({
      ...base,
      forecast: {
        ...base.forecast,
        identity: {
          ...base.forecast.identity,
          modelTransformVersion: "unknown-family/v1",
        } as unknown as typeof base.forecast.identity,
      },
    });

    expect(result.evRange).toBeNull();
    expect(result.receipt.decisionEvaluationContractId).toBeNull();
    expect(result.receipt.reasonCodes).toContain("FORECAST_CONTRACT_MISMATCH");
  });

  it("requires all sealed authorities and verified scientific admission", () => {
    const base = evaluationInput();
    for (const [field, reason] of [
      ["costAuthorityReceiptDigestHex", "COST_AUTHORITY_MISSING"],
      ["liquidityCapacityAuthorityReceiptDigestHex", "LIQUIDITY_CAPACITY_AUTHORITY_MISSING"],
      ["quantityRulesAuthorityReceiptDigestHex", "QUANTITY_AUTHORITY_MISSING"],
    ] as const) {
      const result = evaluateDecisionEconomicsV2({
        ...base,
        policy: { ...base.policy, [field]: "" },
      });
      expect(result.receipt.reasonCodes).toContain(reason);
    }

    const unverified = evaluateDecisionEconomicsV2({
      ...base,
      scientificAdmissionVerified: false,
      scientificAdmissionReceiptDigestHex: null,
    });
    expect(unverified.receipt.reasonCodes).toContain("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");

    for (const [field, reason] of [
      ["forecastAuthorityVerified", "FORECAST_AUTHORITY_NOT_VERIFIED"],
      ["anchorAuthorityVerified", "ANCHOR_AUTHORITY_NOT_VERIFIED"],
      ["executablePolicyAuthorityVerified", "EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED"],
      ["economicSizeAuthorityVerified", "ECONOMIC_SIZE_AUTHORITY_NOT_VERIFIED"],
      ["cashAuthorityVerified", "CASH_AUTHORITY_NOT_VERIFIED"],
    ] as const) {
      const result = evaluateDecisionEconomicsV2({
        ...base,
        authorityVerification: { ...base.authorityVerification, [field]: false },
      });
      expect(result.receipt.reasonCodes).toContain(reason);
      expect(result.decisionActionable).toBe(false);
    }
  });

  it("recomputes the sealed Forecast distribution and binds it to the issued anchor", () => {
    const base = evaluationInput();
    expect(base.forecast.forecastGenerationIdentityDigestHex).not.toBe(
      base.forecast.predictivePackageGenerationIdentityDigestHex,
    );
    const tampered = base.forecast.replicaSamples.map((replica) =>
      replica.map((sample) => sample.map((value, index) => (index === 4 ? value + 0.01 : value))),
    );
    const sampleMismatch = evaluateDecisionEconomicsV2({
      ...base,
      forecast: { ...base.forecast, replicaSamples: tampered },
    });
    expect(sampleMismatch.receipt.reasonCodes).toContain("FORECAST_DISTRIBUTION_DIGEST_MISMATCH");

    const generationMismatch = evaluateDecisionEconomicsV2({
      ...base,
      forecast: { ...base.forecast, forecastGenerationIdentityDigestHex: DEE649_TEST_DIGEST_A },
    });
    expect(generationMismatch.receipt.reasonCodes).toContain(
      "FORECAST_DISTRIBUTION_DIGEST_MISMATCH",
    );

    const contentMismatch = evaluateDecisionEconomicsV2({
      ...base,
      forecast: { ...base.forecast, forecastContentDigestHex: DEE649_TEST_DIGEST_A },
    });
    expect(contentMismatch.receipt.reasonCodes).toContain("FORECAST_CONTENT_DIGEST_MISMATCH");

    const otherAnchor = dee649TestAnchor("101");
    const anchorMismatch = evaluateDecisionEconomicsV2({ ...base, anchorAuthority: otherAnchor });
    expect(anchorMismatch.receipt.reasonCodes).toContain("ANCHOR_AUTHORITY_MISMATCH");
  });

  it("uses only the scale-8 sample semantics sealed by the Forecast digest", () => {
    const baseline = dee649Sample13d();
    const subScale = baseline.map((value, index) => (index === 4 ? 4e-9 : value));
    const baselineForecast = dee649TestForecast([[baseline]]);
    const subScaleForecast = dee649TestForecast([[subScale]]);
    expect(subScaleForecast.distributionSemanticDigestHex).toBe(
      baselineForecast.distributionSemanticDigestHex,
    );

    const base = evaluationInput();
    const first = evaluateDecisionEconomicsV2({ ...base, forecast: baselineForecast });
    const second = evaluateDecisionEconomicsV2({ ...base, forecast: subScaleForecast });
    expect(second.scenarioResults).toEqual(first.scenarioResults);
    expect(second.receipt.evLowerScale8).toBe(first.receipt.evLowerScale8);
  });

  it("keeps the CASH threshold exact when decimal payoffs sum to zero", () => {
    const exact = computeExactDecisionEvRangeFromPayoffsV1({
      baseReplicaPayoffsScale8: [
        ["0.1", "0.2", "-0.3"],
        ["0.1", "0.2", "-0.3"],
      ],
      lowerReplicaPayoffsScale8: [
        ["0.1", "0.2", "-0.3"],
        ["0.1", "0.2", "-0.3"],
      ],
      scientificAdmissionVerified: true,
    });
    expect(exact.evRange.evLowerScale8).toBe("0.00000000");
    expect(exact.evRange.decisionActionable).toBe(false);
    expect(exact.evRange.reasonCodes).toContain("EV_LOWER_NON_POSITIVE");
  });

  it("binds Forecast, anchor, policy and size authorities to one SPOT instrument", () => {
    const base = evaluationInput();
    const mismatchedSizeSet = createSingletonEconomicSizeSetV1({
      ...dee649TestAuthorityBinding({ symbol: "ETHUSDT", baseAsset: "ETH" }),
      sizeSetId: "human-exact-size/wrong-symbol-test-only",
      symbol: "ETHUSDT",
      unit: "BASE_ASSET_QUANTITY",
      exactQuantity: "1",
      authorityReceiptDigestHex: DEE649_TEST_DIGEST_D,
    });
    const result = evaluateDecisionEconomicsV2({ ...base, economicSizeSet: mismatchedSizeSet });

    expect(result.receipt.reasonCodes).toContain("INSTRUMENT_AUTHORITY_MISMATCH");
    expect(result.economicAdmissibleSizeSet).toBeNull();

    const otherAccountCash = {
      ...base.cashAuthority,
      ...dee649TestAuthorityBinding({
        accountId: "00000000-0000-4000-8000-000000000099",
      }),
    };
    const accountMismatch = evaluateDecisionEconomicsV2({
      ...base,
      cashAuthority: otherAccountCash,
    });
    expect(accountMismatch.receipt.reasonCodes).toContain("INSTRUMENT_AUTHORITY_MISMATCH");

    const baseAssetMismatch = evaluateDecisionEconomicsV2({
      ...base,
      policy: { ...base.policy, baseAsset: "ETH" },
    });
    expect(baseAssetMismatch.receipt.reasonCodes).toContain("INSTRUMENT_AUTHORITY_MISMATCH");
  });

  it("turns malformed runtime DTOs into a deterministic NON_ACTIONABLE receipt", () => {
    const malformed = {
      ...evaluationInput(),
      policy: { ...evaluationInput().policy, entryCosts: undefined },
    } as unknown as DecisionEconomicEvaluationInputV2;
    expect(() => evaluateDecisionEconomicsV2(malformed)).not.toThrow();
    expect(evaluateDecisionEconomicsV2(malformed).receipt.reasonCodes).toContain(
      "EVALUATION_INPUT_MALFORMED",
    );
  });

  it("is deterministic, causally sensitive, and ignores legacy Strategy diagnostics", () => {
    const input = evaluationInput();
    const first = evaluateDecisionEconomicsV2(input);
    const replay = evaluateDecisionEconomicsV2(input);
    const withLegacyNoise = evaluateDecisionEconomicsV2({
      ...input,
      legacyStrategyDiagnostics: {
        legacyDiagnosticConfidence: 0.999,
        legacyDiagnosticExpectedEdge: -999,
        legacyDiagnosticMaxRisk: 999,
      },
    });
    const changedPolicy = evaluateDecisionEconomicsV2({
      ...input,
      policy: dee649TestPolicy({
        entryCosts: {
          ...input.policy.entryCosts,
          feeBps: "2",
        },
        exitCosts: input.policy.exitCosts,
      }),
    });

    expect(replay).toEqual(first);
    expect(withLegacyNoise).toEqual(first);
    expect(changedPolicy.receipt.contentDigestHex).not.toBe(first.receipt.contentDigestHex);
  });

  it("property-checks scenario-wise lower <= base across gains and losses", () => {
    for (let price = 70; price <= 130; price += 3) {
      const sample = dee649Sample13d({ exitPrices: [price, price, price] });
      const base = evaluationInput();
      const result = evaluateDecisionEconomicsV2({
        ...base,
        forecast: dee649TestForecast([[sample]]),
      });
      for (const scenario of result.scenarioResults.flat()) {
        expect(scenario.lowerPayoff).toBeLessThanOrEqual(scenario.basePayoff);
      }
    }
  });
});
