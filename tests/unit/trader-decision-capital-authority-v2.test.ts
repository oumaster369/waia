import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual = await load<typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")>();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import {
  runDecisionCapitalAuthorityV2,
  type CanonicalDecisionCapitalAuthorityV2Deps,
  type DecisionAuthorityV2,
  type DecisionCapitalRequestV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";

const ORG = "11111111-1111-4111-8111-111111111111";
const digest = (character: string) => character.repeat(64);

function forecast(): ForecastRuntimeOutcomeV2 {
  return {
    status: "FORECAST_AUTHORIZED",
    authority: {
      organizationId: ORG,
      contentDigestHex: digest("a"),
    },
    issuance: { package: { family: { symbol: "BTCUSDT" } } },
  } as unknown as ForecastRuntimeOutcomeV2;
}

function request(outcome: ForecastRuntimeOutcomeV2 = forecast()): DecisionCapitalRequestV2 {
  return {
    organizationId: ORG,
    accountId: "account-1",
    cycleId: "cycle-1",
    symbol: "BTCUSDT",
    referencePrice: "50000",
    executionMode: "paper",
    forecastOutcome: outcome,
    proposal: { action: "ENTER_LONG", quantity: "0.01", strategySignalId: "diagnostic-only" },
  };
}

function decision(patch: Partial<DecisionAuthorityV2> = {}): DecisionAuthorityV2 {
  return {
    decisionId: "decision-1",
    semanticDigestHex: digest("b"),
    contentDigestHex: digest("c"),
    forecastAuthorityContentDigestHex: digest("a"),
    action: "ENTER_LONG",
    evLower: "1",
    evBase: "2",
    evUpper: "3",
    economicSizeSetId: "sizes-1",
    economicSizeSetDigestHex: digest("d"),
    qualifiedQuantity: "0.01",
    ...patch,
  };
}

function submittedOrder(
  patch: Partial<Extract<SubmitOrderResult, { status: "submitted" }>["order"]> = {},
): Extract<SubmitOrderResult, { status: "submitted" }> {
  return {
    status: "submitted",
    order: {
      id: "order-1",
      organizationId: ORG,
      credentialId: null,
      venue: "paper",
      executionMode: "paper",
      symbol: "BTCUSDT",
      side: "buy",
      type: "market",
      price: null,
      quantity: "0.005",
      filledQuantity: "0",
      avgFillPrice: null,
      state: "SENT_TO_EXCHANGE",
      stateVersion: 1,
      exchangeOrderId: null,
      clientOrderId: "client-order-1",
      idempotencyKey: "idem-1",
      riskDecisionId: "verdict-1",
      riskAllowanceId: "allowance-1",
      riskAllowanceBindingDigest: digest("7"),
      strategySignalId: null,
      allocationDecisionId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...patch,
    },
  };
}

function deps(patch: Partial<CanonicalDecisionCapitalAuthorityV2Deps> = {}): CanonicalDecisionCapitalAuthorityV2Deps {
  const exactDecision = decision();
  return {
    decide: vi.fn(async () => ({ status: "ACTIONABLE" as const, decision: exactDecision })),
    assessRisk: vi.fn(async () => ({
      status: "PERMITTED" as const,
      decisionContentDigestHex: exactDecision.contentDigestHex,
      riskVerdictId: "verdict-1",
      riskVerdictContentDigestHex: digest("e"),
      riskAllowanceId: "allowance-1",
      riskAllowanceContentDigestHex: digest("f"),
      approvedQualifiedQuantity: "0.005",
    })),
    execute: vi.fn(async () => ({
      decisionContentDigestHex: exactDecision.contentDigestHex,
      riskAllowanceId: "allowance-1",
      riskAllowanceContentDigestHex: digest("f"),
      riskAllowanceOrderBindingDigestHex: digest("7"),
      executionPlanId: "plan-1",
      executionPlanContentDigestHex: digest("1"),
      executionAttemptId: "attempt-1",
      executionAttemptContentDigestHex: digest("2"),
      submittedQuantity: "0.005",
      execution: { status: "conflict" as const, orderId: "order-1" },
    })),
    ...patch,
  };
}

describe("DEE-780 canonical Decision V2 capital authority", () => {
  it("runs Forecast → Decision → Risk → Execution once and preserves exact lineage", async () => {
    const stages = deps();
    const result = await runDecisionCapitalAuthorityV2(stages, request());

    expect(result.status).toBe("EXECUTION_BOUND");
    expect(stages.decide).toHaveBeenCalledTimes(1);
    expect(stages.assessRisk).toHaveBeenCalledTimes(1);
    expect(stages.execute).toHaveBeenCalledTimes(1);
    if (result.status !== "EXECUTION_BOUND") throw new Error("expected authority");
    expect(result.execution.decisionContentDigestHex).toBe(result.decision.contentDigestHex);
    expect(result.execution.riskAllowanceContentDigestHex).toBe(
      result.permission.riskAllowanceContentDigestHex,
    );
  });

  it("makes Forecast and Decision non-actionability terminal without invoking downstream stages", async () => {
    const nonActionable = {
      schemaVersion: "waia.trader.forecast_runtime_non_actionable.v2",
      status: "NON_ACTIONABLE",
      capitalAuthority: "NONE",
      reason: "MISSING_OR_NOT_ADMITTED",
      predictiveAdmissionReceiptContentDigestHex: null,
      marketStateSnapshotContentDigestHex: null,
      selectedPredictivePackageContentDigestHex: null,
      upstreamReasonCodes: [],
      contentDigestHex: digest("9"),
    } as const;
    const forecastStages = deps();
    const forecastResult = await runDecisionCapitalAuthorityV2(
      forecastStages,
      request(nonActionable),
    );
    expect(forecastResult).toMatchObject({ status: "NO_TRADE", stage: "FORECAST" });
    expect(forecastStages.decide).not.toHaveBeenCalled();

    const decisionStages = deps({
      decide: vi.fn(async () => ({
        status: "NO_TRADE" as const,
        decisionId: "decision-no-trade",
        decisionContentDigestHex: digest("3"),
        forecastAuthorityContentDigestHex: digest("a"),
        reasonCodes: ["EV_LOWER_NOT_POSITIVE"],
      })),
    });
    const decisionResult = await runDecisionCapitalAuthorityV2(decisionStages, request());
    expect(decisionResult).toMatchObject({
      status: "NO_TRADE",
      stage: "DECISION",
      reasonCodes: ["EV_LOWER_NOT_POSITIVE"],
    });
    expect(decisionStages.assessRisk).not.toHaveBeenCalled();
    expect(decisionStages.execute).not.toHaveBeenCalled();
  });

  it("rejects non-positive EV, Risk amplification and broken Execution binding", async () => {
    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          decide: vi.fn(async () => ({
            status: "ACTIONABLE" as const,
            decision: decision({ evLower: "0" }),
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({
      reason: "ACTIONABLE_DECISION_EV_LOWER_NOT_POSITIVE",
    });

    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          assessRisk: vi.fn(async () => ({
            status: "PERMITTED" as const,
            decisionContentDigestHex: digest("c"),
            riskVerdictId: "verdict-1",
            riskVerdictContentDigestHex: digest("e"),
            riskAllowanceId: "allowance-1",
            riskAllowanceContentDigestHex: digest("f"),
            approvedQualifiedQuantity: "0.02",
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({ reason: "RISK_QUANTITY_AMPLIFICATION_FORBIDDEN" });

    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          execute: vi.fn(async () => ({
            decisionContentDigestHex: digest("8"),
            riskAllowanceId: "allowance-1",
            riskAllowanceContentDigestHex: digest("f"),
            riskAllowanceOrderBindingDigestHex: digest("7"),
            executionPlanId: "plan-1",
            executionPlanContentDigestHex: digest("1"),
            executionAttemptId: "attempt-1",
            executionAttemptContentDigestHex: digest("2"),
            submittedQuantity: "0.005",
            execution: { status: "conflict" as const, orderId: "order-1" },
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({ reason: "EXECUTION_AUTHORITY_BINDING_MISMATCH" });
  });

  it("rejects missing authority identities before they can cross a stage boundary", async () => {
    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          decide: vi.fn(async () => ({
            status: "ACTIONABLE" as const,
            decision: decision({ decisionId: "" }),
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({ reason: "DECISION_ID_INVALID" });

    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          execute: vi.fn(async () => ({
            decisionContentDigestHex: digest("c"),
            riskAllowanceId: "allowance-1",
            riskAllowanceContentDigestHex: digest("f"),
            riskAllowanceOrderBindingDigestHex: digest("7"),
            executionPlanId: "",
            executionPlanContentDigestHex: digest("1"),
            executionAttemptId: "attempt-1",
            executionAttemptContentDigestHex: digest("2"),
            submittedQuantity: "0.005",
            execution: { status: "conflict" as const, orderId: "order-1" },
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({ reason: "EXECUTION_PLAN_ID_INVALID" });
  });

  it("rejects a sealed Forecast V2 package for a different symbol before Decision", async () => {
    const stages = deps();
    const mismatched = forecast() as Extract<ForecastRuntimeOutcomeV2, { status: "FORECAST_AUTHORIZED" }>;
    const outcome = {
      ...mismatched,
      issuance: { ...mismatched.issuance, package: { family: { symbol: "ETHUSDT" } } },
    } as ForecastRuntimeOutcomeV2;

    await expect(runDecisionCapitalAuthorityV2(stages, request(outcome))).rejects.toMatchObject({
      reason: "FORECAST_SYMBOL_MISMATCH",
    });
    expect(stages.decide).not.toHaveBeenCalled();
    expect(stages.assessRisk).not.toHaveBeenCalled();
    expect(stages.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong tenant", { organizationId: "22222222-2222-4222-8222-222222222222" }],
    ["wrong mode", { executionMode: "live" as const }],
    ["wrong symbol", { symbol: "ETHUSDT" }],
    ["wrong side", { side: "sell" as const }],
    ["wrong risk decision", { riskDecisionId: "verdict-other" }],
    ["wrong allowance", { riskAllowanceId: "allowance-other" }],
    ["wrong allowance digest", { riskAllowanceBindingDigest: digest("9") }],
    ["amplified actual quantity", { quantity: "0.02" }],
  ])("rejects submitted order payload binding: %s", async (_label, orderPatch) => {
    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          execute: vi.fn(async () => ({
            decisionContentDigestHex: digest("c"),
            riskAllowanceId: "allowance-1",
            riskAllowanceContentDigestHex: digest("f"),
            riskAllowanceOrderBindingDigestHex: digest("7"),
            executionPlanId: "plan-1",
            executionPlanContentDigestHex: digest("1"),
            executionAttemptId: "attempt-1",
            executionAttemptContentDigestHex: digest("2"),
            submittedQuantity: "0.005",
            execution: submittedOrder(orderPatch),
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({ reason: "EXECUTION_ORDER_BINDING_MISMATCH" });
  });

  it.each([
    ["paper" as const, "paper" as const],
    ["live-equivalent" as const, "live" as const],
  ])("accepts an exactly bound submitted order for %s", async (requestMode, orderMode) => {
    const result = await runDecisionCapitalAuthorityV2(
      deps({
        execute: vi.fn(async () => ({
          decisionContentDigestHex: digest("c"),
          riskAllowanceId: "allowance-1",
          riskAllowanceContentDigestHex: digest("f"),
          riskAllowanceOrderBindingDigestHex: digest("7"),
          executionPlanId: "plan-1",
          executionPlanContentDigestHex: digest("1"),
          executionAttemptId: "attempt-1",
          executionAttemptContentDigestHex: digest("2"),
          submittedQuantity: "0.005",
          execution: submittedOrder({ executionMode: orderMode }),
        })),
      }),
      { ...request(), executionMode: requestMode },
    );
    expect(result.status).toBe("EXECUTION_BOUND");
  });

  it("rejects a live order returned for paper qualification", async () => {
    await expect(
      runDecisionCapitalAuthorityV2(
        deps({
          execute: vi.fn(async () => ({
            decisionContentDigestHex: digest("c"),
            riskAllowanceId: "allowance-1",
            riskAllowanceContentDigestHex: digest("f"),
            riskAllowanceOrderBindingDigestHex: digest("7"),
            executionPlanId: "plan-1",
            executionPlanContentDigestHex: digest("1"),
            executionAttemptId: "attempt-1",
            executionAttemptContentDigestHex: digest("2"),
            submittedQuantity: "0.005",
            execution: submittedOrder({ executionMode: "live" }),
          })),
        }),
        request(),
      ),
    ).rejects.toMatchObject({ reason: "EXECUTION_ORDER_BINDING_MISMATCH" });
  });
});
