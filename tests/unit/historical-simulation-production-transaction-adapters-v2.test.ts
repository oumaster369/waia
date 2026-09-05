import { describe, expect, it, vi } from "vitest";

import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { OrderRepository, OrderRow } from "@/lib/trader/execution/order-repository.types";
import { createHistoricalSimulationExecutionPersistenceV2, persistHistoricalModeledExecutionSubmissionV2 } from
  "@/lib/trader/historical-simulation-v2/production-transaction-adapters-v2";
import { createHistoricalModeledOrderFromReceiptV2 } from
  "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";

const context = { organizationId: "00000000-0000-4000-8000-000000000001" };
const order: OrderRow = { id: "00000000-0000-4000-8000-000000000010", organizationId: context.organizationId,
  credentialId: null, venue: "HISTORICAL_SIMULATED_EXCHANGE", executionMode: "mock", symbol: "BTCUSDT",
  side: "buy", type: "market", price: null, quantity: "1", filledQuantity: "0", avgFillPrice: null,
  state: "CREATED", stateVersion: 1, exchangeOrderId: null, clientOrderId: "hsv2-attempt",
  idempotencyKey: "hsv2-order", riskDecisionId: "decision", riskAllowanceId: "allowance",
  riskAllowanceBindingDigest: "a".repeat(64), strategySignalId: null, allocationDecisionId: "decision",
  createdAt: new Date("2026-08-30T10:00:00.000Z"), updatedAt: new Date("2026-08-30T10:00:00.000Z") };

describe("historical simulation production transaction adapters v2", () => {
  it("persists an exact credential-free modeled submission before exchange registration", async () => {
    const receipt = { schemaVersion: "waia.trader.historical_modeled_execution.v2" as const,
      source: "MODELED_HISTORICAL" as const, capitalEligible: false as const,
      executionPlanId: "plan", executionPlanContentDigestHex: "1".repeat(64), executionAttemptId: "attempt",
      executionAttemptContentDigestHex: "2".repeat(64), orderId: order.id,
      orderContentDigestHex: "3".repeat(64), decisionId: "decision", decisionContentDigestHex: "4".repeat(64),
      riskVerdictId: "risk-verdict",
      riskReceiptContentDigestHex: "5".repeat(64), symbol: "BTCUSDT", side: "buy" as const, quantity: "1",
      decisionBarIndex: 0, acceptedAtUtc: order.createdAt.toISOString(), contentDigestHex: "6".repeat(64) };
    const expected = createHistoricalModeledOrderFromReceiptV2({ organizationId: context.organizationId,
      accountId: "account", runId: "run", decisionId: "decision", allowanceId: "allowance", receipt });
    const persisted = { ...expected, riskAllowanceId: null, riskAllowanceBindingDigest: null };
    const createOrder = vi.fn(async () => persisted);
    const accepted = { ...persisted, state: "ACCEPTED" as const, stateVersion: 4 };
    const transitionOrder = vi.fn(async (_context, transition: { toState: OrderRow["state"] }) => ({
      ...persisted, state: transition.toState,
      stateVersion: transition.toState === "RISK_APPROVED" ? 2 : transition.toState === "SENT_TO_EXCHANGE" ? 3 : 4,
    }));
    await expect(persistHistoricalModeledExecutionSubmissionV2({ context,
      orders: { createOrder, transitionOrder } as unknown as OrderRepository, organizationId: context.organizationId,
      accountId: "account", runId: "run", decisionId: "decision", riskAllowanceId: "allowance", receipt }))
      .resolves.toEqual(accepted);
    expect(createOrder).toHaveBeenCalledWith(context, expect.objectContaining({ id: order.id,
      credentialId: null, executionMode: "mock", venue: "HISTORICAL_SIMULATED_EXCHANGE" }));
  });

  it("persists a first modeled fill through the supplied transaction-bound order repository", async () => {
    const filled = { ...order, state: "FILLED" as const, stateVersion: 2, filledQuantity: "1", avgFillPrice: "100" };
    const transitionOrder = vi.fn(async () => filled);
    const recordFill = vi.fn(async () => ({ id: "fill", organizationId: context.organizationId,
      orderId: order.id, exchangeTradeId: "trade", price: "100", quantity: "1", fee: "0",
      feeAsset: "USDT", executedAt: new Date("2026-08-30T10:01:00.000Z"), createdAt: new Date() }));
    const orders = { transitionOrder, recordFill } as unknown as OrderRepository;
    const persistence = createHistoricalSimulationExecutionPersistenceV2({ orders,
      model: createHistoricalExecutionModelV1() });
    const result = await persistence.recordSimulatedFill(context, order, { orderId: order.id,
      organizationId: context.organizationId, symbol: "BTCUSDT", side: "buy", fillSequence: 1,
      sourceBarIndex: 1, sourceBar: { symbol: "BTCUSDT", interval: "1m", open: "99", high: "101",
        low: "98", close: "100", volume: "10", barOpenTime: "2026-08-30T10:00:00.000Z",
        barCloseTime: "2026-08-30T10:01:00.000Z" }, grossFillPrice: "100", sliceQuantity: "1",
      remainingQuantityAfter: "0", acceptedAt: order.createdAt,
      fillTimestamp: new Date("2026-08-30T10:01:00.000Z"), submitLatencyMs: 0, cancelLatencyMs: null }, true);
    expect(result).toEqual(filled);
    expect(transitionOrder).toHaveBeenCalledWith(context, expect.objectContaining({ orderId: order.id,
      expectedStateVersion: 1, toState: "FILLED", filledQuantity: "1" }));
    expect(recordFill).toHaveBeenCalledWith(context, expect.objectContaining({ orderId: order.id,
      fillId: expect.any(String), executionFactKind: "HISTORICAL_SIMULATED_FILL_V1" }));
  });

  it("uses the exact two-step modeled cancellation and rejects a wrong requested-state shortcut", async () => {
    const requested = { ...order, state: "CANCEL_REQUESTED" as const, stateVersion: 2 };
    const cancelled = { ...requested, state: "CANCELLED" as const, stateVersion: 3 };
    const transitionOrder = vi.fn().mockResolvedValueOnce(requested).mockResolvedValueOnce(cancelled);
    const persistence = createHistoricalSimulationExecutionPersistenceV2({
      orders: { transitionOrder } as unknown as OrderRepository, model: createHistoricalExecutionModelV1() });
    await expect(persistence.transitionOrderCancelled(context, order)).resolves.toEqual(cancelled);
    expect(transitionOrder).toHaveBeenNthCalledWith(1, context, expect.objectContaining({ toState: "CANCEL_REQUESTED" }));
    expect(transitionOrder).toHaveBeenNthCalledWith(2, context, expect.objectContaining({ toState: "CANCELLED",
      expectedStateVersion: 2 }));
    expect(() => persistence.transitionOrderCancelledFromRequested!(context, order))
      .toThrow("CANCEL_STATE");
  });
});
