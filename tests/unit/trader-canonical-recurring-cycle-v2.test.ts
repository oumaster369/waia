import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual =
    await load<
      typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")
    >();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import { buildKnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import { runCanonicalOrdinaryCapitalCycleV2 } from "@/lib/trader/runtime-v2/canonical-recurring-cycle-v2";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionAuthorityV2,
  DecisionCapitalRequestV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";

const ORG = "11111111-1111-4111-8111-111111111111";
const DIGEST = "a".repeat(64);
const PIT = "2026-02-01T12:00:00.000Z";
const digest = (character: string) => character.repeat(64);

function context(
  runtimePosture:
    | "FULL_ANALYSIS_AND_NEW_RISK"
    | "NO_NEW_RISK"
    | "CLOSE_ONLY"
    | "HALT" = "FULL_ANALYSIS_AND_NEW_RISK",
) {
  return buildAuthoritativeRuntimeContextV2({
    organizationId: ORG,
    accountId: "account-1",
    symbol: "BTCUSDT",
    pitAnchor: PIT,
    runtimePosture,
    runtimeAssessmentDigestHex: DIGEST,
    driftPosture: "NORMAL",
    driftRestrictionDigestHex: DIGEST,
    qualificationTupleDigestHex: DIGEST,
    packageDigestHex: DIGEST,
    informationContractDigestHex: DIGEST,
    informationNeedPlanDigestHex: DIGEST,
    releaseDigestHex: DIGEST,
  });
}

function navigator() {
  return buildKnowledgeSelectionReceiptV2({
    organizationId: ORG,
    runId: "run-1",
    symbol: "BTCUSDT",
    purpose: "forecast",
    questionId: "q-1",
    pitAnchor: PIT,
    informationNeedPlanDigestHex: DIGEST,
    outcome: "SELECTED_MINIMAL_SUFFICIENT",
    selected: [{ knowledgeEdgeId: "edge-1", version: 1, contentDigestHex: DIGEST }],
    rejected: [],
    evidenceBudget: 8,
    knowledgeDigestHex: DIGEST,
  });
}

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

function request(): DecisionCapitalRequestV2 {
  return {
    organizationId: ORG,
    accountId: "account-1",
    cycleId: "cycle-1",
    symbol: "BTCUSDT",
    referencePrice: "50000",
    executionMode: "paper",
    forecastOutcome: forecast(),
    proposal: { action: "ENTER_LONG", quantity: "0.01", strategySignalId: "diagnostic-only" },
  };
}

function decision(): DecisionAuthorityV2 {
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
  };
}

function submittedOrder(): Extract<SubmitOrderResult, { status: "submitted" }> {
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
    },
  };
}

function deps(
  patch: Partial<CanonicalDecisionCapitalAuthorityV2Deps> = {},
): CanonicalDecisionCapitalAuthorityV2Deps {
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
      execution: submittedOrder(),
    })),
    ...patch,
  };
}

function cycleInput(
  overrides: {
    predictiveAdmissionVerdict?: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
    mkbInjectionAttempted?: boolean;
    currentRuntimePosture?: "FULL_ANALYSIS_AND_NEW_RISK" | "NO_NEW_RISK" | "CLOSE_ONLY" | "HALT";
    runtimePosture?: "FULL_ANALYSIS_AND_NEW_RISK" | "NO_NEW_RISK" | "CLOSE_ONLY" | "HALT";
    capitalDeps?: CanonicalDecisionCapitalAuthorityV2Deps;
  } = {},
) {
  const runtimeContext = context(overrides.runtimePosture ?? "FULL_ANALYSIS_AND_NEW_RISK");
  return {
    epistemic: {
      context: runtimeContext,
      navigatorReceipt: navigator(),
      predictiveAdmissionVerdict: overrides.predictiveAdmissionVerdict ?? "ADMITTED",
      futureCycleEffect: null,
      mkbInjectionAttempted: overrides.mkbInjectionAttempted,
    },
    admissionTemplate: {
      context: runtimeContext,
      currentRuntimePosture:
        overrides.currentRuntimePosture ?? overrides.runtimePosture ?? "FULL_ANALYSIS_AND_NEW_RISK",
      currentDriftPosture: "NORMAL" as const,
      navigatorOutcome: "SELECTED_MINIMAL_SUFFICIENT" as const,
      predictiveAdmissionVerdict: overrides.predictiveAdmissionVerdict ?? "ADMITTED",
      admittedAt: PIT,
      identity: {
        organizationId: ORG,
        accountId: "account-1",
        symbol: "BTCUSDT",
        action: "ENTER_LONG" as const,
        direction: "BUY" as const,
        quantity: "0.005",
        externalEffectId: "effect-1",
      },
    },
    capitalDeps: overrides.capitalDeps ?? deps(),
    capitalRequest: request(),
  };
}

describe("DEE-639 canonical ordinary capital cycle", () => {
  it("binds Execution only after epistemic compose and admission proof", async () => {
    const capitalDeps = deps();
    const result = await runCanonicalOrdinaryCapitalCycleV2(cycleInput({ capitalDeps }));
    expect(result.status).toBe("EXECUTION_BOUND");
    expect(capitalDeps.execute).toHaveBeenCalledTimes(1);
    if (result.status !== "EXECUTION_BOUND") throw new Error("expected bound");
    expect(result.admissionProofDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.capital.execution.submittedQuantity).toBe("0.005");
  });

  it("abstains before Decision when Navigator/PA compose fails, and before venue on restricted posture", async () => {
    const research = deps();
    const researchResult = await runCanonicalOrdinaryCapitalCycleV2(
      cycleInput({
        predictiveAdmissionVerdict: "RESEARCH_ONLY",
        capitalDeps: research,
      }),
    );
    expect(researchResult).toMatchObject({ status: "NO_TRADE", stage: "EPISTEMIC" });
    expect(research.decide).not.toHaveBeenCalled();

    const restricted = deps();
    const restrictedResult = await runCanonicalOrdinaryCapitalCycleV2(
      cycleInput({
        runtimePosture: "NO_NEW_RISK",
        currentRuntimePosture: "NO_NEW_RISK",
        capitalDeps: restricted,
      }),
    );
    expect(restrictedResult).toMatchObject({
      status: "NO_TRADE",
      stage: "ADMISSION",
      reasonCodes: ["NEW_EXPOSURE_NOT_PERMITTED"],
    });
    expect(restricted.execute).not.toHaveBeenCalled();

    const mismatched = deps();
    const mismatchedResult = await runCanonicalOrdinaryCapitalCycleV2(
      cycleInput({
        currentRuntimePosture: "NO_NEW_RISK",
        capitalDeps: mismatched,
      }),
    );
    expect(mismatchedResult).toMatchObject({
      status: "NO_TRADE",
      stage: "ADMISSION",
      reasonCodes: ["ADMISSION_INPUT_MISMATCH"],
    });
    expect(mismatched.decide).not.toHaveBeenCalled();
  });
});
