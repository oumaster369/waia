import { describe, expect, it, vi } from "vitest";

import { buildProductionKnowledgeAsset } from "@/lib/trader/knowledge/build-production-knowledge-asset";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1 } from "@/lib/trader/research/strategy-candidate.types";
import { assembleStrategyPromotionRecord } from "@/lib/trader/validation-gate";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000272";
const EXPORTED_AT = new Date("2026-06-18T12:00:00.000Z");

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">): OrderRow {
  return {
    credentialId: null,
    venue: "mock",
    executionMode: "paper",
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
    strategySignalId: "mean_reversion_v0",
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
    executedAt: new Date(0),
    createdAt: new Date(0),
  };
}

function mockRepository(orders: OrderRow[]): OrderRepository {
  const fillsByOrderId: Record<string, FillRow[]> = {};
  for (const order of orders) {
    fillsByOrderId[order.id] = [mockFill(order.id)];
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

describe("RI-P7 promotion rehearsal", () => {
  it("accepts paper export + research evidence while PKA remains vault-only", async () => {
    const researchEvidence = buildValidResearchEvidenceDocument(ORG);
    const buy = mockOrder({ id: "buy-1", avgFillPrice: "100" });
    const sell = mockOrder({ id: "sell-1", side: "sell", avgFillPrice: "110" });
    const paperDocument = await buildPaperEvaluationExportDocument({
      context: requireOrgContext(ORG),
      orderRepository: mockRepository([buy, sell]),
      window: { start: new Date(100), end: new Date(200) },
      strategySignalIds: ["mean_reversion_v0"],
      executionMode: "paper",
      exportedAt: EXPORTED_AT,
    });

    const record = assembleStrategyPromotionRecord({
      organizationId: ORG,
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
      hypothesis: "Mean reversion in range",
      intendedRegime: "RANGE",
      costModel: { feesBps: "10", slippageBps: "5" },
      failureModes: ["liquidity vacuum"],
      reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
      paperTradingEvidenceDocument: paperDocument,
      researchEvidenceDocument: researchEvidence,
      confidenceAttestation: {
        edgeNetOfCosts: "Net edge after costs.",
        liveTracksPaper: "Live should track paper.",
        downsideRiskBounded: "Risk engine caps downside.",
      },
    });

    expect(record.researchEvidence.contentDigest).toBe(researchEvidence.envelope.contentDigest);

    const pka = buildProductionKnowledgeAsset({
      evidenceDocument: researchEvidence,
      dataset: {
        id: researchEvidence.evidenceBody.datasetId,
        organizationId: ORG,
        name: "ri-p7",
        symbol: "BTC/USDT",
        interval: "1m",
        trainBarCount: 100,
        validationBarCount: 30,
        blindBarCount: 30,
        trainDigest: "t",
        validationDigest: "v",
        blindDigest: "b",
        metadataJson: "{}",
        sealedAt: new Date("2026-06-18T12:00:00.000Z"),
        createdAt: new Date("2026-06-18T12:00:00.000Z"),
      },
      barSetDigest: "bars",
      barCount: 43200,
      symbol: "BTC/USDT",
      interval: "1m",
      walkForwardWindowCount: 3,
      blindMetrics: {
        schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
        tradeCount: 2,
        periodRealizedPnl: "1",
        periodTotalFees: "0",
        byRegime: [],
      },
      mkbLinkage: {
        marketEventId: "me-1",
        knowledgeEdgeId: "ke-1",
      },
      edgeConfidence: "0.7500",
      edgeStrength: "0.5000",
      edgeVerified: true,
    });

    expect(pka.knowledgeId).toMatch(/^[a-f0-9]{64}$/);
    expect(pka.evidenceRef.contentDigest).toBe(researchEvidence.envelope.contentDigest);
  });
});
