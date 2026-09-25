import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";
const STRATEGY_ID = "atomic-promotion-fixture";
const STRATEGY_SIGNAL = "atomic-promotion-signal";
function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id">, orgId: string): OrderRow {
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
    organizationId: orgId,
    ...overrides,
  };
}

function mockFill(orderId: string, orgId: string): FillRow {
  return {
    id: `fill-${orderId}`,
    organizationId: orgId,
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
    fillsByOrderId[order.id] = [mockFill(order.id, order.organizationId)];
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
    recordFillProgress: async () => {
      throw new Error("not implemented");
    },
    listEvents: async () => [],
    listFills: async (_context, orderId) => fillsByOrderId[orderId] ?? [],
  };
}

export async function buildAtomicPromotionAssembly(
  orgId: string,
  strategyId = STRATEGY_ID,
  strategyVersion = "0.1.0",
) {
  const buy = mockOrder({ id: "gov-buy", avgFillPrice: "100" }, orgId);
  const sell = mockOrder({ id: "gov-sell", side: "sell", avgFillPrice: "110" }, orgId);
  const document = await buildPaperEvaluationExportDocument({
    context: requireOrgContext(orgId),
    orderRepository: mockRepository([buy, sell]),
    window: { start: new Date(100), end: new Date(200) },
    strategySignalIds: [STRATEGY_SIGNAL],
    executionMode: "paper",
    exportedAt: new Date("2026-06-18T12:00:00.000Z"),
  });

  return {
    organizationId: orgId,
    strategyId,
    strategyVersion,
    gitCommitSha: "fa63f09661884594f0a8f7e2aab4d46bfda21cde",
    hypothesis: "Mean reversion in range",
    intendedRegime: "RANGE",
    costModel: { feesBps: "10", slippageBps: "5" },
    failureModes: ["liquidity vacuum"],
    reasonCodeDistribution: { STRAT_MR_ZSCORE_BUY: 3 },
    paperTradingEvidenceDocument: document,
    researchEvidenceDocument: buildValidResearchEvidenceDocument(orgId, { strategyId }),
    confidenceAttestation: {
      edgeNetOfCosts: "Net edge after costs.",
      liveTracksPaper: "Live should track paper.",
      downsideRiskBounded: "Risk engine caps downside.",
    },
  };
}
