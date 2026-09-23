import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual =
    await load<
      typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")
    >();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { buildKnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import type { DecisionAuthorityV2 } from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import {
  createMemoryShadowCycleStore,
  runShadowCanonicalCycleV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

const DIGEST = "a".repeat(64);
const ORG = "org-shadow";
const PIT = "2026-09-22T09:00:00.000Z";

function admittedInput(deps: {
  decide: () => Promise<unknown>;
  assessRisk: () => Promise<unknown>;
}) {
  const ctx = buildAuthoritativeRuntimeContextV2({
    organizationId: ORG,
    accountId: "account-1",
    symbol: "BTCUSDT",
    pitAnchor: PIT,
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    runtimeAssessmentDigestHex: DIGEST,
    driftPosture: "NORMAL",
    driftRestrictionDigestHex: DIGEST,
    qualificationTupleDigestHex: DIGEST,
    packageDigestHex: DIGEST,
    informationContractDigestHex: DIGEST,
    informationNeedPlanDigestHex: DIGEST,
    releaseDigestHex: DIGEST,
  });
  const navigator = buildKnowledgeSelectionReceiptV2({
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
    evidenceBudget: 1,
    knowledgeDigestHex: DIGEST,
  });
  const forecast = {
    status: "FORECAST_AUTHORIZED",
    authority: { organizationId: ORG, contentDigestHex: DIGEST },
    issuance: { package: { family: { symbol: "BTCUSDT" } } },
  } as unknown as ForecastRuntimeOutcomeV2;
  return {
    epistemic: {
      context: ctx,
      navigatorReceipt: navigator,
      predictiveAdmissionVerdict: "ADMITTED" as const,
      futureCycleEffect: null,
    },
    admissionTemplate: {
      context: ctx,
      currentRuntimePosture: ctx.runtimePosture,
      currentDriftPosture: ctx.driftPosture,
      predictiveAdmissionVerdict: "ADMITTED",
      navigatorOutcome: "SELECTED_MINIMAL_SUFFICIENT",
    } as never,
    capitalDeps: {
      decide: deps.decide,
      assessRisk: deps.assessRisk,
      execute: async () => {
        throw new Error("EXECUTE_NOT_REACHED");
      },
    },
    capitalRequest: {
      organizationId: ORG,
      accountId: "account-1",
      cycleId: "cycle-1",
      symbol: "BTCUSDT",
      referencePrice: "1",
      executionMode: "paper" as const,
      forecastOutcome: forecast,
      proposal: { action: "ENTER_LONG" as const, quantity: "1", strategySignalId: null },
    },
  };
}

const decision: DecisionAuthorityV2 = {
  decisionId: "decision-1",
  semanticDigestHex: DIGEST,
  contentDigestHex: DIGEST,
  forecastAuthorityContentDigestHex: DIGEST,
  action: "ENTER_LONG",
  evLower: "1",
  evBase: "2",
  evUpper: "3",
  economicSizeSetId: "size-1",
  economicSizeSetDigestHex: DIGEST,
  qualifiedQuantity: "1",
};

describe("shadow cycle later no-trade stages", () => {
  it("persists a decision refusal", async () => {
    const record = await runShadowCanonicalCycleV2(
      createMemoryShadowCycleStore(),
      "bar-decision",
      admittedInput({
        decide: async () => ({
          status: "NO_TRADE",
          decisionId: "decision-1",
          decisionContentDigestHex: DIGEST,
          forecastAuthorityContentDigestHex: DIGEST,
          reasonCodes: ["DECISION_NON_ACTIONABLE"],
        }),
        assessRisk: async () => {
          throw new Error("RISK_NOT_REACHED");
        },
      }) as never,
    );
    expect(record.stage).toBe("DECISION");
    expect(record.reasonCodes).toContain("DECISION_NON_ACTIONABLE");
  });

  it("persists a risk veto", async () => {
    const record = await runShadowCanonicalCycleV2(
      createMemoryShadowCycleStore(),
      "bar-risk",
      admittedInput({
        decide: async () => ({ status: "ACTIONABLE", decision }),
        assessRisk: async () => ({
          status: "VETO",
          decisionContentDigestHex: DIGEST,
          reasonCodes: ["RISK_VETO"],
        }),
      }) as never,
    );
    expect(record.stage).toBe("RISK");
    expect(record.reasonCodes).toContain("RISK_VETO");
  });
});
