import { describe, expect, it, vi } from "vitest";

import {
  buildGuardianAssessmentV2,
  buildProtectiveActionMandateV2,
  buildProtectiveMandateConsumptionV2,
  buildProtectiveTriggerProofV2,
  createInMemoryProtectiveMandateConsumptionRepositoryV2,
  runGuardianOrdinaryReductionPipelineV2,
  runGuardianProtectiveReductionPipelineV2,
  type GuardianReductionPipelinePortsV2,
} from "@/lib/trader/guardian/v2";
import {
  createExecutionAttemptV2,
  createExecutionPlanV2,
  createExecutionPolicyBindingV2,
  createExecutionReportV2,
} from "@/lib/trader/execution/v2/contracts";
import { buildOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
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
const assessment = (recommendation: "HOLD" | "REDUCE_PARTIAL" = "REDUCE_PARTIAL") =>
  buildGuardianAssessmentV2({
    organizationId: ORG, positionId: "trade-a", lotId: "lot-a", symbol: "BTCUSDT",
    openingCausalLineageDigest: lineage.contentDigest, realityFrontierId: "reality-a",
    realityContentDigest: hex("5"), qualifiedEvidenceBundleId: "evidence-a",
    qualifiedEvidenceContentDigest: hex("6"), informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
    openPositionSufficiency: "SUFFICIENT", newOpportunitySufficiency: "INSUFFICIENT", recommendation,
    targetReductionBps: recommendation === "HOLD" ? 0 : 2_500, reasonCodes: ["THESIS_WEAKENED"],
  });

function ports(decideReduction: GuardianReductionPipelinePortsV2["decision"]["decideReduction"]) {
  return {
    decision: { decideReduction: vi.fn(decideReduction) },
    risk: { authorizeReduction: vi.fn() },
    execution: { executeReduction: vi.fn() },
    reality: { ingestExecutionReports: vi.fn() },
  } as unknown as GuardianReductionPipelinePortsV2;
}

function sealedDecision(value = assessment(), approvedQuantity = "0.1") {
  return {
    organizationId: ORG, guardianAssessmentId: value.assessmentId,
    guardianAssessmentContentDigest: value.contentDigest, decisionId: "decision-reduce",
    decisionContentDigest: hex("7"), action: "REDUCE" as const, approvedQuantity,
  };
}

function executionAuthority(decision = sealedDecision()) {
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
    strictExposureReduction: true, exactQualifiedQuantity: "0.1", reservedExposureNotional: "0",
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
    quantityRules: { minimumQuantity: "0.01", quantityStep: "0.01", roundingMode: "DOWN_TO_QUALIFIED", economicQualifiedQuantities: ["0.1"] },
    slicingPolicy: { maximumSlices: 1, completePlanRequired: true },
    retryPolicy: { maximumNetworkSubmissions: 1, sameIdentityRetryAllowed: false, venueIdempotencyProven: false },
    cancelPolicy: { protectiveCancelAllowed: true, replacementRequiresPresealedOrFreshAuthority: true },
    timeoutMs: 5_000, uncertaintyHandling: "RECONCILIATION_REQUIRED",
    effectiveFromUtc: "2026-08-30T00:00:00.000Z", effectiveUntilUtc: "2026-08-30T00:02:00.000Z",
  });
  const plan = createExecutionPlanV2({
    executionPlanId: "00000000-0000-4000-8000-000000063605", allowance, policy,
    approvedNotionalCeiling: "2500", plannedQuantity: "0.1", orderType: "limit",
    liquidityRole: "MAKER", limitPrice: "25000", timeInForce: "GTC",
    timingWindow: { opensAtUtc: "2026-08-30T00:00:01.000Z", closesAtUtc: "2026-08-30T00:00:20.000Z" },
    childSlices: [{ sequence: 1, quantity: "0.1", limitPrice: "25000" }],
    sealedAtUtc: "2026-08-30T00:00:00.500Z",
  });
  const attempt = createExecutionAttemptV2({
    executionAttemptId: "00000000-0000-4000-8000-000000063606",
    orderId: "00000000-0000-4000-8000-000000063607", plan,
    riskAllowanceContentDigestHex: allowance.contentDigestHex, boundAtUtc: "2026-08-30T00:00:00.750Z",
  });
  return { allowance, plan, attempt };
}

describe("Guardian V2 ordinary reduction pipeline", () => {
  it("does not let HOLD reach Decision, Risk, Execution or Reality", async () => {
    const chain = ports(vi.fn());
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: assessment("HOLD"), lot, openingLineage: lineage, ports: chain }))
      .rejects.toThrow("GUARDIAN_PIPELINE_HOLD_HAS_NO_ACTION");
    expect(chain.decision.decideReduction).not.toHaveBeenCalled();
    expect(chain.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it.each([
    ["forged assessment", { guardianAssessmentContentDigest: hex("f"), approvedQuantity: "0.1" }, "GUARDIAN_PIPELINE_DECISION_BINDING_MISMATCH"],
    ["increase/reversal quantity", { approvedQuantity: "0.6" }, "GUARDIAN_PIPELINE_DECISION_WOULD_INCREASE_OR_REVERSE"],
    ["wrong action", { action: "CLOSE" }, "GUARDIAN_PIPELINE_DECISION_ACTION_MISMATCH"],
  ] as const)("fails closed before Risk for %s", async (_label, override, error) => {
    const value = assessment();
    const chain = ports(async () => ({
      organizationId: ORG, guardianAssessmentId: value.assessmentId,
      guardianAssessmentContentDigest: value.contentDigest, decisionId: "decision-reduce",
      decisionContentDigest: hex("7"), action: "REDUCE", approvedQuantity: "0.1", ...override,
    } as never));
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: value, lot, openingLineage: lineage, ports: chain }))
      .rejects.toThrow(error);
    expect(chain.risk.authorizeReduction).not.toHaveBeenCalled();
    expect(chain.execution.executeReduction).not.toHaveBeenCalled();
    expect(chain.reality.ingestExecutionReports).not.toHaveBeenCalled();
  });

  it("rejects stale opening lineage before any authority is consulted", async () => {
    const chain = ports(vi.fn());
    await expect(runGuardianOrdinaryReductionPipelineV2({
      assessment: assessment(), lot, openingLineage: { ...lineage, contentDigest: hex("f") }, ports: chain,
    })).rejects.toThrow("GUARDIAN_PIPELINE_OPENING_LINEAGE_MISMATCH");
    expect(chain.decision.decideReduction).not.toHaveBeenCalled();
  });

  it("caps a partial Decision at the exact assessment target boundary", async () => {
    const value = assessment();
    const exactBoundary = sealedDecision(value, "0.125");
    const boundaryPorts = ports(async () => exactBoundary);
    boundaryPorts.risk.authorizeReduction = vi.fn(async () => { throw new Error("BOUNDARY_REACHED_RISK"); });
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: value, lot, openingLineage: lineage, ports: boundaryPorts }))
      .rejects.toThrow("BOUNDARY_REACHED_RISK");
    const oversizedPorts = ports(async () => sealedDecision(value, "0.12500001"));
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: value, lot, openingLineage: lineage, ports: oversizedPorts }))
      .rejects.toThrow("GUARDIAN_PIPELINE_DECISION_EXCEEDS_RECOMMENDATION");
    expect(oversizedPorts.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it("rejects a valid report chain bound to a foreign execution attempt", async () => {
    const value = assessment();
    const decision = sealedDecision(value);
    const authority = executionAuthority(decision);
    const foreignAttempt = createExecutionAttemptV2({
      executionAttemptId: "00000000-0000-4000-8000-000000063608",
      orderId: "00000000-0000-4000-8000-000000063609", plan: authority.plan,
      riskAllowanceContentDigestHex: authority.allowance.contentDigestHex,
      boundAtUtc: "2026-08-30T00:00:00.750Z",
    });
    const foreignReport = createExecutionReportV2({
      executionReportId: "00000000-0000-4000-8000-000000063610", organizationId: ORG,
      accountId: lot.accountKey, executionAttemptId: foreignAttempt.executionAttemptId,
      executionAttemptContentDigestHex: foreignAttempt.contentDigestHex, reportSequence: "1",
      reportType: "CONNECTOR_UNCERTAIN", source: "CONNECTOR", rawObservation: { timeout: true },
      venueOrderId: null, observedAtUtc: "2026-08-30T00:00:02.000Z", previousReportDigestHex: null,
    });
    const chain = ports(async () => decision);
    chain.risk.authorizeReduction = vi.fn(async () => authority.allowance);
    chain.execution.executeReduction = vi.fn(async () => ({ plan: authority.plan, attempt: authority.attempt, reports: [foreignReport] }));
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: value, lot, openingLineage: lineage, ports: chain }))
      .rejects.toThrow("GUARDIAN_PIPELINE_EXECUTION_REPORT_INVALID");
    expect(chain.reality.ingestExecutionReports).not.toHaveBeenCalled();
  });

  it("rejects replay of a pre-expiry trigger after the mandate expires", async () => {
    const value = assessment("HOLD");
    const mandate = buildProtectiveActionMandateV2({
      organizationId: ORG, positionId: value.positionId, lotId: value.lotId, symbol: value.symbol,
      openingCausalLineageDigest: value.openingCausalLineageDigest,
      guardianAssessmentId: value.assessmentId, guardianAssessmentContentDigest: value.contentDigest,
      decisionId: "decision-protective", decisionContentDigest: hex("7"), actionKind: "REDUCE_PARTIAL",
      maximumReductionBps: 2_500, deterministicTriggerSpecDigest: hex("8"),
      validUntilUtc: "2026-08-30T00:01:00.000Z",
    });
    const triggerProof = buildProtectiveTriggerProofV2({
      mandateId: mandate.mandateId, mandateContentDigest: mandate.contentDigest,
      deterministicTriggerSpecDigest: mandate.deterministicTriggerSpecDigest,
      realityProjectionId: value.realityFrontierId, realityContentDigest: value.realityContentDigest,
      evaluatorVersion: "guardian-trigger-v2", evaluatorDigest: hex("9"),
      observedAtUtc: "2026-08-30T00:00:30.000Z",
    });
    const protectivePorts = {
      risk: { authorizeReduction: vi.fn() }, execution: { executeReduction: vi.fn() },
      reality: { ingestExecutionReports: vi.fn() },
    } as unknown as Omit<GuardianReductionPipelinePortsV2, "decision">;
    await expect(runGuardianProtectiveReductionPipelineV2({
      assessment: value, mandate, triggerProof, adjudicatedAtUtc: "2026-08-30T00:01:00.001Z",
      lot, openingLineage: lineage, ports: protectivePorts,
      consumptionRepository: createInMemoryProtectiveMandateConsumptionRepositoryV2(),
    })).rejects.toThrow("GUARDIAN_PROTECTIVE_TRIGGER_BINDING_MISMATCH");
    expect(protectivePorts.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it("atomically consumes a protective mandate once and blocks pre-expiry replay before Risk", async () => {
    const value = assessment("HOLD");
    const mandate = buildProtectiveActionMandateV2({
      organizationId: ORG, positionId: value.positionId, lotId: value.lotId, symbol: value.symbol,
      openingCausalLineageDigest: value.openingCausalLineageDigest,
      guardianAssessmentId: value.assessmentId, guardianAssessmentContentDigest: value.contentDigest,
      decisionId: "decision-protective", decisionContentDigest: hex("7"), actionKind: "REDUCE_PARTIAL",
      maximumReductionBps: 2_500, deterministicTriggerSpecDigest: hex("8"),
      validUntilUtc: "2026-08-30T00:01:00.000Z",
    });
    const triggerProof = buildProtectiveTriggerProofV2({
      mandateId: mandate.mandateId, mandateContentDigest: mandate.contentDigest,
      deterministicTriggerSpecDigest: mandate.deterministicTriggerSpecDigest,
      realityProjectionId: value.realityFrontierId, realityContentDigest: value.realityContentDigest,
      evaluatorVersion: "guardian-trigger-v2", evaluatorDigest: hex("9"),
      observedAtUtc: "2026-08-30T00:00:30.000Z",
    });
    const adjudicatedAtUtc = "2026-08-30T00:00:31.000Z";
    const consumption = buildProtectiveMandateConsumptionV2({
      organizationId: ORG, mandateId: mandate.mandateId,
      mandateContentDigest: mandate.contentDigest, triggerProofContentDigest: triggerProof.contentDigest,
      adjudicatedAtUtc,
    });
    const repository = createInMemoryProtectiveMandateConsumptionRepositoryV2();
    expect((await Promise.all([repository.claimOnce(consumption), repository.claimOnce(consumption)])).sort())
      .toEqual(["ALREADY_CONSUMED", "CLAIMED"]);
    const protectivePorts = {
      risk: { authorizeReduction: vi.fn() }, execution: { executeReduction: vi.fn() },
      reality: { ingestExecutionReports: vi.fn() },
    } as unknown as Omit<GuardianReductionPipelinePortsV2, "decision">;
    await expect(runGuardianProtectiveReductionPipelineV2({
      assessment: value, mandate, triggerProof, adjudicatedAtUtc, lot, openingLineage: lineage,
      ports: protectivePorts, consumptionRepository: repository,
    })).rejects.toThrow("GUARDIAN_PROTECTIVE_MANDATE_ALREADY_CONSUMED");
    expect(protectivePorts.risk.authorizeReduction).not.toHaveBeenCalled();
  });
});
