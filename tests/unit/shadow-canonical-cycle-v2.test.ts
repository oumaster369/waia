import { describe, expect, it } from "vitest";

import { FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { buildKnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import {
  createMemoryShadowCycleStore,
  runShadowCanonicalCycleV2,
  shadowBarKeyV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";
import type { DecisionCapitalRequestV2 } from "@/lib/trader/runtime-v2/decision-capital-authority-v2";

const DIGEST = "a".repeat(64);
const ORG = "org-shadow";
const PIT = "2026-09-22T09:00:00.000Z";

function context() {
  return buildAuthoritativeRuntimeContextV2({
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
}

function request(): DecisionCapitalRequestV2 {
  return {
    organizationId: ORG,
    accountId: "account-1",
    cycleId: "cycle-1",
    symbol: "BTCUSDT",
    referencePrice: "1",
    executionMode: "paper",
    forecastOutcome: {
      schemaVersion: FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION,
      status: "NON_ACTIONABLE",
      capitalAuthority: "NONE",
      reason: "MISSING_OR_NOT_ADMITTED",
      predictiveAdmissionReceiptContentDigestHex: null,
      marketStateSnapshotContentDigestHex: null,
      selectedPredictivePackageContentDigestHex: null,
      upstreamReasonCodes: [],
      contentDigestHex: DIGEST,
    },
    proposal: { action: "ENTER_LONG", quantity: "1", strategySignalId: null },
  };
}

const unusedDeps = {
  decide: async () => {
    throw new Error("DECIDE_NOT_REACHED");
  },
  assessRisk: async () => {
    throw new Error("RISK_NOT_REACHED");
  },
  execute: async () => {
    throw new Error("EXECUTE_NOT_REACHED");
  },
};

describe("shadow canonical cycle", () => {
  it("records why the bar did not trade when no scientific admission exists", async () => {
    const store = createMemoryShadowCycleStore();
    const barKey = shadowBarKeyV2({
      organizationId: ORG,
      accountId: "account-1",
      symbol: "BTCUSDT",
      pitAnchor: PIT,
    });
    const record = await runShadowCanonicalCycleV2(store, barKey, {
      epistemic: {
        context: context(),
        navigatorReceipt: null,
        predictiveAdmissionVerdict: "NOT_ADMITTED",
        futureCycleEffect: null,
      },
      admissionTemplate: {} as never,
      capitalDeps: unusedDeps,
      capitalRequest: request(),
    });
    expect(record.status).toBe("NO_TRADE");
    expect(record.stage).toBe("EPISTEMIC");
    expect(record.reasonCodes).toContain("PREDICTIVE_ADMISSION_NOT_ADMITTED");
    expect(record.reasonCodes).toContain("NAVIGATOR_RECEIPT_MISSING");
    const again = await runShadowCanonicalCycleV2(store, barKey, {
      epistemic: {
        context: context(),
        navigatorReceipt: null,
        predictiveAdmissionVerdict: "ADMITTED",
        futureCycleEffect: null,
      },
      admissionTemplate: {} as never,
      capitalDeps: unusedDeps,
      capitalRequest: request(),
    });
    expect(again).toEqual(record);
  });

  it("records an admission mismatch only after the epistemic spine admits", async () => {
    const ctx = context();
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
    const record = await runShadowCanonicalCycleV2(
      createMemoryShadowCycleStore(),
      "bar-admission",
      {
        epistemic: {
          context: ctx,
          navigatorReceipt: navigator,
          predictiveAdmissionVerdict: "ADMITTED",
          futureCycleEffect: null,
        },
        admissionTemplate: {
          context: { ...ctx, contentDigestHex: "b".repeat(64) },
          currentRuntimePosture: ctx.runtimePosture,
          currentDriftPosture: ctx.driftPosture,
          predictiveAdmissionVerdict: "ADMITTED",
          navigatorOutcome: "SELECTED_MINIMAL_SUFFICIENT",
        } as never,
        capitalDeps: unusedDeps,
        capitalRequest: request(),
      },
    );
    expect(record.stage).toBe("ADMISSION");
    expect(record.reasonCodes).toContain("ADMISSION_INPUT_MISMATCH");
  });

  it("records a non-actionable forecast without calling execution", async () => {
    const ctx = context();
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
    const record = await runShadowCanonicalCycleV2(createMemoryShadowCycleStore(), "bar-forecast", {
      epistemic: {
        context: ctx,
        navigatorReceipt: navigator,
        predictiveAdmissionVerdict: "ADMITTED",
        futureCycleEffect: null,
      },
      admissionTemplate: {
        context: ctx,
        currentRuntimePosture: ctx.runtimePosture,
        currentDriftPosture: ctx.driftPosture,
        predictiveAdmissionVerdict: "ADMITTED",
        navigatorOutcome: "SELECTED_MINIMAL_SUFFICIENT",
        identity: {},
      } as never,
      capitalDeps: unusedDeps,
      capitalRequest: request(),
    });
    expect(record.stage).toBe("FORECAST");
    expect(record.reasonCodes).toContain("MISSING_OR_NOT_ADMITTED");
  });
});
