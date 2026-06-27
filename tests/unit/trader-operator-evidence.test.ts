import { describe, expect, it } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import {
  OperatorEvidenceError,
  parsePaperEvaluationExportDocument,
  summarizePaperEvidence,
} from "@/lib/trader/validation-gate/operator-evidence";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000277e";
const SIGNAL = "signal-277-ev";

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
    riskDecisionId: "risk-277",
    strategySignalId: SIGNAL,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId: ORG,
    ...overrides,
  };
}

function mockFill(orderId: string): FillRow {
  return {
    id: `fill-${orderId}`,
    organizationId: ORG,
    orderId,
    exchangeTradeId: `trade-${orderId}`,
    price: "64000",
    quantity: "0.01",
    fee: "0",
    feeAsset: "USDT",
    executedAt: new Date(150),
    createdAt: new Date(150),
  };
}

function mockRepository(orders: OrderRow[]): OrderRepository {
  const fillsByOrderId: Record<string, FillRow[]> = {};
  for (const order of orders) {
    fillsByOrderId[order.id] = [mockFill(order.id)];
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

async function buildDocument(options: {
  executionMode: PaperBookExecutionMode;
  strategySignalIds?: string[];
  withTrades?: boolean;
}) {
  const orders = options.withTrades
    ? [
        mockOrder({ id: "ev-buy", avgFillPrice: "100" }),
        mockOrder({ id: "ev-sell", side: "sell", avgFillPrice: "110" }),
      ]
    : [];
  return buildPaperEvaluationExportDocument({
    context: requireOrgContext(ORG),
    orderRepository: mockRepository(orders),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: options.strategySignalIds ?? [SIGNAL],
    executionMode: options.executionMode,
    exportedAt: new Date("2026-06-18T12:00:00.000Z"),
  });
}

describe("operator evidence (DEE-277 S1)", () => {
  it("summarizes a clean paper window with fills as sufficient", async () => {
    const document = await buildDocument({ executionMode: "paper", withTrades: true });
    const summary = summarizePaperEvidence(document);

    expect(summary.executionMode).toBe("paper");
    expect(summary.reconciliationStatus).toBe("clean");
    expect(summary.closedTradeCount).toBeGreaterThan(0);
    expect(summary.strategiesWithNoFills).toHaveLength(0);
    expect(summary.insufficientEvidence).toBe(false);
    expect(summary.insufficientReasons).toHaveLength(0);
  });

  it("flags mock evidence as insufficient (advisory) without failing", async () => {
    const document = await buildDocument({ executionMode: "mock", withTrades: true });
    const summary = summarizePaperEvidence(document);

    expect(summary.insufficientEvidence).toBe(true);
    expect(summary.insufficientReasons.some((r) => r.includes("mock"))).toBe(true);
  });

  it("flags no-fill strategies and zero closed trades as insufficient", async () => {
    const document = await buildDocument({
      executionMode: "paper",
      strategySignalIds: [SIGNAL, "signal-277-empty"],
      withTrades: false,
    });
    const summary = summarizePaperEvidence(document);

    expect(summary.strategiesWithNoFills.length).toBeGreaterThan(0);
    expect(summary.closedTradeCount).toBe(0);
    expect(summary.insufficientEvidence).toBe(true);
  });

  it("parses a serialized document round-trip", async () => {
    const document = await buildDocument({ executionMode: "paper", withTrades: true });
    const parsed = parsePaperEvaluationExportDocument(JSON.stringify(document));
    expect(parsed.envelope.contentDigest).toBe(document.envelope.contentDigest);
  });

  it("rejects malformed JSON", () => {
    expect(() => parsePaperEvaluationExportDocument("{not json")).toThrowError(
      OperatorEvidenceError,
    );
  });

  it("rejects a non-object document", () => {
    expect(() => parsePaperEvaluationExportDocument("[]")).toThrowError(OperatorEvidenceError);
  });

  it("rejects schema-version drift", async () => {
    const document = await buildDocument({ executionMode: "paper", withTrades: true });
    const tampered = { ...document, schemaVersion: "waia.trader.paper-evaluation-export.v999" };
    let code: string | undefined;
    try {
      parsePaperEvaluationExportDocument(JSON.stringify(tampered));
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("OPERATOR_EVIDENCE_SCHEMA_MISMATCH");
  });
});
