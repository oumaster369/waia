import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
import {
  assembleStrategyPromotionRecord,
  StrategyPromotionValidationError,
} from "@/lib/trader/validation-gate";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_A = "00000000-0000-4000-8000-0000000272";
const STRATEGY_SIGNAL = "signal-272-a";
const EXPORTED_AT = new Date("2026-06-18T12:00:00.000Z");

function mockOrder(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id">,
  organizationId = ORG_A,
): OrderRow {
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
    riskDecisionId: "risk-272",
    strategySignalId: STRATEGY_SIGNAL,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    organizationId,
    ...overrides,
  };
}

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}`,
    organizationId: ORG_A,
    orderId,
    exchangeTradeId: overrides.exchangeTradeId ?? `trade-${orderId}`,
    price: overrides.price ?? "64000",
    quantity: overrides.quantity ?? "0.01",
    fee: overrides.fee ?? "0",
    feeAsset: overrides.feeAsset ?? "USDT",
    executedAt: overrides.executedAt ?? new Date(0),
    createdAt: overrides.createdAt ?? new Date(0),
  };
}

function mockRepository(orders: OrderRow[]): OrderRepository {
  const fillsByOrderId: Record<string, FillRow[]> = {};
  for (const order of orders) {
    fillsByOrderId[order.id] = [
      mockFill(order.id, {
        quantity: order.filledQuantity,
        price: order.avgFillPrice ?? "64000",
      }),
    ];
  }

  return {
    createOrder: vi.fn(),
    getOrderById: vi.fn(),
    findOrderByClientOrderId: vi.fn(),
    findOrderByIdempotencyKey: vi.fn(),
    listOpenOrders: vi.fn(async () => []),
    listOrders: vi.fn(async (context) =>
      orders.filter((order) => order.organizationId === context.organizationId),
    ),
    transitionOrder: vi.fn(),
    recordFill: vi.fn(),
    listEvents: vi.fn(),
    listFills: vi.fn(async (_context, orderId) => fillsByOrderId[orderId] ?? []),
  };
}

async function buildValidEvidenceDocument() {
  const buy = mockOrder({ id: "272-buy", avgFillPrice: "100" });
  const sell = mockOrder({ id: "272-sell", side: "sell", avgFillPrice: "110" });
  return buildPaperEvaluationExportDocument({
    context: requireOrgContext(ORG_A),
    orderRepository: mockRepository([buy, sell]),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: [STRATEGY_SIGNAL],
    executionMode: "paper",
    exportedAt: EXPORTED_AT,
  });
}

function baseAssemblyInput(document: Awaited<ReturnType<typeof buildValidEvidenceDocument>>) {
  return {
    organizationId: ORG_A,
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "5" },
    failureModes: ["liquidity vacuum"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
    paperTradingEvidenceDocument: document,
    researchEvidenceDocument: buildValidResearchEvidenceDocument(ORG_A),
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}

describe("assembleStrategyPromotionRecord (DEE-178 S2)", () => {
  it("assembles a valid promotion record payload", async () => {
    const document = await buildValidEvidenceDocument();
    const payload = assembleStrategyPromotionRecord(baseAssemblyInput(document));

    expect(payload.organizationId).toBe(ORG_A);
    expect(payload.strategyId).toBe("mean_reversion_v0");
    expect(payload.paperTradingEvidence.contentDigest).toBe(document.envelope.contentDigest);
    expect(payload.recordContentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects tampered evidence digest", async () => {
    const document = await buildValidEvidenceDocument();
    document.envelope.contentDigest = "deadbeef".repeat(8);

    expect(() => assembleStrategyPromotionRecord(baseAssemblyInput(document))).toThrow(
      StrategyPromotionValidationError,
    );
  });

  it("rejects org mismatch", async () => {
    const document = await buildValidEvidenceDocument();
    const input = baseAssemblyInput(document);
    input.organizationId = "00000000-0000-4000-8000-0000000999";

    expect(() => assembleStrategyPromotionRecord(input)).toThrow(StrategyPromotionValidationError);
  });

  it("rejects empty confidence attestation", async () => {
    const document = await buildValidEvidenceDocument();
    const input = baseAssemblyInput(document);
    input.confidenceAttestation.edgeNetOfCosts = "   ";

    expect(() => assembleStrategyPromotionRecord(input)).toThrow(StrategyPromotionValidationError);
  });

  it("rejects empty reason-code distribution", async () => {
    const document = await buildValidEvidenceDocument();
    const input = {
      ...baseAssemblyInput(document),
      reasonCodeDistribution: {} as Record<string, number>,
    };

    expect(() => assembleStrategyPromotionRecord(input)).toThrow(StrategyPromotionValidationError);
  });
});
