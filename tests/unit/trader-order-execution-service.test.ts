import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order, PlaceOrderInput } from "@/lib/trader/connectors/types";
import {
  LiveExecutionNotSupportedError,
  OrderVersionConflictError,
  createOrderExecutionServiceFromDeps,
  createSqliteOrderExecutionService,
  createSqliteOrderRepository,
} from "@/lib/trader/execution";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { KillSwitchResolverPort, RiskEngineService } from "@/lib/trader/risk/evaluate.types";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import type {
  NormalizedRiskLimitsConfig,
  OrgRiskLimitsMetadata,
} from "@/lib/trader/risk/limits/types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { rejectDecision, buildRiskSnapshot } from "@/lib/trader/risk/decision";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { engineReasonCodes } from "@/lib/trader/risk/reason-codes";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000249a";
const NOW = 1_700_000_000_000;

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function metadata(
  overrides: Partial<NormalizedRiskLimitsConfig> & { configVersion?: number } = {},
): OrgRiskLimitsMetadata {
  return {
    id: "limits-249",
    scopeType: "organization",
    scopeRef: null,
    configVersion: overrides.configVersion ?? 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    allowedSymbols: overrides.allowedSymbols ?? ["BTC/USDT", "ETH/USDT"],
    maxNotional: overrides.maxNotional ?? "10000",
    maxOrdersPerWindow: overrides.maxOrdersPerWindow ?? 10,
    windowMs: overrides.windowMs ?? 60_000,
    collarBps: overrides.collarBps ?? 500,
    maxPositionPerSymbol: overrides.maxPositionPerSymbol ?? "1000",
    maxDailyLoss: overrides.maxDailyLoss ?? "500",
    maxDrawdown: overrides.maxDrawdown ?? "1000",
    maxOpenOrders: overrides.maxOpenOrders ?? 10,
    maxQuoteExposure: overrides.maxQuoteExposure ?? "1000000",
    maxRiskPerTradePct: overrides.maxRiskPerTradePct ?? "0.10",
    maxPortfolioRiskPct: overrides.maxPortfolioRiskPct ?? "0.50",
    maxConcurrentPositions: overrides.maxConcurrentPositions ?? 10,
  };
}

function defaultEffective(
  overrides: Partial<EffectiveKillSwitchState> = {},
): EffectiveKillSwitchState {
  return {
    organizationId: "org-placeholder",
    blocked: false,
    enforcementMode: null,
    bindingState: null,
    resolutionStatus: "ok",
    contributors: [],
    resolvedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function stubKillSwitchResolver(
  effective: EffectiveKillSwitchState = defaultEffective(),
): KillSwitchResolverPort {
  return {
    getEffectiveState: async () => effective,
  };
}

function stubLimitsService(meta: OrgRiskLimitsMetadata | null) {
  return {
    getLimitsForOrg: async () => meta,
    getOrCreateLimitsForOrg: async () => {
      throw new Error("not used");
    },
    upsertLimitsForOrg: async () => {
      throw new Error("not used");
    },
  };
}

function makeRiskEngine(
  orgId: string,
  options: {
    killSwitch?: EffectiveKillSwitchState;
    reject?: boolean;
  } = {},
): RiskEngineService {
  if (options.reject) {
    return {
      evaluateOrderRequest: async () => ({
        riskDecisionId: "rd-reject",
        organizationId: orgId,
        configVersion: 1,
        decision: rejectDecision(
          [engineReasonCodes.limitsNotConfigured],
          buildRiskSnapshot({
            order: {
              clientOrderId: "c",
              symbol: "BTC/USDT",
              side: "buy",
              type: "market",
              quantity: "1",
            },
            checksApplied: [],
          }),
          new Date(NOW).toISOString(),
        ),
      }),
    };
  }

  return createRiskEngineService({
    limitsService: stubLimitsService(metadata()),
    killSwitchResolver: stubKillSwitchResolver(
      options.killSwitch ?? defaultEffective({ organizationId: orgId }),
    ),
    rateStore: createInMemoryOrderRateStore(),
    writeAudit: vi.fn(() => "risk-audit"),
    nowMs: () => NOW,
    newDecisionId: () => "rd-249",
  });
}

function minimalConnectorStub(
  overrides: Partial<Pick<ExchangeConnector, "placeOrder" | "getTradeHistory">> = {},
): ExchangeConnector {
  let lastPlaced: PlaceOrderInput | null = null;
  return {
    venueId: "mock",
    marketType: "spot",
    validateCredentials: vi.fn().mockResolvedValue({ valid: true }),
    getAccountInfo: vi.fn(),
    getBalances: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    cancelOrder: vi.fn(),
    streamMarketData: vi.fn(),
    streamUserData: vi.fn(),
    getFuturesBalances: vi.fn(),
    getFuturesPositions: vi.fn(),
    placeFuturesOrder: vi.fn(),
    getTradeHistory: overrides.getTradeHistory ?? vi.fn().mockImplementation(async () =>
      lastPlaced ? [{
        tradeId: "exact-trade-1",
        orderId: "ex-order-1",
        clientOrderId: lastPlaced.clientOrderId,
        symbol: lastPlaced.symbol,
        side: lastPlaced.side,
        price: lastPlaced.price ?? "65000",
        quantity: lastPlaced.quantity,
        fee: "0",
        feeAsset: "USDT",
        executedAt: new Date(NOW).toISOString(),
      }] : []),
    placeOrder:
      overrides.placeOrder ??
      vi.fn().mockImplementation(
        async (input: PlaceOrderInput): Promise<Order> => {
          lastPlaced = input;
          return {
            orderId: "ex-order-1",
            clientOrderId: input.clientOrderId,
            symbol: input.symbol,
            side: input.side,
            type: input.type,
            status: input.type === "market" ? "filled" : "open",
            price: input.price,
            quantity: input.quantity,
            filledQuantity: input.type === "market" ? input.quantity : "0",
            createdAt: new Date(NOW).toISOString(),
            updatedAt: new Date(NOW).toISOString(),
          };
        },
      ),
  };
}

function submitInput(
  overrides: Partial<{
    clientOrderId: string;
    idempotencyKey: string;
    executionMode: "mock" | "paper";
    type: "limit" | "market";
    price: string;
    quantity: string;
    symbol: string;
  }> = {},
) {
  return {
    clientOrderId: overrides.clientOrderId ?? crypto.randomUUID(),
    idempotencyKey: overrides.idempotencyKey ?? crypto.randomUUID(),
    executionMode: overrides.executionMode ?? "mock",
    symbol: overrides.symbol ?? "BTC/USDT",
    side: "buy" as const,
    type: overrides.type ?? "market",
    price: overrides.price,
    quantity: overrides.quantity ?? "0.1",
    referencePrice: "65000",
    accountKey: "acct-1",
    accountState: EMPTY_STATE,
  };
}

function makeService(
  orgId: string,
  repo: OrderRepository,
  options: {
    riskEngine?: RiskEngineService;
    killSwitch?: EffectiveKillSwitchState;
    connector?: ExchangeConnector;
    executionTelemetrySink?: WaiaTraderTelemetrySink;
  } = {},
) {
  const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-id");
  const riskEngine = options.riskEngine ?? makeRiskEngine(orgId);
  const connector = options.connector ?? minimalConnectorStub();
  const telemetryLines: string[] = [];
  const executionTelemetrySink =
    options.executionTelemetrySink ?? ((line: string) => telemetryLines.push(line));

  const service = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver: stubKillSwitchResolver(
      options.killSwitch ?? defaultEffective({ organizationId: orgId }),
    ),
    connectorForMode: () => connector,
    writeAudit,
    nowMs: () => NOW,
    executionTelemetrySink,
  });

  return { service, writeAudit, riskEngine, connector, repo, telemetryLines };
}

type ExecutionTelemetryEvent = {
  event: string;
  kind: string;
  outcome: string;
  severity?: string;
  organization_id?: string;
  from_state?: string;
  to_state?: string;
  block_reason?: string;
};

function parseExecutionEvents(lines: string[]): ExecutionTelemetryEvent[] {
  return lines
    .map((line) => JSON.parse(line) as ExecutionTelemetryEvent)
    .filter((event) => event.event === "waia_trader_event" && event.kind === "execution");
}

function terminalEvents(events: ExecutionTelemetryEvent[]) {
  return events.filter((event) => event.outcome !== "state_transition");
}

function transitionEvents(events: ExecutionTelemetryEvent[]) {
  return events.filter((event) => event.outcome === "state_transition");
}

describe("trader order execution service (DEE-249)", () => {
  let orgA: string;
  let repo: OrderRepository;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-exec-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-exec.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-exec-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Exec Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Exec Org A" });
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgA), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });

    repo = createSqliteOrderRepository(db);
  });

  it("risk REJECT on new order creates no order row", async () => {
    const context = requireOrgContext(orgA);
    const { service } = makeService(orgA, repo, {
      riskEngine: makeRiskEngine(orgA, { reject: true }),
    });

    const input = submitInput({ clientOrderId: "reject-249", idempotencyKey: "idem-reject-249" });
    const result = await service.submitOrder(context, input);

    expect(result.status).toBe("risk_rejected");
    if (result.status === "risk_rejected") {
      expect(result.order).toBeNull();
    }

    const byClient = await repo.findOrderByClientOrderId(context, input.clientOrderId);
    expect(byClient).toBeNull();
  });

  it("lookup-first resubmit skips fresh risk evaluation", async () => {
    const context = requireOrgContext(orgA);
    const riskEngine = makeRiskEngine(orgA);
    const evaluateSpy = vi.spyOn(riskEngine, "evaluateOrderRequest");
    const { service } = makeService(orgA, repo, { riskEngine });

    const input = submitInput({
      clientOrderId: "resubmit-249",
      idempotencyKey: "idem-resubmit-249",
      type: "limit",
      price: "65000",
    });

    const first = await service.submitOrder(context, input);
    expect(first.status).toBe("submitted");

    evaluateSpy.mockClear();
    const second = await service.submitOrder(context, input);
    expect(second.status).toBe("submitted");
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it("market order follows RISK_APPROVED → SENT_TO_EXCHANGE → ACCEPTED → FILLED", async () => {
    const context = requireOrgContext(orgA);
    const { service } = makeService(orgA, repo);

    const input = submitInput({
      clientOrderId: "market-249",
      idempotencyKey: "idem-market-249",
      type: "market",
    });
    const result = await service.submitOrder(context, input);

    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.order.state).toBe("FILLED");
    }

    const events = await repo.listEvents(
      context,
      result.status === "submitted" ? result.order.id : "",
    );
    const transitions = events.map((event) => event.toState);
    expect(transitions).toEqual([
      "CREATED",
      "RISK_APPROVED",
      "SENT_TO_EXCHANGE",
      "ACCEPTED",
      "FILLED",
    ]);
  });

  it("limit order remains ACCEPTED without immediate FILLED", async () => {
    const context = requireOrgContext(orgA);
    const { service } = makeService(orgA, repo);

    const input = submitInput({
      clientOrderId: "limit-249",
      idempotencyKey: "idem-limit-249",
      type: "limit",
      price: "65000",
    });
    const result = await service.submitOrder(context, input);

    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.order.state).toBe("ACCEPTED");
    }
  });

  it("recordFill occurs before FILLED transition", async () => {
    const context = requireOrgContext(orgA);
    const ordering: string[] = [];
    const realRepo = repo;

    const spiedRepo: OrderRepository = {
      ...realRepo,
      recordFill: async (ctx, fillInput) => {
        ordering.push("recordFill");
        return realRepo.recordFill(ctx, fillInput);
      },
      transitionOrder: async (ctx, transitionInput) => {
        if (transitionInput.toState === "FILLED") {
          ordering.push("FILLED");
        }
        return realRepo.transitionOrder(ctx, transitionInput);
      },
    };

    const { service } = makeService(orgA, spiedRepo);
    const input = submitInput({
      clientOrderId: "fill-order-249",
      idempotencyKey: "idem-fill-order-249",
      type: "market",
    });

    await service.submitOrder(context, input);

    expect(ordering.indexOf("recordFill")).toBeGreaterThanOrEqual(0);
    expect(ordering.indexOf("FILLED")).toBeGreaterThan(ordering.indexOf("recordFill"));
  });

  it("kill-switch block transitions to REJECTED with reason kill_switch and skips connector", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub();
    const { service } = makeService(orgA, repo, {
      killSwitch: defaultEffective({
        organizationId: orgA,
        blocked: true,
        enforcementMode: "REJECT",
      }),
      connector,
    });

    const input = submitInput({
      clientOrderId: "ks-block-249",
      idempotencyKey: "idem-ks-block-249",
      type: "limit",
      price: "65000",
    });
    const result = await service.submitOrder(context, input);

    expect(result.status).toBe("submit_blocked");
    if (result.status === "submit_blocked") {
      expect(result.order.state).toBe("REJECTED");
    }
    expect(connector.placeOrder).not.toHaveBeenCalled();

    const events = await repo.listEvents(
      context,
      result.status === "submit_blocked" ? result.order.id : "",
    );
    const rejected = events.find((event) => event.toState === "REJECTED");
    expect(JSON.parse(rejected?.payload ?? "{}")).toEqual({ reason: "kill_switch" });
  });

  it("connector rejected transitions to REJECTED with reason connector", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub({
      placeOrder: vi.fn().mockResolvedValue({
        orderId: "ex-rej",
        clientOrderId: "conn-rej-249",
        symbol: "BTC/USDT",
        side: "buy",
        type: "limit",
        status: "rejected",
        quantity: "0.1",
        filledQuantity: "0",
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
      }),
    });
    const { service } = makeService(orgA, repo, { connector });

    const input = submitInput({
      clientOrderId: "conn-rej-249",
      idempotencyKey: "idem-conn-rej-249",
      type: "limit",
      price: "65000",
    });
    const result = await service.submitOrder(context, input);

    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.order.state).toBe("REJECTED");
    }

    const events = await repo.listEvents(
      context,
      result.status === "submitted" ? result.order.id : "",
    );
    const rejected = events.find((event) => event.toState === "REJECTED");
    expect(JSON.parse(rejected?.payload ?? "{}")).toEqual({ reason: "connector" });
  });

  it("SENT_TO_EXCHANGE without exchangeOrderId returns connector_uncertain and does not re-dispatch", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub();
    const { service } = makeService(orgA, repo, { connector });

    const clientOrderId = "uncertain-249";
    const idempotencyKey = "idem-uncertain-249";
    const created = await repo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
      clientOrderId,
      idempotencyKey,
      riskDecisionId: crypto.randomUUID(),
    });
    await repo.transitionOrder(context, {
      orderId: created.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });
    await repo.transitionOrder(context, {
      orderId: created.id,
      expectedStateVersion: 2,
      toState: "SENT_TO_EXCHANGE",
    });

    const result = await service.submitOrder(
      context,
      submitInput({ clientOrderId, idempotencyKey, type: "limit", price: "65000" }),
    );

    expect(result.status).toBe("connector_uncertain");
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });

  it("connector throw transitions to RECONCILIATION_REQUIRED not FAILED", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub({
      placeOrder: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const { service } = makeService(orgA, repo, { connector });

    const input = submitInput({
      clientOrderId: "throw-249",
      idempotencyKey: "idem-throw-249",
      type: "limit",
      price: "65000",
    });
    const result = await service.submitOrder(context, input);

    expect(result.status).toBe("connector_uncertain");
    if (result.status === "connector_uncertain") {
      expect(result.order.state).toBe("RECONCILIATION_REQUIRED");
    }
  });

  it("never fabricates a fill when connector status lacks exact trade evidence", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub({
      getTradeHistory: vi.fn().mockResolvedValue([]),
    });
    const { service } = makeService(orgA, repo, { connector });
    const result = await service.submitOrder(context, submitInput({
      clientOrderId: "raw-status-only-651",
      idempotencyKey: "idem-raw-status-only-651",
      type: "market",
    }));
    expect(result.status).toBe("connector_uncertain");
    if (result.status !== "connector_uncertain") return;
    expect(result.order.state).toBe("RECONCILIATION_REQUIRED");
    expect(result.order.filledQuantity).toBe("0");
    expect(result.order.avgFillPrice).toBeNull();
    expect(await repo.listFills(context, result.order.id)).toEqual([]);
  });

  it("OrderVersionConflictError returns conflict and never calls connector", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub();
    const realRepo = repo;
    const repoWithConflict: OrderRepository = {
      ...realRepo,
      transitionOrder: async (ctx, transitionInput) => {
        if (transitionInput.toState === "SENT_TO_EXCHANGE") {
          throw new OrderVersionConflictError(
            transitionInput.orderId,
            transitionInput.expectedStateVersion,
          );
        }
        return realRepo.transitionOrder(ctx, transitionInput);
      },
    };

    const { service } = makeService(orgA, repoWithConflict, { connector });
    const input = submitInput({
      clientOrderId: "conflict-249",
      idempotencyKey: "idem-conflict-249",
      type: "limit",
      price: "65000",
    });

    const result = await service.submitOrder(context, input);
    expect(result.status).toBe("conflict");
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });

  it("rejects live execution mode", async () => {
    const context = requireOrgContext(orgA);
    const { service } = makeService(orgA, repo);

    await expect(
      service.submitOrder(context, {
        ...submitInput(),
        executionMode: "live",
      }),
    ).rejects.toThrow(LiveExecutionNotSupportedError);
  });

  it("paper mode succeeds via mock connector", async () => {
    const context = requireOrgContext(orgA);
    const { service } = makeService(orgA, repo);

    const result = await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "paper-249",
        idempotencyKey: "idem-paper-249",
        executionMode: "paper",
        type: "limit",
        price: "65000",
      }),
    );

    expect(result.status).toBe("submitted");
  });

  it("emits only governance order audit actions", async () => {
    const context = requireOrgContext(orgA);
    const { service, writeAudit } = makeService(orgA, repo);

    await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "audit-249",
        idempotencyKey: "idem-audit-249",
        type: "market",
      }),
    );

    const orderActions = writeAudit.mock.calls
      .map((call) => (call[0] as TraderAuditInput).action)
      .filter((action) => action.startsWith("trader.order."));

    expect(orderActions).toEqual(
      expect.arrayContaining([
        traderAuditActions.orderSubmissionStarted,
        traderAuditActions.orderConnectorFilled,
      ]),
    );
    expect(orderActions).not.toContain("trader.order.risk_approved");
    expect(orderActions).not.toContain("trader.order.sent_to_exchange");
    expect(orderActions).not.toContain("trader.order.connector_accepted");
  });

  it("records lifecycle in trader_order_events without duplicating in audit", async () => {
    const context = requireOrgContext(orgA);
    const { service, writeAudit } = makeService(orgA, repo);

    const result = await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "events-249",
        idempotencyKey: "idem-events-249",
        type: "market",
      }),
    );

    expect(result.status).toBe("submitted");
    if (result.status !== "submitted") {
      return;
    }

    const events = await repo.listEvents(context, result.order.id);
    expect(events.length).toBeGreaterThan(1);

    const auditEntityTypes = writeAudit.mock.calls.map(
      (call) => (call[0] as TraderAuditInput).entityType,
    );
    expect(
      auditEntityTypes.filter((type) => type === traderEntityTypes.order).length,
    ).toBeGreaterThan(0);
  });

  it("createSqliteOrderExecutionService factory wires full stack", async () => {
    const db = getDb();
    const service = createSqliteOrderExecutionService(db);
    const context = requireOrgContext(orgA);

    const result = await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "factory-249",
        idempotencyKey: "idem-factory-249",
        type: "limit",
        price: "65000",
      }),
    );

    expect(result.status).toBe("submitted");
  });

  it("passes clientOrderId to connector as venue idempotency token", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub();
    const { service } = makeService(orgA, repo, { connector });
    const clientOrderId = "venue-token-249";

    await service.submitOrder(
      context,
      submitInput({
        clientOrderId,
        idempotencyKey: "idem-venue-token-249",
        type: "limit",
        price: "65000",
      }),
    );

    expect(connector.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ clientOrderId }));
  });
});

describe("trader order execution telemetry (DEE-254)", () => {
  let orgA: string;
  let repo: OrderRepository;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-exec-tel-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-exec-tel.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-exec-tel-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Exec Tel Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Exec Tel Org A" });
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgA), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });

    repo = createSqliteOrderRepository(db);
  });

  it("risk_rejected emits one terminal event and no transitions", async () => {
    const context = requireOrgContext(orgA);
    const { service, telemetryLines } = makeService(orgA, repo, {
      riskEngine: makeRiskEngine(orgA, { reject: true }),
    });

    await service.submitOrder(
      context,
      submitInput({ clientOrderId: "tel-reject-254", idempotencyKey: "idem-tel-reject-254" }),
    );

    const events = parseExecutionEvents(telemetryLines);
    expect(terminalEvents(events)).toEqual([
      expect.objectContaining({ outcome: "risk_rejected", severity: "info" }),
    ]);
    expect(transitionEvents(events)).toHaveLength(0);
  });

  it("submit_blocked emits terminal block_reason and transition to REJECTED", async () => {
    const context = requireOrgContext(orgA);
    const { service, telemetryLines } = makeService(orgA, repo, {
      killSwitch: defaultEffective({
        organizationId: orgA,
        blocked: true,
        enforcementMode: "REJECT",
      }),
    });

    await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "tel-ks-254",
        idempotencyKey: "idem-tel-ks-254",
        type: "limit",
        price: "65000",
      }),
    );

    const events = parseExecutionEvents(telemetryLines);
    expect(terminalEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "submit_blocked",
        block_reason: "kill_switch",
        severity: "info",
      }),
    ]);
    expect(transitionEvents(events).some((event) => event.to_state === "REJECTED")).toBe(true);
  });

  it("conflict emits one critical terminal without orderId", async () => {
    const context = requireOrgContext(orgA);
    const realRepo = repo;
    const repoWithConflict: OrderRepository = {
      ...realRepo,
      transitionOrder: async (ctx, transitionInput) => {
        if (transitionInput.toState === "SENT_TO_EXCHANGE") {
          throw new OrderVersionConflictError(
            transitionInput.orderId,
            transitionInput.expectedStateVersion,
          );
        }
        return realRepo.transitionOrder(ctx, transitionInput);
      },
    };

    const { service, telemetryLines } = makeService(orgA, repoWithConflict);

    await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "tel-conflict-254",
        idempotencyKey: "idem-tel-conflict-254",
        type: "limit",
        price: "65000",
      }),
    );

    const terminal = terminalEvents(parseExecutionEvents(telemetryLines));
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ outcome: "conflict", severity: "critical" });
    expect(terminal[0]).not.toHaveProperty("orderId");
    expect(terminal[0]).not.toHaveProperty("order_id");
  });

  it("connector throw emits connector_uncertain and RECONCILIATION_REQUIRED transition", async () => {
    const context = requireOrgContext(orgA);
    const connector = minimalConnectorStub({
      placeOrder: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const { service, telemetryLines } = makeService(orgA, repo, { connector });

    await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "tel-throw-254",
        idempotencyKey: "idem-tel-throw-254",
        type: "limit",
        price: "65000",
      }),
    );

    const events = parseExecutionEvents(telemetryLines);
    expect(terminalEvents(events)).toEqual([
      expect.objectContaining({ outcome: "connector_uncertain", severity: "info" }),
    ]);
    expect(
      transitionEvents(events).some((event) => event.to_state === "RECONCILIATION_REQUIRED"),
    ).toBe(true);
  });

  it("market submit emits four transitions and one submitted terminal", async () => {
    const context = requireOrgContext(orgA);
    const { service, telemetryLines } = makeService(orgA, repo);

    await service.submitOrder(
      context,
      submitInput({
        clientOrderId: "tel-market-254",
        idempotencyKey: "idem-tel-market-254",
        type: "market",
      }),
    );

    const events = parseExecutionEvents(telemetryLines);
    expect(terminalEvents(events)).toEqual([
      expect.objectContaining({ outcome: "submitted", severity: "info" }),
    ]);
    expect(transitionEvents(events).map((event) => event.to_state)).toEqual([
      "RISK_APPROVED",
      "SENT_TO_EXCHANGE",
      "ACCEPTED",
      "FILLED",
    ]);
  });

  it("lookup-first resubmit emits one submitted terminal and no transitions", async () => {
    const context = requireOrgContext(orgA);
    const { service, telemetryLines } = makeService(orgA, repo);
    const input = submitInput({
      clientOrderId: "tel-resubmit-254",
      idempotencyKey: "idem-tel-resubmit-254",
      type: "limit",
      price: "65000",
    });

    await service.submitOrder(context, input);
    telemetryLines.length = 0;

    await service.submitOrder(context, input);

    const events = parseExecutionEvents(telemetryLines);
    expect(terminalEvents(events)).toEqual([
      expect.objectContaining({ outcome: "submitted", severity: "info" }),
    ]);
    expect(transitionEvents(events)).toHaveLength(0);
  });
});
