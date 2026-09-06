import { describe, expect, it } from "vitest";
import { advanceAccountingFrontier, createInitialAccountingState } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { createHistoricalSimulatedExchange, type HistoricalExecutionPersistencePort } from
  "@/lib/trader/execution/historical-simulated-exchange";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { createHistoricalModeledCapitalBindingV2, createHistoricalModeledExecutionRegistryV2 } from
  "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";
import { cancelProtectedHistoricalModeledEntriesV2, resolveCurrentHistoricalModeledGuardianV2 } from
  "@/lib/trader/historical-simulation-v2/current-modeled-guardian-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { addDecimal } from "@/lib/trader/risk/numeric";
import { calculateRiskAdmissionV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import { deriveHistoricalModeledRiskAccountingV2 } from
  "@/lib/trader/historical-simulation-v2/historical-modeled-portfolio-reality-v2";
import { makeAccountingEconomicsFill } from "@/tests/unit/helpers/htr-accounting-fixtures";
import { makeWp17Bar, makeWp17QualifiedHtxVolumeAuthority } from "@/tests/unit/helpers/wp17-execution-fixtures";

const digest = (value: string) => value.repeat(64);
const membershipBody = { schemaVersion: "waia.trader.historical_dataset_membership.v2" as const,
  organizationId: "org-1", cycleId: "cycle-1", manifestSemanticDigestHex: digest("1"),
  sealReceiptDigestHex: digest("2"), partitionDigestHex: digest("3"), partitionRawSha256Hex: digest("4"),
  partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const, recordIndex: 0,
  barContentDigestHex: digest("5"), sealedCycleContentDigestHex: digest("6") };
const cycle = { cycleId: "cycle-1", observedAt: "2026-08-30T10:00:00.000Z", symbol: "BTCUSDT",
  referencePrice: "70", datasetMembership: { ...membershipBody,
    contentDigestHex: computeSemanticSha256Hex(membershipBody) } };

function canonicalLossFrontier() {
  const state = createInitialAccountingState({ organizationId: "org-1", accountKey: "account-1",
    runId: "run-1", startingCash: "1000", frontierAsOf: "2026-08-30T09:58:00.000Z" });
  const buy = makeAccountingEconomicsFill("buy", { grossFillPrice: "100", sliceQuantity: "9",
    fillTimestamp: new Date("2026-08-30T09:59:00.000Z") });
  const prior = advanceAccountingFrontier({ state, fill: buy,
    marks: { BTCUSDT: { price: "100", barCloseTime: buy.executedAt } }, frontierAsOf: buy.executedAt });
  const sell = makeAccountingEconomicsFill("sell", { grossFillPrice: "70", sliceQuantity: "9",
    fillTimestamp: new Date(cycle.observedAt) });
  return advanceAccountingFrontier({ state: prior, fill: sell,
    marks: { BTCUSDT: { price: "70", barCloseTime: sell.executedAt } }, frontierAsOf: sell.executedAt });
}

describe("DEE-951 current modeled Guardian", () => {
  it("vetoes a new entry after a canonical loss-making full close before submission", async () => {
    const frontier = canonicalLossFrontier();
    expect(frontier).toMatchObject({ cash: "726.94", equity: "726.94", equityHwm: "1000",
      accountDrawdownBps: 2730, netRealizedPnl: "-273.06", positions: { BTCUSDT: { quantity: "0" } } });
    const registered: OrderRow[] = [];
    const binding = createHistoricalModeledCapitalBindingV2({ organizationId: "org-1", accountId: "account-1",
      runId: "run-1", resolveCycle: () => cycle, decide: async () => { throw new Error("not exercised"); },
      loadAccounting: async () => ({ frontier, posture: "NORMAL", worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0", exposureLimitNotional: frontier.equity }),
      exchange: { registerOrder: (order: OrderRow) => { registered.push(order); } } as never,
      executionRegistry: createHistoricalModeledExecutionRegistryV2(), decisionBarIndex: () => 9,
      evaluateGuardian: async () => ({ status: "NONE", reasonCodes: [] }), persistEvidence: async () => undefined,
      persistExecutionSubmission: async ({ order }) => ({ ...order, state: "ACCEPTED", stateVersion: 2 }),
      advanceModeledExecution: async () => ({ observedExecutionEffects: [], accountingAdvanced: true }),
      learningProjection: async () => ({ status: "NO_UPDATE", reasonCodes: ["NO_MATURED_OUTCOME"],
        calibrationObservationContentDigestHex: null, knowledgeUpdateContentDigestHex: null,
        eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null }) });
    const decision = { decisionId: "decision-1", semanticDigestHex: digest("b"), contentDigestHex: digest("c"),
      forecastAuthorityContentDigestHex: digest("d"), action: "ENTER_LONG" as const,
      evLower: "1", evBase: "2", evUpper: "3", economicSizeSetId: "size-1",
      economicSizeSetDigestHex: digest("e"), qualifiedQuantity: "1" };
    const request = { organizationId: "org-1", accountId: "account-1", cycleId: cycle.cycleId,
      symbol: cycle.symbol, referencePrice: cycle.referencePrice, forecastOutcome: {} as never,
      proposal: { action: "ENTER_LONG" as const, quantity: "1", strategySignalId: null } };
    const permission = await binding.decisionCapitalAuthorityV2.assessRisk({ request, decision });
    expect(permission.status).toBe("VETO");
    if (permission.status === "PERMITTED") await binding.decisionCapitalAuthorityV2.execute({
      request: { ...request, executionMode: "historical" }, decision, permission });
    expect(registered).toHaveLength(0);
    const proposal = { decisionSemanticMode: "HISTORICAL" as const, rawDecisionAction: "ENTER_LONG" as const,
      rawDecisionReasonCodes: [], action: "ENTER_LONG" as const, quantity: "1",
      proposalContentDigestHex: digest("f"), portfolioReasonCodes: [], reasonCodes: [],
      decisionContentDigestHex: decision.contentDigestHex, whyNotCashReceiptDigestHex: digest("1"),
      evLower: "1", evBase: "2", evUpper: "3" };
    const ledger = await binding.resolveLedgerProjection({ cycle, proposal,
      knowledgeBefore: { asOf: cycle.observedAt, contentDigestHex: digest("2") },
      knowledgeAfterClosure: { asOf: cycle.observedAt, contentDigestHex: digest("3") }, closures: [] });
    expect(ledger.risk?.status).toBe("VETO");
    expect(ledger.guardian).toMatchObject({ status: "STOP_ACCOUNT",
      reasonCodes: expect.arrayContaining(["GUARDIAN_ACCOUNT_DRAWDOWN_BREACH"]) });
  });

  it.each(["CLOSE_ONLY", "STOP_ACCOUNT"] as const)("never relaxes restored %s after equity recovery", (status) => {
    const base = canonicalLossFrontier();
    const frontier = { ...base, equity: "1000", monthlyPeakHwm: "1000", strategyDrawdownBpsByKey: {} };
    expect(resolveCurrentHistoricalModeledGuardianV2({ frontier, restored: { status, reasonCodes: ["RESTORED"] } }))
      .toMatchObject({ status, posture: status === "CLOSE_ONLY" ? "CLOSE_ONLY" : "HALT" });
  });

  it("preserves KILLED instead of downgrading it to HALT", () => {
    expect(resolveCurrentHistoricalModeledGuardianV2({ frontier: canonicalLossFrontier(),
      restored: { status: "NONE", reasonCodes: [] }, accountingPosture: "KILLED" }).posture).toBe("KILLED");
  });

  it.each(["CLOSE_ONLY", "STOP_ACCOUNT"] as const)("preserves existing strict-reduction Risk policy under %s", (status) => {
    const state = createInitialAccountingState({ organizationId: "org-1", accountKey: "account-1",
      runId: "run-1", startingCash: "1000", frontierAsOf: cycle.observedAt });
    const frontier = advanceAccountingFrontier({ state, frontierAsOf: cycle.observedAt });
    const { posture } = resolveCurrentHistoricalModeledGuardianV2({ frontier,
      restored: { status, reasonCodes: ["RESTORED"] } });
    const derived = deriveHistoricalModeledRiskAccountingV2({ frontier,
      organizationId: "org-1", accountId: "account-1", runId: "run-1",
      exposureLimitNotional: frontier.equity, worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0" });
    expect(calculateRiskAdmissionV2({ accounting: derived.accounting, posture,
      requestedReservationNotional: "0", strictExposureReduction: true,
      reconciliationStatus: "RECONCILED" }).status).toBe(status === "CLOSE_ONLY" ? "ADMITTED" : "REFUSED");
  });

  it("retains exact account threshold CLOSE_ONLY and blocks exposure without changing the policy", () => {
    const base = canonicalLossFrontier();
    // At the unchanged 25% account limit, isolate the account equality boundary.
    const frontier = { ...base, equity: "750", equityHwm: "1000", monthlyPeakHwm: "750",
      strategyDrawdownBpsByKey: {} };
    expect(resolveCurrentHistoricalModeledGuardianV2({ frontier, restored: { status: "NONE", reasonCodes: [] } }))
      .toMatchObject({ status: "CLOSE_ONLY", posture: "CLOSE_ONLY" });
  });

  it.each(["CLOSE_ONLY", "STOP_ACCOUNT"] as const)("cancels a partial BUY before next fill under %s, preserving SELL and restart", async (status) => {
    const model = createHistoricalExecutionModelV1();
    const exchange = createHistoricalSimulatedExchange(model);
    const acceptedAt = Date.parse(makeWp17Bar(0).barCloseTime);
    const buy = { id: "buy", organizationId: "org-1", type: "market", symbol: "BTCUSDT",
      side: "buy", quantity: "1", filledQuantity: "0", state: "ACCEPTED" } as OrderRow;
    const sell = { ...buy, id: "sell", side: "sell" as const };
    const orders = new Map([[buy.id, buy], [sell.id, sell]]);
    const filled: string[] = [];
    const cancelled: string[] = [];
    const persistence: HistoricalExecutionPersistencePort = {
      recordSimulatedFill: async (_context, order, event) => {
        filled.push(order.id);
        const updated = { ...order, filledQuantity: addDecimal(order.filledQuantity, event.sliceQuantity),
          state: "PARTIALLY_FILLED" as const };
        orders.set(order.id, updated);
        return updated;
      },
      transitionOrderCancelled: async (_context, order) => {
        cancelled.push(order.id);
        const updated = { ...order, state: "CANCELLED" as const };
        orders.set(order.id, updated);
        return updated;
      },
      transitionOrderExpired: async (_context, order) => order,
    };
    const advance = (target: typeof exchange, index: number) => {
      const closedBar = makeWp17Bar(index, { volume: "1" });
      return target.advanceOnClosedBar({ context: { organizationId: "org-1" }, closedBar, barIndex: index,
        model, persistence, replayNowMs: Date.parse(closedBar.barCloseTime),
        ...makeWp17QualifiedHtxVolumeAuthority(closedBar),
        refreshAccountState: async () => ({ positions: [], openOrderCount: target.listOpenOrders().length,
          dailyPnl: "0", drawdown: "0", quoteExposureByCurrency: {} }),
        resolveLatestOrder: async (id) => orders.get(id) ?? null, reconcileOrder: async () => undefined });
    };
    exchange.registerOrder(buy, 0, acceptedAt);
    await advance(exchange, 1);
    expect(filled).toEqual(["buy"]);
    expect(exchange.listOpenOrders()[0].remainingQty).not.toBe("0");
    exchange.registerOrder(sell, 1, Date.parse(makeWp17Bar(1).barCloseTime));
    const cancel = () => cancelProtectedHistoricalModeledEntriesV2({ exchange,
      guardian: { status, reasonCodes: ["RESTORED"] }, requestedAtUtc: makeWp17Bar(1).barCloseTime,
      cancelLatencyMs: model.cancelLatencyMs });
    cancel();
    const checkpoint = exchange.buildCheckpointSlice();
    cancel();
    expect(exchange.buildCheckpointSlice()).toEqual(checkpoint);
    expect(exchange.listOpenOrders().find(entry => entry.order.id === "sell")?.pendingCancel).toBeUndefined();
    const restored = createHistoricalSimulatedExchange(model);
    restored.restoreFromCheckpointSlice(checkpoint, orders);
    await advance(restored, 2);
    expect(cancelled).toEqual(["buy"]);
    expect(filled).toEqual(["buy", "sell"]);
    expect(restored.listOpenOrders().some(entry => entry.order.id === "buy")).toBe(false);
  });
});
