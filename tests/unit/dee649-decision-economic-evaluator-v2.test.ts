import { describe, expect, it } from "vitest";

import {
  evaluateDecisionEconomicsV2,
  type DecisionEconomicEvaluationInputV2,
} from "@/lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2";
import {
  createSingletonEconomicSizeSetV1,
  DEE649_INTERIM_POSITION_POLICY_ID,
} from "@/lib/trader/intelligence/decision-economics/dee649-contract-v1";
import {
  COMPONENT_LAYOUT_VERSION,
  MODEL_TRANSFORM_VERSION,
  REPRESENTATION_SAMPLE_ENSEMBLE,
  TARGET_ROLE_EXECUTION,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import {
  DEE649_TEST_DIGEST_A,
  DEE649_TEST_DIGEST_B,
  DEE649_TEST_DIGEST_C,
  DEE649_TEST_DIGEST_D,
  dee649Sample13d,
  dee649TestAnchor,
  dee649TestPolicy,
} from "@/tests/unit/helpers/dee649-decision-economics-fixtures";

function evaluationInput(
  overrides: Partial<DecisionEconomicEvaluationInputV2> = {},
): DecisionEconomicEvaluationInputV2 {
  const positiveSample = dee649Sample13d({ exitPrices: [110, 110, 110] });
  return {
    forecast: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      forecastId: "00000000-0000-4000-8000-000000000002",
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      identity: {
        targetRoleId: TARGET_ROLE_EXECUTION,
        representationKind: REPRESENTATION_SAMPLE_ENSEMBLE,
        componentLayoutVersion: COMPONENT_LAYOUT_VERSION,
        outcomeVersion: OUTCOME_VERSION,
        modelTransformVersion: MODEL_TRANSFORM_VERSION,
        primaryHorizonMinutes: 30,
        interimPositionPolicyId: DEE649_INTERIM_POSITION_POLICY_ID,
      },
      predictivePackageContentDigestHex: DEE649_TEST_DIGEST_A,
      predictivePackageGenerationIdentityDigestHex: DEE649_TEST_DIGEST_B,
      distributionSemanticDigestHex: DEE649_TEST_DIGEST_C,
      replicaSamples: [
        [positiveSample, positiveSample],
        [positiveSample, positiveSample],
        [positiveSample, positiveSample],
      ],
    },
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
      sizeSetId: "human-exact-size/test-only",
      symbol: "BTCUSDT",
      unit: "BASE_ASSET_QUANTITY",
      exactQuantity: "1",
      authorityReceiptDigestHex: DEE649_TEST_DIGEST_D,
    }),
    availableCashUsdt: "200",
    cashAuthorityReceiptDigestHex: DEE649_TEST_DIGEST_A,
    scientificAdmissionVerified: true,
    scientificAdmissionReceiptDigestHex: DEE649_TEST_DIGEST_B,
    ...overrides,
  };
}

describe("DEE-649 C3 closed Decision evaluator and WhyNotCashReceiptV2", () => {
  it("qualifies only the exact singleton when conservative EV beats CASH", () => {
    const result = evaluateDecisionEconomicsV2(evaluationInput());

    expect(result.decisionActionable).toBe(true);
    expect(result.action).toBe("ENTER_LONG");
    expect(result.economicAdmissibleSizeSet).toEqual(["1"]);
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
      forecast: { ...base.forecast, replicaSamples: [[[...negative]], [[...negative]]] },
    });

    expect(result.decisionActionable).toBe(false);
    expect(result.action).toBe("CASH");
    expect(result.economicAdmissibleSizeSet).toEqual([]);
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
      forecast: { ...base.forecast, replicaSamples: [[residual]] },
    });

    expect(result.evRange).toBeNull();
    expect(result.economicAdmissibleSizeSet).toEqual([]);
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
  });

  it("binds Forecast, anchor, policy and size authorities to one SPOT instrument", () => {
    const base = evaluationInput();
    const mismatchedSizeSet = createSingletonEconomicSizeSetV1({
      sizeSetId: "human-exact-size/wrong-symbol-test-only",
      symbol: "ETHUSDT",
      unit: "BASE_ASSET_QUANTITY",
      exactQuantity: "1",
      authorityReceiptDigestHex: DEE649_TEST_DIGEST_D,
    });
    const result = evaluateDecisionEconomicsV2({ ...base, economicSizeSet: mismatchedSizeSet });

    expect(result.receipt.reasonCodes).toContain("INSTRUMENT_AUTHORITY_MISMATCH");
    expect(result.economicAdmissibleSizeSet).toEqual([]);
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

  it("has identical pure semantics for historical, paper and live-equivalent callers", () => {
    const input = evaluationInput();
    const historical = () => evaluateDecisionEconomicsV2(input);
    const paper = () => evaluateDecisionEconomicsV2(input);
    const liveEquivalent = () => evaluateDecisionEconomicsV2(input);

    expect(paper()).toEqual(historical());
    expect(liveEquivalent()).toEqual(historical());
  });

  it("property-checks scenario-wise lower <= base across gains and losses", () => {
    for (let price = 70; price <= 130; price += 3) {
      const sample = dee649Sample13d({ exitPrices: [price, price, price] });
      const base = evaluationInput();
      const result = evaluateDecisionEconomicsV2({
        ...base,
        forecast: { ...base.forecast, replicaSamples: [[sample]] },
      });
      for (const scenario of result.scenarioResults.flat()) {
        expect(scenario.lowerPayoff).toBeLessThanOrEqual(scenario.basePayoff);
      }
    }
  });
});
