import { describe, expect, it, vi } from "vitest";

import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import {
  RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
  type ResearchEvidenceDocument,
  type ResearchEvidenceExportBody,
  type ResearchRegimeClass,
} from "@/lib/trader/research/research-evidence-export.types";
import { computeResearchEvidenceExportDigest } from "@/lib/trader/research/serialize-research-evidence-export";
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

async function buildMockEvidenceDocument() {
  const buy = mockOrder({ id: "272-buy", avgFillPrice: "100" });
  const sell = mockOrder({ id: "272-sell", side: "sell", avgFillPrice: "110" });
  return buildPaperEvaluationExportDocument({
    context: requireOrgContext(ORG_A),
    orderRepository: mockRepository([buy, sell]),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: [STRATEGY_SIGNAL],
    executionMode: "mock",
    exportedAt: EXPORTED_AT,
  });
}

function buildValidResearchEvidenceDocument(
  overrides: Partial<ResearchEvidenceDocument["evidenceBody"]> = {},
): ResearchEvidenceDocument {
  const evidenceBody: ResearchEvidenceExportBody = {
    backtestRunId: "00000000-0000-4000-8000-0000000b01",
    walkForwardRunId: "00000000-0000-4000-8000-0000000wf1",
    blindValidationResultId: "00000000-0000-4000-8000-0000000bl1",
    costModelVersion: "ri-cost-v1",
    executionMode: "backtest",
    regimeCoverage: {
      regimes: ["range", "trend_down"] satisfies ResearchRegimeClass[],
      nonTrendingCount: 1,
      downRegimeCount: 1,
    },
    ...overrides,
  };

  const contentDigest = computeResearchEvidenceExportDigest(evidenceBody);

  return {
    schemaVersion: RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
    envelope: {
      organizationId: ORG_A,
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      exportedAt: EXPORTED_AT.toISOString(),
      contentDigest,
    },
    evidenceBody,
  };
}

function baseAssemblyInput(
  document: Awaited<ReturnType<typeof buildMockEvidenceDocument>>,
  researchEvidenceDocument?: ResearchEvidenceDocument,
) {
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
    ...(researchEvidenceDocument ? { researchEvidenceDocument } : {}),
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}

describe("assembleStrategyPromotionRecord research evidence (RI-P6)", () => {
  it("rejects mock-only paper evidence without research bundle", async () => {
    const document = await buildMockEvidenceDocument();

    expect(() => assembleStrategyPromotionRecord(baseAssemblyInput(document))).toThrow(
      StrategyPromotionValidationError,
    );

    try {
      assembleStrategyPromotionRecord(baseAssemblyInput(document));
    } catch (err) {
      expect(err).toMatchObject({ code: "STRATEGY_PROMOTION_MOCK_EVIDENCE_INSUFFICIENT" });
    }
  });

  it("accepts mock paper evidence when research bundle has sufficient regime coverage", async () => {
    const document = await buildMockEvidenceDocument();
    const research = buildValidResearchEvidenceDocument();
    const payload = assembleStrategyPromotionRecord(baseAssemblyInput(document, research));

    expect(payload.researchEvidence?.contentDigest).toBe(research.envelope.contentDigest);
    expect(payload.paperTradingEvidence.contentDigest).toBe(document.envelope.contentDigest);
  });

  it("rejects research bundle with insufficient regime coverage", async () => {
    const document = await buildMockEvidenceDocument();
    const research = buildValidResearchEvidenceDocument({
      regimeCoverage: {
        regimes: ["trend_up"],
        nonTrendingCount: 0,
        downRegimeCount: 0,
      },
    });

    expect(() => assembleStrategyPromotionRecord(baseAssemblyInput(document, research))).toThrow(
      StrategyPromotionValidationError,
    );

    try {
      assembleStrategyPromotionRecord(baseAssemblyInput(document, research));
    } catch (err) {
      expect(err).toMatchObject({
        code: "STRATEGY_PROMOTION_RESEARCH_REGIME_COVERAGE_INSUFFICIENT",
      });
    }
  });

  it("rejects tampered research evidence digest", async () => {
    const document = await buildMockEvidenceDocument();
    const research = buildValidResearchEvidenceDocument();
    research.envelope.contentDigest = "deadbeef".repeat(8);

    expect(() => assembleStrategyPromotionRecord(baseAssemblyInput(document, research))).toThrow(
      StrategyPromotionValidationError,
    );
  });
});
