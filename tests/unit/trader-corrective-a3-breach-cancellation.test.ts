import { describe, expect, it, vi } from "vitest";

import {
  HTR_GUARDIAN_EXIT_REASON_V1,
  resolveDrawdownBreachState,
} from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import {
  cancelPendingEntryOrdersDeterministic,
  executeBreachPartialEntryCancellation,
  isPendingEntryOrderForCancellation,
  listPendingEntryOrdersForCancellation,
} from "@/lib/trader/guardian/htr-breach-partial-entry-cancellation";
import {
  evaluateHtrGuardianCycle,
  requiresHtrPartialEntryCancellation,
} from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { createInitialAccountingState } from "@/lib/trader/accounting";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";

function makeOrder(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id" | "symbol" | "side">,
): OrderRow {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    organizationId: "org-a3",
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    type: "market",
    price: null,
    quantity: "1.0",
    filledQuantity: "0",
    avgFillPrice: null,
    state: "ACCEPTED",
    stateVersion: 4,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-a3",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("trader corrective A3 breach cancellation", () => {
  it("invokes consumer when cancelPartialEntry is true", async () => {
    const cancelOrder = vi.fn(async () => ({
      status: "cancel_requested" as const,
      order: makeOrder({ id: "o1", symbol: "BTCUSDT", side: "buy" }),
    }));
    const state = createInitialAccountingState({
      organizationId: "org-a3",
      accountKey: "acct",
      runId: "run",
    });
    state.equity = "50000";
    state.accountDrawdownBps = DEFAULT_D20_DRAWDOWN_POLICY.accountBps + 1;
    const drawdownState = normalizeAccountingStateDrawdownFields(state);
    const guardianCycle = evaluateHtrGuardianCycle({
      reconciliation: {
        state,
        startingEquityUsdt: "100000",
        startingCashUsdt: "100000",
      },
      accountPeakHwm: drawdownState.equityHwm,
      monthlyPeakHwm: drawdownState.monthlyPeakHwm,
      equityUsdt: state.equity,
    });

    expect(requiresHtrPartialEntryCancellation(guardianCycle)).toBe(true);

    const result = await executeBreachPartialEntryCancellation({
      context: { organizationId: "org-a3" },
      guardianCycle,
      openOrders: [makeOrder({ id: "o1", symbol: "BTCUSDT", side: "buy" })],
      cancelOrder,
    });

    expect(cancelOrder).toHaveBeenCalledTimes(1);
    expect(result.cancelledOrderIds).toEqual(["o1"]);
    expect(result.breachCancellationFailed).toBe(false);
  });

  it("skips consumer when cancelPartialEntry is false", async () => {
    const cancelOrder = vi.fn();
    const state = createInitialAccountingState({
      organizationId: "org-a3",
      accountKey: "acct",
      runId: "run",
    });
    const drawdownState = normalizeAccountingStateDrawdownFields(state);
    const guardianCycle = evaluateHtrGuardianCycle({
      reconciliation: {
        state,
        startingEquityUsdt: "100000",
        startingCashUsdt: "100000",
      },
      accountPeakHwm: drawdownState.equityHwm,
      monthlyPeakHwm: drawdownState.monthlyPeakHwm,
      equityUsdt: state.equity,
    });

    const result = await executeBreachPartialEntryCancellation({
      context: { organizationId: "org-a3" },
      guardianCycle,
      openOrders: [makeOrder({ id: "o1", symbol: "BTCUSDT", side: "buy" })],
      cancelOrder,
    });

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(result.cancelledOrderIds).toEqual([]);
  });

  it("treats re-cancel as idempotent", async () => {
    const cancelOrder = vi.fn();
    const result = await cancelPendingEntryOrdersDeterministic({
      context: { organizationId: "org-a3" },
      orders: [
        makeOrder({
          id: "o-cancel-req",
          symbol: "BTCUSDT",
          side: "buy",
          state: "CANCEL_REQUESTED",
        }),
      ],
      cancelOrder,
    });

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(result.idempotentSkipped).toEqual(["o-cancel-req"]);
  });

  it("cancels pending entries in deterministic order", async () => {
    const seen: string[] = [];
    const cancelOrder = vi.fn(async (_context, order) => {
      seen.push(order.id);
      return { status: "cancelled" as const, order };
    });

    const orders = [
      makeOrder({ id: "z-order", symbol: "ETHUSDT", side: "buy" }),
      makeOrder({ id: "a-order", symbol: "BTCUSDT", side: "buy" }),
      makeOrder({ id: "m-order", symbol: "BTCUSDT", side: "buy" }),
    ];

    const pending = listPendingEntryOrdersForCancellation(orders);
    expect(pending.map((order) => order.id)).toEqual(["a-order", "m-order", "z-order"]);

    const result = await cancelPendingEntryOrdersDeterministic({
      context: { organizationId: "org-a3" },
      orders: pending,
      cancelOrder,
    });

    expect(seen).toEqual(["a-order", "m-order", "z-order"]);
    expect(result.deterministicOrder).toEqual(["a-order", "m-order", "z-order"]);
  });

  it("cancels partial entry remainder while preserving filled quantity", async () => {
    const partial = makeOrder({
      id: "partial-entry",
      symbol: "BTCUSDT",
      side: "buy",
      quantity: "1.0",
      filledQuantity: "0.4",
      avgFillPrice: "50000",
      state: "PARTIALLY_FILLED",
    });

    expect(isPendingEntryOrderForCancellation(partial)).toBe(true);

    const cancelOrder = vi.fn(async (_context, order) => ({
      status: "cancel_requested" as const,
      order,
    }));

    const result = await cancelPendingEntryOrdersDeterministic({
      context: { organizationId: "org-a3" },
      orders: [partial],
      cancelOrder,
    });

    expect(result.cancelledOrderIds).toEqual(["partial-entry"]);
    expect(cancelOrder.mock.calls[0]?.[1].filledQuantity).toBe("0.4");
  });

  it("does not cancel reduce-only exit sells", () => {
    const exitSell = makeOrder({
      id: "exit-sell",
      symbol: "BTCUSDT",
      side: "sell",
      state: "ACCEPTED",
    });

    expect(
      isPendingEntryOrderForCancellation(exitSell, {
        BTCUSDT: "0.5",
      }),
    ).toBe(false);
    expect(listPendingEntryOrdersForCancellation([exitSell], { BTCUSDT: "0.5" })).toEqual([]);
  });

  it("cancels on account and strategy breach states", () => {
    const accountBreach = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps + 1,
      monthlyDrawdownBps: 0,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(accountBreach.breachState).toBe("STOP_ACCOUNT");
    expect(accountBreach.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach);

    const strategyBreach = resolveDrawdownBreachState({
      accountDrawdownBps: 0,
      monthlyDrawdownBps: 0,
      strategyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(strategyBreach.breachState).toBe("CLOSE_ONLY");
    expect(strategyBreach.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownEquality);

    const strategyHardBreach = resolveDrawdownBreachState({
      accountDrawdownBps: 0,
      monthlyDrawdownBps: 0,
      strategyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps + 1,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(strategyHardBreach.breachState).toBe("STOP_ACCOUNT");
    expect(strategyHardBreach.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownBreach);

    for (const breachState of ["STOP_ACCOUNT", "CLOSE_ONLY"] as const) {
      expect(
        requiresHtrPartialEntryCancellation({
          breachState,
          reason: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach,
          allowNewExposure: false,
          cancelPartialEntry: true,
          permitRiskReducingExit: true,
        }),
      ).toBe(true);
    }
  });
});
