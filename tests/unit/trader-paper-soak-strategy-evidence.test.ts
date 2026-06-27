import { describe, expect, it } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { LIQUIDITY_SWEEP_REVERSAL_V0, MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  buildSoakStrategyEvidence,
  SOAK_STRATEGY_EVIDENCE_SCHEMA_VERSION,
} from "@/lib/trader/paper/build-soak-strategy-evidence";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000337e";
const ACCOUNT_KEY = "acct-paper-loop";
const EXPORTED_AT = new Date("2026-06-22T12:00:00.000Z");

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">): OrderRow {
  return {
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol: "BTC/USDT",
    side: "buy",
    type: "market",
    price: null,
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "64000",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-337",
    strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId: ORG,
    ...overrides,
  };
}

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}`,
    organizationId: ORG,
    orderId,
    exchangeTradeId: overrides.exchangeTradeId ?? `trade-${orderId}`,
    price: overrides.price ?? "64000",
    quantity: overrides.quantity ?? "0.01",
    fee: overrides.fee ?? "0",
    feeAsset: overrides.feeAsset ?? "USDT",
    executedAt: overrides.executedAt ?? new Date(150),
    createdAt: overrides.createdAt ?? new Date(150),
  };
}

function mockRepository(
  orders: OrderRow[],
  fillsByOrderId: Record<string, FillRow[]> = {},
): OrderRepository {
  for (const order of orders) {
    if (!fillsByOrderId[order.id]) {
      fillsByOrderId[order.id] = [mockFill(order.id)];
    }
  }

  return {
    createOrder: async () => {
      throw new Error("not implemented");
    },
    getOrderById: async () => null,
    findOrderByClientOrderId: async () => null,
    findOrderByIdempotencyKey: async () => null,
    listOpenOrders: async () => [],
    listOrders: async (context) =>
      orders.filter((order) => order.organizationId === context.organizationId),
    transitionOrder: async () => {
      throw new Error("not implemented");
    },
    recordFill: async () => {
      throw new Error("not implemented");
    },
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

async function buildEvidence(options: {
  orders?: OrderRow[];
  fillsByOrderId?: Record<string, FillRow[]>;
  strategySignalIds?: string[];
  window?: { start: Date; end: Date };
}) {
  return buildSoakStrategyEvidence({
    context: requireOrgContext(ORG),
    orderRepository: mockRepository(options.orders ?? [], options.fillsByOrderId),
    window: options.window ?? { start: new Date(100), end: new Date(200) },
    strategySignalIds: options.strategySignalIds ?? [
      LIQUIDITY_SWEEP_REVERSAL_V0,
      MEAN_REVERSION_V0,
    ],
    executionMode: "mock",
    accountKey: ACCOUNT_KEY,
    exportedAt: EXPORTED_AT,
  });
}

describe("buildSoakStrategyEvidence (S0 / DEE-337)", () => {
  it("passes when both strategies have closed trades in the window", async () => {
    const evidence = await buildEvidence({
      orders: [
        mockOrder({
          id: "liq-buy",
          strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
          side: "buy",
          avgFillPrice: "100",
        }),
        mockOrder({
          id: "liq-sell",
          strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
          side: "sell",
          avgFillPrice: "110",
        }),
        mockOrder({
          id: "mr-buy",
          strategySignalId: MEAN_REVERSION_V0,
          side: "buy",
          avgFillPrice: "200",
        }),
        mockOrder({
          id: "mr-sell",
          strategySignalId: MEAN_REVERSION_V0,
          side: "sell",
          avgFillPrice: "210",
        }),
      ],
    });

    expect(evidence.schemaVersion).toBe(SOAK_STRATEGY_EVIDENCE_SCHEMA_VERSION);
    expect(evidence.accountKey).toBe(ACCOUNT_KEY);
    expect(evidence.closedTradeEvidenceReady).toBe(true);
    expect(evidence.strategiesWithZeroClosedTrades).toHaveLength(0);
    expect(evidence.blockingReasons).toHaveLength(0);
    expect(evidence.strategyCounts).toEqual([
      { strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0, closedTradeCount: 1 },
      { strategySignalId: MEAN_REVERSION_V0, closedTradeCount: 1 },
    ]);
    expect(evidence.exportDocument.envelope.contentDigest.length).toBeGreaterThan(0);
  });

  it("fails when one required strategy has zero closed trades", async () => {
    const evidence = await buildEvidence({
      orders: [
        mockOrder({
          id: "liq-buy",
          strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
          side: "buy",
          avgFillPrice: "100",
        }),
        mockOrder({
          id: "liq-sell",
          strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
          side: "sell",
          avgFillPrice: "110",
        }),
      ],
    });

    expect(evidence.closedTradeEvidenceReady).toBe(false);
    expect(evidence.strategiesWithZeroClosedTrades).toEqual([MEAN_REVERSION_V0]);
    expect(evidence.strategyCounts).toEqual([
      { strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0, closedTradeCount: 1 },
      { strategySignalId: MEAN_REVERSION_V0, closedTradeCount: 0 },
    ]);
    expect(evidence.blockingReasons.some((reason) => reason.includes(MEAN_REVERSION_V0))).toBe(
      true,
    );
  });

  it("excludes fills outside the half-open window boundary", async () => {
    const evidence = await buildEvidence({
      strategySignalIds: [LIQUIDITY_SWEEP_REVERSAL_V0],
      orders: [
        mockOrder({
          id: "boundary-buy",
          strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
          side: "buy",
          avgFillPrice: "100",
        }),
        mockOrder({
          id: "boundary-sell",
          strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0,
          side: "sell",
          avgFillPrice: "110",
        }),
      ],
      fillsByOrderId: {
        "boundary-buy": [mockFill("boundary-buy", { executedAt: new Date(100) })],
        "boundary-sell": [mockFill("boundary-sell", { executedAt: new Date(200) })],
      },
      window: { start: new Date(100), end: new Date(200) },
    });

    expect(evidence.closedTradeEvidenceReady).toBe(false);
    expect(evidence.strategyCounts).toEqual([
      { strategySignalId: LIQUIDITY_SWEEP_REVERSAL_V0, closedTradeCount: 0 },
    ]);
  });

  it("fails on an empty book with zero closed trades for every strategy", async () => {
    const evidence = await buildEvidence({ orders: [] });

    expect(evidence.closedTradeEvidenceReady).toBe(false);
    expect(evidence.strategiesWithZeroClosedTrades).toEqual([
      LIQUIDITY_SWEEP_REVERSAL_V0,
      MEAN_REVERSION_V0,
    ]);
    expect(evidence.strategyCounts.every((entry) => entry.closedTradeCount === 0)).toBe(true);
  });
});
