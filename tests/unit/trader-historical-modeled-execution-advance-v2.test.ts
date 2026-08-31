import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { assertHistoricalSimulationFillDetailParityV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";

import { createAccountingFrontierRepositoryMemory } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { advanceAccountingFrontier, createInitialAccountingState } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  assertHistoricalMarketCycleV2,
  createAdvanceHistoricalModeledExecutionV2,
  sealHistoricalMarketCycleV2,
} from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import { createHistoricalModeledExecutionRegistryV2 } from "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

const observedAt = "2026-08-30T10:01:00.000Z";

function order(): OrderRow {
  return {
    id: "order-1", organizationId: "org-1", credentialId: null,
    venue: "HISTORICAL_SIMULATED_EXCHANGE", executionMode: "mock", symbol: "BTCUSDT",
    side: "buy", type: "market", price: null, quantity: "0.1", filledQuantity: "0",
    avgFillPrice: null, state: "CREATED", stateVersion: 1, exchangeOrderId: null,
    clientOrderId: "client-1", idempotencyKey: "key-1", riskDecisionId: "risk-1",
    riskAllowanceId: "allowance-1", riskAllowanceBindingDigest: "a".repeat(64),
    strategySignalId: null, allocationDecisionId: null,
    createdAt: new Date("2026-08-30T10:00:00.000Z"), updatedAt: new Date("2026-08-30T10:00:00.000Z"),
  };
}

describe("historical modeled execution advance v2", () => {
  it("seals the exact qualified market input, applies modeled fill economics and advances accounting", async () => {
    const receipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      qualifiedAtUtc: "2026-08-30T09:00:00.000Z",
      rows: [{ id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 5 }],
    });
    const market = sealHistoricalMarketCycleV2({
      cycleId: "cycle-1", barIndex: 1,
      closedBar: { symbol: "BTCUSDT", interval: "1m", open: "100", high: "101", low: "99", close: "100", volume: "10", barOpenTime: "2026-08-30T10:00:00.000Z", barCloseTime: observedAt },
      htxVolumeAuthorityReceipt: receipt,
      htxVolumeRaw: { amount: 10, vol: 1000 },
    });
    assertHistoricalMarketCycleV2(market, "cycle-1");
    expect(() => assertHistoricalMarketCycleV2({ ...market, barIndex: 2 }, "cycle-1")).toThrow("HISTORICAL_SEALED_MARKET_CYCLE_V2_INVALID");

    const repository = createAccountingFrontierRepositoryMemory();
    const committedBundles: unknown[] = [];
    const sourceOrder = order();
    const executionRegistry = createHistoricalModeledExecutionRegistryV2();
    executionRegistry.register({
      schemaVersion: "waia.trader.historical_modeled_execution.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false,
      executionPlanId: "plan-1", executionPlanContentDigestHex: "1".repeat(64),
      executionAttemptId: "attempt-1", executionAttemptContentDigestHex: "2".repeat(64), orderId: sourceOrder.id,
      orderContentDigestHex: "d".repeat(64),
      decisionId: "decision-0", decisionContentDigestHex: "c".repeat(64),
      riskReceiptContentDigestHex: "a".repeat(64), symbol: "BTCUSDT", side: "buy", quantity: "0.1",
      decisionBarIndex: 0, acceptedAtUtc: sourceOrder.createdAt.toISOString(), contentDigestHex: "b".repeat(64),
    });
    const currentOrder = { ...sourceOrder, id: "order-current", allocationDecisionId: "decision-current" };
    executionRegistry.register({
      schemaVersion: "waia.trader.historical_modeled_execution.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false,
      executionPlanId: "plan-current", executionPlanContentDigestHex: "3".repeat(64),
      executionAttemptId: "attempt-current", executionAttemptContentDigestHex: "4".repeat(64), orderId: currentOrder.id,
      orderContentDigestHex: "e".repeat(64), decisionId: "decision-current",
      decisionContentDigestHex: "f".repeat(64), riskReceiptContentDigestHex: "a".repeat(64),
      symbol: "BTCUSDT", side: "buy", quantity: "0.1", decisionBarIndex: 1,
      acceptedAtUtc: observedAt, contentDigestHex: "9".repeat(64),
    });
    const model = createHistoricalExecutionModelV1();
    let openOrderReads = 0;
    const exchange = {
      listOpenOrders: () => openOrderReads++ === 0 ? [{ order: sourceOrder }, { order: currentOrder }] : [],
      async advanceOnClosedBar(input: Parameters<import("@/lib/trader/execution/historical-simulated-exchange").HistoricalSimulatedExchange["advanceOnClosedBar"]>[0]) {
        const event = {
          orderId: sourceOrder.id, organizationId: "org-1", symbol: "BTCUSDT", side: "buy" as const,
          fillSequence: 1, sourceBarIndex: market.barIndex, sourceBar: market.closedBar,
          grossFillPrice: "100", sliceQuantity: "0.1", remainingQuantityAfter: "0",
          acceptedAt: sourceOrder.createdAt, fillTimestamp: new Date(observedAt), submitLatencyMs: 50, cancelLatencyMs: null,
        };
        await input.persistence.recordSimulatedFill(input.context, sourceOrder, event, true);
        return { fillEvents: [event], accountState: await input.refreshAccountState() };
      },
    } as unknown as import("@/lib/trader/execution/historical-simulated-exchange").HistoricalSimulatedExchange;
    const initial = advanceAccountingFrontier({
      state: createInitialAccountingState({ organizationId: "org-1", accountKey: "account-1", runId: "run-1", startingCash: "1000" }),
      marks: { BTCUSDT: { price: "100", barCloseTime: "2026-08-30T10:00:00.000Z" } },
      frontierAsOf: "2026-08-30T10:00:00.000Z",
    });
    const advance = createAdvanceHistoricalModeledExecutionV2({
      context: { organizationId: "org-1" }, accountKey: "account-1", runId: "run-1",
      exchange, executionRegistry, model,
      persistence: {
        async recordSimulatedFill(_context, current, event) { return { ...current, filledQuantity: event.sliceQuantity, avgFillPrice: event.grossFillPrice, state: "FILLED", stateVersion: 2 }; },
        async transitionOrderExpired(_context, current) { return current; },
        async transitionOrderCancelled(_context, current) { return current; },
      },
      accountingRepository: repository,
      resolveMarketCycle: async () => market,
      initialAccountingFrontier: async () => initial,
      refreshAccountState: async () => ({ positions: [], openOrderCount: 0, dailyPnl: "0", drawdown: "0", quoteExposureByCurrency: {} }),
      reconcileOrder: async () => undefined,
      persistAdvanceEvidence: async (value) => { committedBundles.push(value); },
    });
    const result = await advance("cycle-1");
    expect(result.fillCount).toBe(1);
    expect(result.fillDetails).toEqual([expect.objectContaining({
      evidence: result.fillEvidence[0],
      event: expect.objectContaining({ orderId: "order-1", sliceQuantity: "0.1", fillSequence: 1,
        acceptedAt: sourceOrder.createdAt.toISOString(), fillTimestamp: observedAt }),
      economics: expect.objectContaining({ quantity: "0.1", grossFillPrice: "100",
        economicsContentDigest: result.fillEvidence[0]!.economicsContentDigestHex }),
      contentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
    })]);
    const detail = result.fillDetails[0]!;
    expect(() => assertHistoricalSimulationFillDetailParityV2({ organizationId: "org-1", cycleId: "cycle-1",
      orderId: "order-1", symbol: "BTCUSDT", side: "buy", evidence: detail.evidence,
      detail, consumedFillIds: detail.accountingFrontier.consumedFillIds })).not.toThrow();
    const divergentBody = { ...detail, event: { ...detail.event, sliceQuantity: "0.2" } };
    delete (divergentBody as { contentDigestHex?: string }).contentDigestHex;
    const divergent = { ...divergentBody, contentDigestHex: computeSemanticSha256Hex(divergentBody) };
    expect(() => assertHistoricalSimulationFillDetailParityV2({ organizationId: "org-1", cycleId: "cycle-1",
      orderId: "order-1", symbol: "BTCUSDT", side: "buy", evidence: detail.evidence,
      detail: divergent, consumedFillIds: detail.accountingFrontier.consumedFillIds })).toThrow("MODELED_FILL_DETAIL_SOURCE");
    expect(result.effects).toEqual([expect.objectContaining({
      cycleId: "cycle-1", orderId: "order-1", executionPlanId: "plan-1", status: "FILLED",
      decisionId: "decision-0", decisionContentDigestHex: "c".repeat(64),
      fillEvidenceContentDigestHexes: [result.fillEvidence[0]!.contentDigestHex],
      reportContentDigestHexes: [expect.stringMatching(/^[0-9a-f]{64}$/)],
    })]);
    expect(result.effects.some((effect) => effect.orderId === "order-current")).toBe(false);
    expect(committedBundles).toHaveLength(1);
    const frontier = await repository.loadLatest({ organizationId: "org-1" }, { accountKey: "account-1", runId: "run-1" });
    expect(frontier?.positions.BTCUSDT?.quantity).toBe("0.1");
    expect(frontier?.cash).not.toBe("1000");
    expect(result.accountingFrontierContentDigestHex).toMatch(/^[0-9a-f]{64}$/);
  });
});
