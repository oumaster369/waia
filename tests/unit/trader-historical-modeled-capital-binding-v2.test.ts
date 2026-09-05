import { describe, expect, it, vi } from "vitest";

import { createHistoricalModeledCapitalBindingV2, createHistoricalModeledExecutionRegistryV2 } from "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createHistoricalSimulationDurableStateSnapshotV2,
  validateHistoricalSimulationDurableStateSnapshotV2,
} from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import { createInitialAccountingState, computeAccountingSemanticDigest } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";

const digest = (value: string) => value.repeat(64);
const membershipBody = { schemaVersion: "waia.trader.historical_dataset_membership.v2" as const, organizationId: "org-1", cycleId: "cycle-1", manifestSemanticDigestHex: digest("1"), sealReceiptDigestHex: digest("2"), partitionDigestHex: digest("3"), partitionRawSha256Hex: digest("4"), partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const, recordIndex: 0, barContentDigestHex: digest("5"), sealedCycleContentDigestHex: digest("6") };
const cycle = Object.freeze({
  cycleId: "cycle-1",
  observedAt: "2026-08-30T10:00:00.000Z",
  symbol: "BTCUSDT",
  referencePrice: "100",
  datasetMembership: { ...membershipBody, contentDigestHex: computeSemanticSha256Hex(membershipBody) },
});

function frontier(quantity = "0"): AccountingFrontierV1 {
  const initial = createInitialAccountingState({ organizationId: "org-1", accountKey: "account-1",
    runId: "run-1", startingCash: quantity === "0" ? "1000" : "900", frontierAsOf: cycle.observedAt });
  const state = quantity === "0" ? initial : { ...initial,
    positions: { BTCUSDT: { quantity, grossPositionBasis: "100", netPositionBasis: "100" } },
    marks: { BTCUSDT: { price: "100", barCloseTime: cycle.observedAt } },
    markedPositionValue: "100", equity: "1000", equityHwm: "1000", monthlyPeakHwm: "1000" };
  return { ...state, id: "frontier-1", sourceFillId: null, sourceEconomicsDigest: digest("9"),
    semanticContentDigest: computeAccountingSemanticDigest(state), idempotencyKey: "frontier-key" };
}

function drawdownFrontier(): AccountingFrontierV1 {
  const base = frontier("1");
  const state = { ...base, cash: "600", markedPositionValue: "100", equity: "700",
    equityHwm: "1000", monthlyPeakHwm: "1000", accountDrawdownBps: 3000 };
  return { ...state, semanticContentDigest: computeAccountingSemanticDigest(state) };
}

describe("historical modeled capital binding v2", () => {
  it("keeps a vetoed ENTER as pre-fill intent while modeled Reality remains flat", async () => {
    const registered: OrderRow[] = [];
    const binding = createHistoricalModeledCapitalBindingV2({ organizationId: "org-1", accountId: "account-1",
      runId: "run-1", resolveCycle: () => cycle,
      decide: async () => { throw new Error("not exercised"); },
      loadAccounting: async () => ({ frontier: frontier(), posture: "NORMAL",
        worstCasePendingExposureNotional: "0", outstandingReservationNotional: "0",
        exposureLimitNotional: "50" }),
      exchange: { registerOrder: (order: OrderRow) => { registered.push(order); } } as never,
      executionRegistry: createHistoricalModeledExecutionRegistryV2(), decisionBarIndex: () => 9,
      evaluateGuardian: async () => ({ status: "NONE", reasonCodes: [] }), persistEvidence: async () => undefined,
      persistExecutionSubmission: async ({ order }) => ({ ...order, state: "ACCEPTED", stateVersion: 2 }),
      advanceModeledExecution: async () => ({ observedExecutionEffects: [], accountingAdvanced: false }),
      learningProjection: async () => ({ status: "NO_UPDATE", reasonCodes: ["NO_MATURED_OUTCOME"],
        calibrationObservationContentDigestHex: null, knowledgeUpdateContentDigestHex: null,
        eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null }) });
    const decision = { decisionId: "decision-veto", semanticDigestHex: digest("b"), contentDigestHex: digest("c"),
      forecastAuthorityContentDigestHex: digest("d"), action: "ENTER_LONG" as const, evLower: "1", evBase: "2",
      evUpper: "3", economicSizeSetId: "size-1", economicSizeSetDigestHex: digest("e"), qualifiedQuantity: "1" };
    const request = { organizationId: "org-1", accountId: "account-1", cycleId: cycle.cycleId,
      symbol: cycle.symbol, referencePrice: cycle.referencePrice, forecastOutcome: {} as never,
      proposal: { action: "ENTER_LONG" as const, quantity: "1", strategySignalId: null } };
    await expect(binding.decisionCapitalAuthorityV2.assessRisk({ request, decision }))
      .resolves.toMatchObject({ status: "VETO" });
    expect(registered).toHaveLength(0);
    const proposal = { decisionSemanticMode: "HISTORICAL" as const,
      rawDecisionAction: "ENTER_LONG" as const, rawDecisionReasonCodes: [] as readonly string[],
      action: "ENTER_LONG" as const, quantity: "1", proposalContentDigestHex: digest("f"),
      portfolioReasonCodes: [] as readonly string[], reasonCodes: [] as readonly string[],
      decisionContentDigestHex: decision.contentDigestHex, whyNotCashReceiptDigestHex: digest("1"),
      evLower: "1", evBase: "2", evUpper: "3" };
    await binding.resolveLedgerProjection({ cycle, proposal,
      knowledgeBefore: { asOf: cycle.observedAt, contentDigestHex: digest("2") },
      knowledgeAfterClosure: { asOf: cycle.observedAt, contentDigestHex: digest("3") }, closures: [] });
    expect(binding.portfolioLifecycleForCycle(cycle.cycleId)).toEqual(expect.objectContaining({
      transition: "ENTER", transitionStatus: "PRE_FILL_PROPOSAL", positionQuantityAfter: "1",
    }));
    expect(binding.modeledRealityForCycle(cycle.cycleId)).toEqual(expect.objectContaining({
      positions: [], reconciledExposureNotional: "0",
    }));
  });

  it("uses the one pre-advanced accounting frontier for current Risk and cannot fill the current order on that bar", async () => {
    let exposureLimit = "50";
    const advance = vi.fn(async () => { exposureLimit = "200"; return {
      observedExecutionEffects: [], accountingAdvanced: true } as const; });
    const registered: OrderRow[] = [];
    const binding = createHistoricalModeledCapitalBindingV2({ organizationId: "org-1", accountId: "account-1",
      runId: "run-1", resolveCycle: () => cycle,
      decide: async () => { throw new Error("not exercised"); },
      loadAccounting: async () => ({ frontier: frontier(), posture: "NORMAL",
        worstCasePendingExposureNotional: "0", outstandingReservationNotional: "0",
        exposureLimitNotional: exposureLimit }),
      exchange: { registerOrder: (order: OrderRow) => { registered.push(order); } } as never,
      executionRegistry: createHistoricalModeledExecutionRegistryV2(), decisionBarIndex: () => 9,
      evaluateGuardian: async () => ({ status: "NONE", reasonCodes: [] }), persistEvidence: async () => undefined,
      persistExecutionSubmission: async ({ order }) => ({ ...order, state: "ACCEPTED", stateVersion: 2 }),
      advanceModeledExecution: advance,
      learningProjection: async () => ({ status: "NO_UPDATE", reasonCodes: ["NO_MATURED_OUTCOME"],
        calibrationObservationContentDigestHex: null, knowledgeUpdateContentDigestHex: null,
        eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null }) });
    // This is the production ordering: the already-open order is advanced before current Decision/Risk.
    await advance();
    const decision = { decisionId: "decision-1", semanticDigestHex: digest("b"), contentDigestHex: digest("c"),
      forecastAuthorityContentDigestHex: digest("d"), action: "ENTER_LONG" as const, evLower: "1", evBase: "2",
      evUpper: "3", economicSizeSetId: "size-1", economicSizeSetDigestHex: digest("e"), qualifiedQuantity: "1" };
    const request = { organizationId: "org-1", accountId: "account-1", cycleId: cycle.cycleId,
      symbol: cycle.symbol, referencePrice: cycle.referencePrice, forecastOutcome: {} as never,
      proposal: { action: "ENTER_LONG" as const, quantity: "1", strategySignalId: null } };
    const permission = await binding.decisionCapitalAuthorityV2.assessRisk({ request, decision });
    expect(permission.status).toBe("PERMITTED");
    expect(advance).toHaveBeenCalledOnce();
    expect(registered).toHaveLength(0);
    if (permission.status !== "PERMITTED") throw new Error("expected permitted");
    await binding.decisionCapitalAuthorityV2.execute({ request: { ...request, executionMode: "historical" },
      decision, permission });
    expect(registered).toHaveLength(1);
    expect(advance).toHaveBeenCalledOnce();
  });

  it("creates deterministic non-capital exit evidence and never calls canonical Reality/Risk/Guardian", async () => {
    const registered: unknown[] = [];
    const persistedOrders: string[] = [];
    const evidence: Array<Record<string, unknown>> = [];
    const advance = vi.fn(async (_cycle: unknown) => undefined);
    const canonicalReality = vi.fn(() => { throw new Error("must not be called"); });
    const canonicalRisk = vi.fn(() => { throw new Error("must not be called"); });
    const canonicalGuardian = vi.fn(() => { throw new Error("must not be called"); });
    void [canonicalReality, canonicalRisk, canonicalGuardian];
    const binding = createHistoricalModeledCapitalBindingV2({
      organizationId: "org-1",
      accountId: "account-1",
      runId: "run-1",
      resolveCycle: () => cycle,
      decide: async () => { throw new Error("entry not exercised"); },
      loadAccounting: async () => ({
        frontier: frontier("1"),
        posture: "CLOSE_ONLY",
        worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0",
        exposureLimitNotional: "1000",
      }),
      exchange: { registerOrder: (order: OrderRow) => { registered.push(order); } } as never,
      executionRegistry: createHistoricalModeledExecutionRegistryV2(),
      decisionBarIndex: () => 7,
      evaluateGuardian: async () => ({ status: "NONE", reasonCodes: [] }),
      persistEvidence: async (value) => { evidence.push(value as unknown as Record<string, unknown>); },
      persistExecutionSubmission: async ({ order }) => { persistedOrders.push(order.id);
        return { ...order, state: "ACCEPTED", stateVersion: 2 }; },
      advanceModeledExecution: async (value) => { await advance(value); return { observedExecutionEffects: [], accountingAdvanced: false }; },
      learningProjection: async () => ({
        status: "NO_UPDATE",
        reasonCodes: ["NO_MATURED_OUTCOME"],
        calibrationObservationContentDigestHex: null,
        knowledgeUpdateContentDigestHex: null,
        eligibleResolutionAtUtc: null,
        visibleFromPitAnchorUtc: null,
      }),
    });
    const proposal = {
      decisionSemanticMode: "HISTORICAL" as const,
      rawDecisionAction: "CASH" as const,
      rawDecisionReasonCodes: ["RAW_DECISION_CASH"],
      action: "REDUCE" as const,
      quantity: "0.5",
      proposalContentDigestHex: digest("b"),
      portfolioReasonCodes: ["PORTFOLIO_REDUCE"],
      reasonCodes: [],
      decisionContentDigestHex: digest("c"),
      whyNotCashReceiptDigestHex: digest("d"),
      evLower: "1",
      evBase: "2",
      evUpper: "3",
    };
    const first = await binding.modeledExit.execute({ cycle, proposal });
    const second = await binding.modeledExit.execute({ cycle, proposal });

    expect(first).toEqual(second);
    expect(registered).toHaveLength(2);
    expect(persistedOrders).toHaveLength(2);
    expect(evidence.every((row) => row.source === "MODELED_HISTORICAL" && row.capitalEligible === false)).toBe(true);
    expect(evidence.find((row) => row.schemaVersion === "waia.trader.historical_modeled_risk.v2"))
      .toEqual(expect.objectContaining({ action: "REDUCE", reconciledExposureNotional: "100",
        projectedSymbolExposureNotional: "50", strictExposureReduction: true,
        remainingBeforeAdmissionNotional: "900", remainingAfterAdmissionNotional: "900" }));
    expect(new Set(evidence.map((row) => row.schemaVersion))).not.toContain("reality-projection/v2");
    const executionReceipts = evidence.filter((row) =>
      row.schemaVersion === "waia.trader.historical_modeled_execution.v2");
    expect(executionReceipts).toHaveLength(2);
    const registrySnapshot = createHistoricalSimulationDurableStateSnapshotV2({ organizationId: "org-1",
      accountId: "account-1", runId: "run-1", split: "DEVELOPMENT", cycleId: "cycle-1",
      stateKind: "MODELED_EXECUTION_REGISTRY", state: { receipts: [executionReceipts[0]!] as never } });
    expect(() => validateHistoricalSimulationDurableStateSnapshotV2(registrySnapshot,
      "MODELED_EXECUTION_REGISTRY")).not.toThrow();
    expect(canonicalReality).not.toHaveBeenCalled();
    expect(canonicalRisk).not.toHaveBeenCalled();
    expect(canonicalGuardian).not.toHaveBeenCalled();

    const projection = await binding.resolveLedgerProjection({
      cycle,
      proposal,
      knowledgeBefore: { asOf: cycle.observedAt, contentDigestHex: digest("e") },
      knowledgeAfterClosure: { asOf: cycle.observedAt, contentDigestHex: digest("f") },
      closures: [],
    });
    expect(advance).toHaveBeenCalledOnce();
    expect(projection.accounting.frontierContentDigestHex).toBe(frontier("1").semanticContentDigest);
    expect(projection.guardian.status).toBe("NONE");
    expect(evidence.find((row) => row.schemaVersion === "waia.trader.historical_modeled_guardian.v2"))
      .toEqual(expect.objectContaining({ reconciledExposureNotional: "100", exposureLimitNotional: "1000" }));
    expect(binding.portfolioLifecycleForCycle(cycle.cycleId)).toEqual(expect.objectContaining({
      transition: "REDUCE", positionQuantityBefore: "1", positionQuantityAfter: "0.5",
      strictExposureReduction: true,
    }));
    expect(binding.modeledRealityForCycle(cycle.cycleId)).toEqual(expect.objectContaining({
      schemaVersion: "waia.trader.historical_modeled_reality.v2", capitalEligible: false,
      reconciledExposureNotional: "100",
    }));
  });

  it("derives Guardian stop posture from the current Accounting drawdown", async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const binding = createHistoricalModeledCapitalBindingV2({ organizationId: "org-1",
      accountId: "account-1", runId: "run-1", resolveCycle: () => cycle,
      decide: async () => { throw new Error("not exercised"); },
      loadAccounting: async () => ({ frontier: drawdownFrontier(), posture: "NORMAL",
        worstCasePendingExposureNotional: "0", outstandingReservationNotional: "0",
        exposureLimitNotional: "700" }),
      exchange: { registerOrder: () => undefined } as never,
      executionRegistry: createHistoricalModeledExecutionRegistryV2(), decisionBarIndex: () => 7,
      evaluateGuardian: async () => ({ status: "NONE", reasonCodes: [] }),
      persistEvidence: async (value) => { evidence.push(value as unknown as Record<string, unknown>); },
      persistExecutionSubmission: async ({ order }) => order,
      advanceModeledExecution: async () => ({ observedExecutionEffects: [], accountingAdvanced: false }),
      learningProjection: async () => ({ status: "NO_UPDATE", reasonCodes: ["NO_MATURED_OUTCOME"],
        calibrationObservationContentDigestHex: null, knowledgeUpdateContentDigestHex: null,
        eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null }),
    });
    const proposal = { decisionSemanticMode: "HISTORICAL" as const,
      rawDecisionAction: "CASH" as const, rawDecisionReasonCodes: ["CASH_SELECTED"],
      action: "CASH" as const, quantity: null, proposalContentDigestHex: digest("a"),
      portfolioReasonCodes: ["HISTORICAL_PORTFOLIO_RAW_DECISION_CASH"], reasonCodes: ["CASH_SELECTED"],
      decisionContentDigestHex: digest("b"), whyNotCashReceiptDigestHex: digest("c"),
      evLower: null, evBase: null, evUpper: null };
    const projection = await binding.resolveLedgerProjection({ cycle, proposal,
      knowledgeBefore: { asOf: cycle.observedAt, contentDigestHex: digest("d") },
      knowledgeAfterClosure: { asOf: cycle.observedAt, contentDigestHex: digest("e") }, closures: [] });
    expect(projection.guardian.status).toBe("STOP_ACCOUNT");
    expect(evidence.find((row) => row.schemaVersion === "waia.trader.historical_modeled_guardian.v2"))
      .toEqual(expect.objectContaining({ status: "STOP_ACCOUNT", reconciledExposureNotional: "100",
        exposureLimitNotional: "700" }));
  });
});
