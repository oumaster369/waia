import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual = await load<typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")>();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import {
  runDecisionCapitalAuthorityV2,
  type CanonicalDecisionCapitalAuthorityV2Deps,
  type DecisionCapitalRequestV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";

const digest = (character: string) => character.repeat(64);
const organizationId = "11111111-1111-4111-8111-111111111111";

function request(
  executionMode: DecisionCapitalRequestV2["executionMode"],
  strategySignalId: string,
): DecisionCapitalRequestV2 {
  return {
    organizationId,
    accountId: "account-1",
    cycleId: "cycle-1",
    symbol: "BTCUSDT",
    referencePrice: "50000",
    executionMode,
    forecastOutcome: {
      status: "FORECAST_AUTHORIZED",
      authority: { organizationId, contentDigestHex: digest("a") },
      issuance: { package: { family: { symbol: "BTCUSDT" } } },
    } as DecisionCapitalRequestV2["forecastOutcome"],
    proposal: { action: "ENTER_LONG", quantity: "0.01", strategySignalId },
  };
}

function stages(): CanonicalDecisionCapitalAuthorityV2Deps {
  return {
    decide: vi.fn(async () => ({
      status: "ACTIONABLE" as const,
      decision: {
        decisionId: "decision-1",
        semanticDigestHex: digest("b"),
        contentDigestHex: digest("c"),
        forecastAuthorityContentDigestHex: digest("a"),
        action: "ENTER_LONG" as const,
        evLower: "1",
        evBase: "2",
        evUpper: "3",
        economicSizeSetId: "size-1",
        economicSizeSetDigestHex: digest("d"),
        qualifiedQuantity: "0.01",
      },
    })),
    assessRisk: vi.fn(async ({ decision }) => ({
      status: "PERMITTED" as const,
      decisionContentDigestHex: decision.contentDigestHex,
      riskVerdictId: "verdict-1",
      riskVerdictContentDigestHex: digest("e"),
      riskAllowanceId: "allowance-1",
      riskAllowanceContentDigestHex: digest("f"),
      approvedQualifiedQuantity: "0.005",
    })),
    execute: vi.fn(async ({ decision, permission }) => ({
      decisionContentDigestHex: decision.contentDigestHex,
      riskAllowanceId: permission.riskAllowanceId,
      riskAllowanceContentDigestHex: permission.riskAllowanceContentDigestHex,
      riskAllowanceOrderBindingDigestHex: digest("7"),
      executionPlanId: "plan-1",
      executionPlanContentDigestHex: digest("1"),
      executionAttemptId: "attempt-1",
      executionAttemptContentDigestHex: digest("2"),
      submittedQuantity: "0.005",
      execution: { status: "conflict" as const, orderId: "no-effect" },
    })),
  };
}

describe("DEE-778 Decision V2 semantic parity", () => {
  it("makes Decision and Risk inputs identical across paper/live-equivalent and tactical ids", async () => {
    const paper = stages();
    const live = stages();
    const paperResult = await runDecisionCapitalAuthorityV2(paper, request("paper", "paper-signal"));
    const liveResult = await runDecisionCapitalAuthorityV2(
      live,
      request("live-equivalent", "live-signal"),
    );

    expect(paper.decide).toHaveBeenCalledWith((live.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(paper.assessRisk).toHaveBeenCalledWith(
      (live.assessRisk as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    );
    expect(paperResult).toEqual(liveResult);
  });
});
