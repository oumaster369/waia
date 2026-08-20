import { describe, expect, it } from "vitest";

import {
  evaluateDecisionEconomicsV2,
  evaluateDecisionEconomicsV2ForSemanticMode,
} from "@/lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2";
import {
  validateDecisionEvaluationReceiptV1,
  validateWhyNotCashReceiptV2,
} from "@/lib/trader/intelligence/decision-economics/dee660-why-not-cash-receipt-v2";

import {
  dee659TestCash,
  dee659TestPolicy,
  dee659TestSize,
} from "./helpers/dee659-execution-payoff-fixtures";
import {
  dee660EvaluationInput,
  dee660Sample13d,
  dee660TestForecast,
} from "./helpers/dee660-decision-evaluator-fixtures";

describe("DEE-660 Decision economic evaluator V2", () => {
  it("selects ENTER_LONG only after every gate passes and exact EV_lower is positive", () => {
    const result = evaluateDecisionEconomicsV2(dee660EvaluationInput());

    expect(result.decisionActionable).toBe(true);
    expect(result.action).toBe("ENTER_LONG");
    expect(result.economicAdmissibleSizeSet?.exactQuantities).toEqual(["1"]);
    expect(result.evRange?.rangeValid).toBe(true);
    expect(result.evRange?.evLower).toBeGreaterThan(0);
    expect(result.receipt.verdict).toBe("DECISION_ACTIONABLE");
    expect(result.receipt.selectedAction).toBe("ENTER_LONG");
    expect(result.receipt.alternatives[0]).toEqual({
      action: "CASH",
      incrementalReturnUsdt: "0",
    });
    expect(result.receipt.economicallyAdmissibleExactQuantities).toEqual(["1"]);
    expect(result.receipt.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(validateWhyNotCashReceiptV2(result.receipt)).toEqual([]);
    expect(result.decisionReceipt.whyNotCashReceiptDigestHex).toBe(
      result.receipt.contentDigestHex,
    );
    expect(validateDecisionEvaluationReceiptV1(result.decisionReceipt)).toEqual([]);
  });

  it("selects CASH and preserves negative lower/base economics", () => {
    const forecast = dee660TestForecast([
      [dee660Sample13d({ exitPrices: [80, 80, 80] })],
      [dee660Sample13d({ exitPrices: [90, 90, 90] })],
    ]);
    const result = evaluateDecisionEconomicsV2(dee660EvaluationInput({ forecast }));

    expect(result.decisionActionable).toBe(false);
    expect(result.action).toBe("CASH");
    expect(result.economicAdmissibleSizeSet).toBeNull();
    expect(result.evRange?.evBase).toBeLessThan(0);
    expect(result.evRange?.evLower).toBeLessThanOrEqual(result.evRange!.evBase);
    expect(result.receipt.reasonCodes).toEqual(
      expect.arrayContaining(["EV_LOWER_NON_POSITIVE", "DECISION_NON_ACTIONABLE"]),
    );
  });

  it("fails the singleton size closed when any scenario is economically inadmissible", () => {
    const residual = dee660Sample13d({
      exitPrices: [110, 110, 110],
      exitVolumes: [2, 2, 2],
    });
    const forecast = dee660TestForecast([[dee660Sample13d(), residual]]);
    const result = evaluateDecisionEconomicsV2(dee660EvaluationInput({ forecast }));

    expect(result.evRange).toBeNull();
    expect(result.economicAdmissibleSizeSet).toBeNull();
    expect(result.receipt.reasonCodes).toContain("POST_EXIT_RESIDUAL_INVENTORY");
    expect(result.receipt.scenarioResidualInventoryCount).toBe(1);
    expect(result.receipt.scenarioContentDigests).toHaveLength(1);
    expect(result.receipt.scenarioContentDigests[0]).toHaveLength(2);
  });

  it("fails closed on unknown family and missing verified scientific authority", () => {
    const base = dee660EvaluationInput();
    const unknown = evaluateDecisionEconomicsV2({
      ...base,
      forecast: {
        ...base.forecast,
        identity: {
          ...base.forecast.identity,
          modelTransformVersion: "unregistered/v1",
        } as unknown as typeof base.forecast.identity,
      },
    });
    expect(unknown.decisionActionable).toBe(false);
    expect(unknown.receipt.evaluationContract).toBeNull();
    expect(unknown.receipt.reasonCodes).toContain("FORECAST_CONTRACT_MISMATCH");

    const unverified = evaluateDecisionEconomicsV2({
      ...base,
      authorityVerification: {
        ...base.authorityVerification,
        scientificAdmission: {
          ...base.authorityVerification.scientificAdmission,
          verified: false,
        },
      },
    });
    expect(unverified.decisionActionable).toBe(false);
    expect(unverified.receipt.reasonCodes).toContain("SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED");
  });

  it("rejects stale verified DEE-659 authorities after subject substitution", () => {
    const base = dee660EvaluationInput();
    const replacements = [
      {
        override: { policy: dee659TestPolicy({ participationCapFraction: "0.2" }) },
        reason: "EXECUTABLE_POLICY_AUTHORITY_NOT_VERIFIED",
      },
      {
        override: { economicSizeSet: dee659TestSize("0.5") },
        reason: "ECONOMIC_SIZE_AUTHORITY_NOT_VERIFIED",
      },
      {
        override: { cashAuthority: dee659TestCash("250") },
        reason: "CASH_AUTHORITY_NOT_VERIFIED",
      },
    ] as const;
    for (const replacement of replacements) {
      const result = evaluateDecisionEconomicsV2({ ...base, ...replacement.override });
      expect(result.decisionActionable).toBe(false);
      expect(result.receipt.reasonCodes).toContain(replacement.reason);
    }
  });

  it("is deterministic across replay modes and ignores all legacy Strategy diagnostics", () => {
    const input = dee660EvaluationInput();
    const first = evaluateDecisionEconomicsV2(input);
    const replay = evaluateDecisionEconomicsV2(input);
    const modes = (["HISTORICAL", "PAPER", "LIVE_EQUIVALENT"] as const).map((mode) =>
      evaluateDecisionEconomicsV2ForSemanticMode(input, mode),
    );
    const legacyNoise = evaluateDecisionEconomicsV2({
      ...input,
      legacyStrategyDiagnostics: {
        legacyDiagnosticConfidence: 0.999,
        legacyDiagnosticExpectedEdge: -999,
        legacyDiagnosticMaxRisk: 999,
      },
    });
    const unauthorizedDownstreamNoise = evaluateDecisionEconomicsV2({
      ...input,
      riskPermission: "APPROVE",
      guardianPermission: "INCREASE",
    } as typeof input);

    expect(replay).toEqual(first);
    for (const modeResult of modes) expect(modeResult).toEqual(first);
    expect(legacyNoise).toEqual(first);
    expect(unauthorizedDownstreamNoise).toEqual(first);
  });

  it("changes the receipt for every valid causally material input change", () => {
    const baseline = evaluateDecisionEconomicsV2(dee660EvaluationInput());
    const changedForecast = dee660TestForecast([
      [dee660Sample13d({ exitPrices: [120, 120, 120] })],
    ]);
    const changedPolicy = dee659TestPolicy({
      entryCosts: {
        feeBps: "1",
        spreadBps: "0",
        impactBps: "0",
        slippageBps: "0",
        conservativeStressBps: "0",
      },
    });
    const variants = [
      evaluateDecisionEconomicsV2(dee660EvaluationInput({ forecast: changedForecast })),
      evaluateDecisionEconomicsV2(dee660EvaluationInput({ policy: changedPolicy })),
      evaluateDecisionEconomicsV2(dee660EvaluationInput({ size: dee659TestSize("0.5") })),
      evaluateDecisionEconomicsV2(dee660EvaluationInput({ cash: dee659TestCash("250") })),
    ];

    for (const variant of variants) {
      expect(variant.receipt.contentDigestHex).not.toBe(baseline.receipt.contentDigestHex);
      expect(variant.decisionReceipt.contentDigestHex).not.toBe(
        baseline.decisionReceipt.contentDigestHex,
      );
      expect(validateWhyNotCashReceiptV2(variant.receipt)).toEqual([]);
      expect(validateDecisionEvaluationReceiptV1(variant.decisionReceipt)).toEqual([]);
    }
  });

  it("detects receipt mutation and converts malformed DTOs to deterministic CASH", () => {
    const valid = evaluateDecisionEconomicsV2(dee660EvaluationInput()).receipt;
    expect(
      validateWhyNotCashReceiptV2({
        ...valid,
        selectedAction: "CASH",
      }),
    ).toEqual(expect.arrayContaining(["contentDigestHex:MISMATCH", "verdict:INCONSISTENT"]));

    const malformed = {
      ...dee660EvaluationInput(),
      forecast: undefined,
    } as unknown as Parameters<typeof evaluateDecisionEconomicsV2>[0];
    const first = evaluateDecisionEconomicsV2(malformed);
    const replay = evaluateDecisionEconomicsV2(malformed);
    expect(first).toEqual(replay);
    expect(first.action).toBe("CASH");
    expect(first.receipt.reasonCodes).toEqual([
      "EVALUATION_INPUT_MALFORMED",
      "DECISION_NON_ACTIONABLE",
    ]);
    expect(validateWhyNotCashReceiptV2(first.receipt)).toEqual([]);
    expect(validateDecisionEvaluationReceiptV1(first.decisionReceipt)).toEqual([]);
  });

  it("property-checks scenario-wise lower <= base across gains and losses", () => {
    for (let price = 70; price <= 130; price += 3) {
      const forecast = dee660TestForecast([
        [dee660Sample13d({ exitPrices: [price, price, price] })],
      ]);
      const result = evaluateDecisionEconomicsV2(dee660EvaluationInput({ forecast }));
      for (const scenario of result.scenarioResults.flat()) {
        expect(scenario.lowerPayoff).toBeLessThanOrEqual(scenario.basePayoff);
      }
    }
  });
});
