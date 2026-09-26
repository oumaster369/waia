import { describe, expect, it, vi } from "vitest";

import {
  buildGuardianAssessmentV2,
  buildProtectiveActionMandateV2,
  buildProtectiveTriggerProofV2,
  createInMemoryProtectiveMandateConsumptionRepositoryV2,
  runGuardianOrdinaryReductionPipelineV2,
  runGuardianProtectiveReductionPipelineV2,
  type GuardianReductionPipelinePortsV2,
  type GuardianV2Recommendation,
  type GuardianDecisionSealV2,
} from "@/lib/trader/guardian/v2";
import {
  createExecutionAttemptV2,
  createExecutionPlanV2,
  createExecutionPolicyBindingV2,
  createExecutionReportV2,
} from "@/lib/trader/execution/v2/contracts";
import { buildOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import { createRealityProjectionV2 } from "@/lib/trader/reality/v2/contracts";
import type { PositionLotRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { createRiskAllowanceV2 } from "@/lib/trader/risk/v2/risk-allowance-v2";

const ORG = "3ca6ea6d-a049-4c1d-a694-77a417536f52";
const hex = (value: string) => value.repeat(64);
const lineage = buildOpeningCausalLineageV1({
  organizationId: ORG, symbol: "BTCUSDT", canonicalCausalLineageDigest: hex("1"),
  forecastId: "forecast-a", forecastContentDigest: hex("2"), decisionId: "decision-a",
  decisionContentDigest: hex("3"), riskVerdictId: "verdict-a", riskAllowanceId: "allowance-a",
  riskAllowanceContentDigest: hex("4"),
});
const now = new Date("2026-08-30T00:00:00.000Z");
const lot: PositionLotRow = {
  id: "lot-a", organizationId: ORG, symbol: "BTCUSDT", venue: "HTX", accountKey: "account-a",
  positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "signal-a", state: "OPEN",
  openQty: "1", remainingQty: "0.5", avgCost: "60000", openedAt: now, closedAt: null,
  tradeId: "trade-a", hedgeGroupId: null, targetLotId: null, createdAt: now, updatedAt: now,
};
const assessment = (recommendation: GuardianV2Recommendation = "REDUCE_PARTIAL") =>
  buildGuardianAssessmentV2({
    organizationId: ORG, positionId: "trade-a", lotId: "lot-a", symbol: "BTCUSDT",
    openingCausalLineageDigest: lineage.contentDigest, realityFrontierId: "reality-a",
    realityContentDigest: hex("5"), qualifiedEvidenceBundleId: "evidence-a",
    qualifiedEvidenceContentDigest: hex("6"), informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
    openPositionSufficiency: "SUFFICIENT", newOpportunitySufficiency: "INSUFFICIENT", recommendation,
    targetReductionBps: recommendation === "HOLD" ? 0 : recommendation === "REDUCE_FULL" ? 10_000 : 2_500, reasonCodes: ["THESIS_WEAKENED"],
  });

function sealedDecision(value = assessment(), approvedQuantity = "0.1") {
  return {
    organizationId: ORG, guardianAssessmentId: value.assessmentId,
    guardianAssessmentContentDigest: value.contentDigest, decisionId: "decision-reduce",
    decisionContentDigest: hex("7"), action: "REDUCE" as const, approvedQuantity,
  };
}

function executionAuthority(decision: GuardianDecisionSealV2, quantity = decision.approvedQuantity) {
  const allowance = createRiskAllowanceV2({
    riskAllowanceId: "00000000-0000-4000-8000-000000063601", organizationId: ORG,
    accountId: lot.accountKey, venue: "HTX", market: "SPOT", symbol: lot.symbol,
    baseAsset: "BTC", quoteAsset: "USDT", instrumentIdentityDigestHex: hex("8"),
    riskVerdictId: "00000000-0000-4000-8000-000000063602", riskVerdictContentDigestHex: hex("9"),
    admissionSequence: "1", decision: {
      decisionId: decision.decisionId, semanticDigestHex: hex("a"),
      contentDigestHex: decision.decisionContentDigest, action: decision.action,
      economicSizeSetId: "guardian-sizes", economicSizeSetDigestHex: hex("b"),
      forecastId: "guardian-forecast", forecastContentDigestHex: hex("c"),
      canonicalCausalLineageDigestHex: lineage.canonicalCausalLineageDigest,
    },
    riskPolicyVersion: "guardian-reduction-v2", riskPolicyDigestHex: hex("d"),
    realitySnapshotId: "reality-a", realityContentDigestHex: hex("5"),
    reconciliationAuthorityDigestHex: hex("e"), postureAtIssuance: "NORMAL",
    strictExposureReduction: true, exactQualifiedQuantity: quantity, reservedExposureNotional: "0",
    nonce: "00000000-0000-4000-8000-000000063603",
    issuedAtUtc: "2026-08-30T00:00:00.000Z", validUntilUtc: "2026-08-30T00:01:00.000Z",
  });
  const policy = createExecutionPolicyBindingV2({
    executionPolicyId: "00000000-0000-4000-8000-000000063604", organizationId: ORG,
    policyVersion: "guardian-htx-spot-v2", decisionId: decision.decisionId,
    decisionContentDigestHex: decision.decisionContentDigest,
    decisionExecutionPolicyDigestHex: hex("f"), economicSizeSetDigestHex: hex("b"),
    venue: "HTX", market: "SPOT", instrumentIdentityDigestHex: hex("8"),
    allowedOrderTypes: ["limit"], allowedTimeInForce: ["GTC"], allowedLiquidityRoles: ["MAKER"],
    priceCollar: { minimumPrice: "24000", maximumPrice: "26000", authorityDigestHex: hex("1") },
    quantityRules: { minimumQuantity: "0.00000001", quantityStep: "0.00000001", roundingMode: "DOWN_TO_QUALIFIED", economicQualifiedQuantities: [quantity] },
    slicingPolicy: { maximumSlices: 1, completePlanRequired: true },
    retryPolicy: { maximumNetworkSubmissions: 1, sameIdentityRetryAllowed: false, venueIdempotencyProven: false },
    cancelPolicy: { protectiveCancelAllowed: true, replacementRequiresPresealedOrFreshAuthority: true },
    timeoutMs: 5_000, uncertaintyHandling: "RECONCILIATION_REQUIRED",
    effectiveFromUtc: "2026-08-30T00:00:00.000Z", effectiveUntilUtc: "2026-08-30T00:02:00.000Z",
  });
  const plan = createExecutionPlanV2({
    executionPlanId: "00000000-0000-4000-8000-000000063605", allowance, policy,
    approvedNotionalCeiling: "12500", plannedQuantity: quantity, orderType: "limit",
    liquidityRole: "MAKER", limitPrice: "25000", timeInForce: "GTC",
    timingWindow: { opensAtUtc: "2026-08-30T00:00:01.000Z", closesAtUtc: "2026-08-30T00:00:20.000Z" },
    childSlices: [{ sequence: 1, quantity, limitPrice: "25000" }],
    sealedAtUtc: "2026-08-30T00:00:00.500Z",
  });
  const attempt = createExecutionAttemptV2({
    executionAttemptId: "00000000-0000-4000-8000-000000063606",
    orderId: "00000000-0000-4000-8000-000000063607", plan,
    riskAllowanceContentDigestHex: allowance.contentDigestHex, boundAtUtc: "2026-08-30T00:00:00.750Z",
  });
  return { allowance, plan, attempt };
}


type ProtectiveInput = Parameters<typeof runGuardianProtectiveReductionPipelineV2>[0];

function protectiveInput(recommendation: GuardianV2Recommendation = "HOLD", actionKind: "REDUCE_PARTIAL" | "CLOSE_FULL" = "CLOSE_FULL", maximumReductionBps = actionKind === "CLOSE_FULL" ? 10_000 : 5_000) {
  const value = assessment(recommendation);
  const mandate = buildProtectiveActionMandateV2({
    organizationId: ORG, positionId: value.positionId, lotId: value.lotId, symbol: value.symbol,
    openingCausalLineageDigest: value.openingCausalLineageDigest,
    guardianAssessmentId: value.assessmentId, guardianAssessmentContentDigest: value.contentDigest,
    decisionId: "decision-protective", decisionContentDigest: hex("7"), actionKind,
    maximumReductionBps, deterministicTriggerSpecDigest: hex("8"),
    validUntilUtc: "2026-08-30T00:01:00.000Z",
  });
  const triggerProof = buildProtectiveTriggerProofV2({
    mandateId: mandate.mandateId, mandateContentDigest: mandate.contentDigest,
    deterministicTriggerSpecDigest: mandate.deterministicTriggerSpecDigest,
    realityProjectionId: value.realityFrontierId, realityContentDigest: value.realityContentDigest,
    evaluatorVersion: "guardian-trigger-v2", evaluatorDigest: hex("9"),
    observedAtUtc: "2026-08-30T00:00:30.000Z",
  });
  const ports = {
    risk: { authorizeReduction: vi.fn(async ({ decision }: Parameters<GuardianReductionPipelinePortsV2["risk"]["authorizeReduction"]>[0]) => executionAuthority(decision).allowance) },
    execution: { executeReduction: vi.fn(async ({ decision }: Parameters<GuardianReductionPipelinePortsV2["execution"]["executeReduction"]>[0]) => {
      const authority = executionAuthority(decision);
      return { plan: authority.plan, attempt: authority.attempt, reports: [createExecutionReportV2({
        executionReportId: "00000000-0000-4000-8000-000000110601", organizationId: ORG,
        accountId: lot.accountKey, executionAttemptId: authority.attempt.executionAttemptId,
        executionAttemptContentDigestHex: authority.attempt.contentDigestHex, reportSequence: "1",
        reportType: "CONNECTOR_UNCERTAIN", source: "CONNECTOR", rawObservation: { timeout: true },
        venueOrderId: null, observedAtUtc: "2026-08-30T00:00:32.000Z", previousReportDigestHex: null,
      })] };
    }) },
    reality: { ingestExecutionReports: vi.fn(async () => createRealityProjectionV2({
      organizationId: ORG, accountId: lot.accountKey, knowledgeAsOfUtc: "2026-08-30T00:00:33.000Z",
      frontierSequence: "0", frontierEventDigestHex: null, stableEntries: [], uncertainties: [],
    })) },
  };
  const consumptionRepository = createInMemoryProtectiveMandateConsumptionRepositoryV2();
  vi.spyOn(consumptionRepository, "claimOnce");
  return { assessment: value, mandate, triggerProof, adjudicatedAtUtc: "2026-08-30T00:00:31.000Z", lot, openingLineage: lineage, ports, consumptionRepository };
}

function reviseMandate(input: ReturnType<typeof protectiveInput>, overrides: Partial<ProtectiveInput["mandate"]>): void {
  const { schemaVersion, mandateId, contentDigest, ...draft } = input.mandate;
  void schemaVersion; void mandateId; void contentDigest;
  input.mandate = buildProtectiveActionMandateV2({ ...draft, ...overrides });
}

describe("Guardian prior conditional Decision authority", () => {
  for (const recommendation of ["HOLD", "REDUCE_PARTIAL", "REDUCE_FULL"] as const) {
    it.each([
      ["CLOSE_FULL", 10_000, "0.5", "CLOSE"],
      ["REDUCE_PARTIAL", 5_000, "0.25", "REDUCE"],
      ["REDUCE_PARTIAL", 1_250, "0.0625", "REDUCE"],
    ] as const)(`${recommendation}: uses the prior %s mandate (%i bps) through Risk, Execution and Reality`, async (actionKind, maximumBps, quantity, action) => {
      const input = protectiveInput(recommendation, actionKind, maximumBps);
      const result = await runGuardianProtectiveReductionPipelineV2(input);
      expect(result.decision).toMatchObject({ decisionId: input.mandate.decisionId, decisionContentDigest: input.mandate.decisionContentDigest, action, approvedQuantity: quantity });
      expect(input.ports.risk.authorizeReduction).toHaveBeenCalledOnce();
      expect(input.ports.execution.executeReduction).toHaveBeenCalledOnce();
      expect(input.ports.reality.ingestExecutionReports).toHaveBeenCalledOnce();
      expect(result.plan.side).toBe("sell");
      expect(result.plan.plannedQuantity).toBe(quantity);
      expect(result.reports[0].reportType).toBe("CONNECTOR_UNCERTAIN");
      await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow("GUARDIAN_PROTECTIVE_MANDATE_ALREADY_CONSUMED");
      expect(input.ports.execution.executeReduction).toHaveBeenCalledOnce();
    });
  }

  it("bounds the mandate to remaining Reality quantity after a partial reduction", async () => {
    const input = protectiveInput("HOLD", "REDUCE_PARTIAL", 2_500);
    input.lot = { ...input.lot, remainingQty: "0.3" };
    const result = await runGuardianProtectiveReductionPipelineV2(input);
    expect(result.decision.approvedQuantity).toBe("0.075");
    expect(result.plan.plannedQuantity).toBe("0.075");
  });

  it("rejects zero after decimal rounding before consuming the mandate", async () => {
    const input = protectiveInput("HOLD", "REDUCE_PARTIAL", 1);
    input.lot = { ...input.lot, remainingQty: "0.00000001" };
    await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow("GUARDIAN_PIPELINE_DECISION_WOULD_INCREASE_OR_REVERSE");
    expect(input.consumptionRepository.claimOnce).not.toHaveBeenCalled();
    expect(input.ports.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it.each([
    ["another lot", { lotId: "other-lot" }, "GUARDIAN_PROTECTIVE_MANDATE_BINDING_MISMATCH"],
    ["another symbol", { symbol: "ETHUSDT" }, "GUARDIAN_PROTECTIVE_MANDATE_BINDING_MISMATCH"],
    ["another assessment", { guardianAssessmentContentDigest: hex("a") }, "GUARDIAN_PROTECTIVE_MANDATE_BINDING_MISMATCH"],
    ["another lineage", { openingCausalLineageDigest: hex("b") }, "GUARDIAN_PROTECTIVE_MANDATE_BINDING_MISMATCH"],
    ["non-executable tightening", { actionKind: "TIGHTEN_PROTECTION", maximumReductionBps: 0 }, "GUARDIAN_PROTECTIVE_TIGHTEN_REQUIRES_DEDICATED_EXECUTOR"],
  ] as const)("refuses %s before claim and Risk", async (_name, overrides, reason) => {
    const input = protectiveInput();
    reviseMandate(input, overrides);
    await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow(reason);
    expect(input.consumptionRepository.claimOnce).not.toHaveBeenCalled();
    expect(input.ports.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", "2026-08-30T00:01:00.001Z"],
    ["future trigger", "2026-08-30T00:00:29.999Z"],
  ])("refuses %s before consuming the mandate", async (_name, at) => {
    const input = protectiveInput();
    input.adjudicatedAtUtc = at;
    await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow("GUARDIAN_PROTECTIVE_TRIGGER_BINDING_MISMATCH");
    expect(input.consumptionRepository.claimOnce).not.toHaveBeenCalled();
    expect(input.ports.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it.each(["mandate", "trigger"] as const)("refuses a tampered %s under its original digest before claim", async (kind) => {
    const input = protectiveInput();
    if (kind === "mandate") input.mandate = { ...input.mandate, decisionId: "other-decision" };
    else input.triggerProof = { ...input.triggerProof, evaluatorVersion: "other-evaluator" };
    await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow(kind === "mandate" ? "PROTECTIVE_MANDATE_DIGEST_MISMATCH" : "PROTECTIVE_TRIGGER_PROOF_DIGEST_MISMATCH");
    expect(input.consumptionRepository.claimOnce).not.toHaveBeenCalled();
    expect(input.ports.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it("does not retry a consumed mandate after Risk refuses permission", async () => {
    const input = protectiveInput();
    input.ports.risk.authorizeReduction.mockRejectedValue(new Error("RISK_DENIED"));
    await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow("RISK_DENIED");
    await expect(runGuardianProtectiveReductionPipelineV2(input)).rejects.toThrow("GUARDIAN_PROTECTIVE_MANDATE_ALREADY_CONSUMED");
    expect(input.ports.risk.authorizeReduction).toHaveBeenCalledOnce();
    expect(input.ports.execution.executeReduction).not.toHaveBeenCalled();
    expect(input.ports.reality.ingestExecutionReports).not.toHaveBeenCalled();
  });

  it("allows only one Risk/Execution call across concurrent protective invocations", async () => {
    const input = protectiveInput();
    const results = await Promise.allSettled([runGuardianProtectiveReductionPipelineV2(input), runGuardianProtectiveReductionPipelineV2(input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("GUARDIAN_PROTECTIVE_MANDATE_ALREADY_CONSUMED");
    expect(input.ports.risk.authorizeReduction).toHaveBeenCalledOnce();
    expect(input.ports.execution.executeReduction).toHaveBeenCalledOnce();
  });

  it("retains the ordinary Decision action matcher", async () => {
    const input = protectiveInput("REDUCE_PARTIAL");
    const decideReduction = vi.fn(async () => ({ ...sealedDecision(input.assessment), action: "CLOSE" as const }));
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: input.assessment, lot, openingLineage: lineage, ports: { ...input.ports, decision: { decideReduction } } })).rejects.toThrow("GUARDIAN_PIPELINE_DECISION_ACTION_MISMATCH");
    expect(input.ports.risk.authorizeReduction).not.toHaveBeenCalled();
  });
});
