import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { Order } from "@/lib/trader/connectors/types";
import {
  OrderVersionConflictError,
  createReconciliationServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import type { OrderRepository, OrderRow } from "@/lib/trader/execution/order-repository.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000250a";
const NOW = 1_700_000_000_000;

function baseCreateInput(
  overrides: Partial<{
    clientOrderId: string;
    idempotencyKey: string;
    symbol: string;
    quantity: string;
    executionMode: "mock" | "paper";
  }> = {},
) {
  return {
    venue: "mock",
    executionMode: overrides.executionMode ?? "mock",
    symbol: overrides.symbol ?? "BTC/USDT",
    side: "buy" as const,
    type: "limit" as const,
    price: "65000",
    quantity: overrides.quantity ?? "0.1",
    clientOrderId: overrides.clientOrderId ?? crypto.randomUUID(),
    idempotencyKey: overrides.idempotencyKey ?? crypto.randomUUID(),
    riskDecisionId: crypto.randomUUID(),
  };
}

async function advanceTo(
  repo: OrderRepository,
  context: ReturnType<typeof requireOrgContext>,
  order: OrderRow,
  states: Array<OrderRow["state"]>,
): Promise<OrderRow> {
  let current = order;
  for (const state of states) {
    current = await repo.transitionOrder(context, {
      orderId: current.id,
      expectedStateVersion: current.stateVersion,
      toState: state,
    });
  }
  return current;
}

function stubConnector(
  overrides: Partial<
    Pick<ExchangeConnector, "getOpenOrders" | "getOrder" | "getTradeHistory">
  > = {},
): ExchangeConnector {
  return {
    venueId: "mock",
    marketType: "spot",
    validateCredentials: vi.fn().mockResolvedValue({ valid: true }),
    getAccountInfo: vi.fn(),
    getBalances: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: overrides.getOpenOrders ?? vi.fn().mockResolvedValue([]),
    getOrder: overrides.getOrder ?? vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getTradeHistory: overrides.getTradeHistory ?? vi.fn().mockResolvedValue([]),
    streamMarketData: vi.fn(),
    streamUserData: vi.fn(),
    getFuturesBalances: vi.fn(),
    getFuturesPositions: vi.fn(),
    placeFuturesOrder: vi.fn(),
  };
}

describe("trader order reconciliation service (DEE-250)", () => {
  let orgA: string;
  let repo: OrderRepository;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-recon-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-recon.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-recon-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Recon Org A" });
    repo = createSqliteOrderRepository(db);
  });

  it("VENUE_ACKED converges SENT_TO_EXCHANGE to ACCEPTED adopting venue exchangeOrderId", async () => {
    const context = requireOrgContext(orgA);
    const clientOrderId = "recon-venue-acked-250";
    const created = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-venue-acked-250" }),
    );
    const riskApproved = await advanceTo(repo, context, created, ["RISK_APPROVED"]);
    const sent = await advanceTo(repo, context, riskApproved, ["SENT_TO_EXCHANGE"]);

    const connectorOrder: Order = {
      orderId: "ex-venue-acked-250",
      clientOrderId,
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      status: "open",
      price: "65000",
      quantity: "0.1",
      filledQuantity: "0",
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };

    const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit");
    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () =>
        stubConnector({
          getOpenOrders: vi.fn().mockResolvedValue([connectorOrder]),
          getOrder: vi.fn().mockResolvedValue(connectorOrder),
        }),
      writeAudit,
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "order", orderId: sent.id });
    const outcome = report.outcomes[0];

    expect(outcome?.classification).toBe("VENUE_ACKED");
    expect(outcome?.toState).toBe("ACCEPTED");
    expect(outcome?.markedReconciliationRequired).toBe(false);

    const updated = await repo.getOrderById(context, sent.id);
    expect(updated?.state).toBe("ACCEPTED");
    expect(updated?.exchangeOrderId).toBe("ex-venue-acked-250");

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.orderReconciliationMismatch,
        entityType: traderEntityTypes.order,
      }),
    );
  });

  it("NOT_FOUND_AT_VENUE marks RECONCILIATION_REQUIRED on non-terminal order", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "recon-not-found-250",
        idempotencyKey: "idem-not-found-250",
      }),
    );
    const sent = await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit");
    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () => stubConnector(),
      writeAudit,
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "order", orderId: sent.id });
    const outcome = report.outcomes[0];

    expect(outcome?.classification).toBe("NOT_FOUND_AT_VENUE");
    expect(outcome?.markedReconciliationRequired).toBe(true);

    const updated = await repo.getOrderById(context, sent.id);
    expect(updated?.state).toBe("RECONCILIATION_REQUIRED");

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.orderReconciliationRequired,
      }),
    );
  });

  it("union open-scan detects UNKNOWN_POSITION for connector-only order", async () => {
    const context = requireOrgContext(orgA);
    await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "recon-symbol-anchor-250",
        idempotencyKey: "idem-symbol-anchor-250",
        symbol: "BTC/USDT",
      }),
    );

    const phantom: Order = {
      orderId: "phantom-250",
      clientOrderId: "phantom-client-250",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      status: "open",
      price: "65000",
      quantity: "0.1",
      filledQuantity: "0",
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };

    const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit");
    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () =>
        stubConnector({
          getOpenOrders: vi.fn().mockResolvedValue([phantom]),
        }),
      writeAudit,
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "open", executionMode: "mock" });
    const unknown = report.outcomes.find((o) => o.classification === "UNKNOWN_POSITION");

    expect(unknown?.clientOrderId).toBe("phantom-client-250");
    expect(unknown?.orderId).toBeUndefined();
    expect(unknown?.markedReconciliationRequired).toBe(false);

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.orderReconciliationUnknownPosition,
      }),
    );
  });

  it("TERMINAL_DRIFT never mutates terminal DB and uses terminal_drift audit", async () => {
    const context = requireOrgContext(orgA);
    const clientOrderId = "recon-terminal-drift-250";
    const created = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-terminal-drift-250" }),
    );
    const filled = await advanceTo(repo, context, created, [
      "RISK_APPROVED",
      "SENT_TO_EXCHANGE",
      "ACCEPTED",
      "FILLED",
    ]);

    const terminal = await repo.getOrderById(context, filled.id);
    expect(terminal?.state).toBe("FILLED");

    const phantom: Order = {
      orderId: "phantom-drift-250",
      clientOrderId,
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      status: "open",
      price: "65000",
      quantity: "0.1",
      filledQuantity: "0",
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };

    const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit");
    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () =>
        stubConnector({
          getOpenOrders: vi.fn().mockResolvedValue([phantom]),
        }),
      writeAudit,
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "order", orderId: filled.id });
    const drift = report.outcomes.find((o) => o.classification === "TERMINAL_DRIFT");

    expect(drift?.markedReconciliationRequired).toBe(false);
    expect(drift?.escalationKind).toBe("phantom_open");
    const stillTerminal = await repo.getOrderById(context, filled.id);
    expect(stillTerminal?.state).toBe("FILLED");

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: traderAuditActions.orderReconciliationTerminalDrift,
      }),
    );
  });

  it("skips pre-dispatch CREATED orders without classification", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "recon-pre-dispatch-250",
        idempotencyKey: "idem-pre-dispatch-250",
      }),
    );

    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () => stubConnector(),
      writeAudit: vi.fn(() => "audit"),
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "order", orderId: created.id });
    expect(report.outcomes).toHaveLength(0);

    const unchanged = await repo.getOrderById(context, created.id);
    expect(unchanged?.state).toBe("CREATED");
  });

  it("FILL_PROGRESS records fills before FILLED via ACCEPTED", async () => {
    const context = requireOrgContext(orgA);
    const clientOrderId = "recon-fill-progress-250";
    const created = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-fill-progress-250" }),
    );
    const sent = await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);
    const accepted = await repo.transitionOrder(context, {
      orderId: sent.id,
      expectedStateVersion: sent.stateVersion,
      toState: "ACCEPTED",
      exchangeOrderId: "ex-fill-250",
    });

    const connectorOrder: Order = {
      orderId: "ex-fill-250",
      clientOrderId,
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      status: "filled",
      price: "65000",
      quantity: "0.1",
      filledQuantity: "0.1",
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };

    const service = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () =>
        stubConnector({
          getOrder: vi.fn().mockResolvedValue(connectorOrder),
          getTradeHistory: vi.fn().mockResolvedValue([
            {
              tradeId: "trade-fill-250",
              orderId: "ex-fill-250",
              clientOrderId,
              symbol: "BTC/USDT",
              side: "buy",
              price: "65000",
              quantity: "0.1",
              fee: "0",
              feeAsset: "USDT",
              executedAt: new Date(NOW).toISOString(),
            },
          ]),
        }),
      writeAudit: vi.fn(() => "audit"),
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "order", orderId: accepted.id });
    const outcome = report.outcomes[0];

    expect(outcome?.classification).toBe("FILL_PROGRESS");
    expect(outcome?.toState).toBe("FILLED");
    expect(outcome?.recordedFills).toContain("trade-fill-250");

    const fills = await repo.listFills(context, accepted.id);
    expect(fills.some((fill) => fill.exchangeTradeId === "trade-fill-250")).toBe(true);

    const events = await repo.listEvents(context, accepted.id);
    expect(events.some((event) => event.eventType === "reconciliation")).toBe(true);
  });

  it("CAS conflict yields SKIPPED_CONFLICT and continues", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "recon-conflict-250",
        idempotencyKey: "idem-conflict-250",
      }),
    );
    const sent = await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const realRepo = repo;
    const conflictingRepo: OrderRepository = {
      ...realRepo,
      transitionOrder: async (ctx, input) => {
        if (input.toState === "RECONCILIATION_REQUIRED") {
          throw new OrderVersionConflictError(input.orderId, input.expectedStateVersion);
        }
        return realRepo.transitionOrder(ctx, input);
      },
    };

    const service = createReconciliationServiceFromDeps({
      orderRepository: conflictingRepo,
      connectorForMode: () => stubConnector(),
      writeAudit: vi.fn(() => "audit"),
      nowMs: () => NOW,
    });

    const report = await service.reconcile(context, { kind: "order", orderId: sent.id });
    expect(report.outcomes[0]?.classification).toBe("SKIPPED_CONFLICT");
  });

  it("idempotent re-run is a no-op when IN_SYNC", async () => {
    const context = requireOrgContext(orgA);
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

    const clientOrderId = "recon-idempotent-250";
    const placed = await connector.placeOrder({
      clientOrderId,
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
    });

    const created = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-idempotent-250" }),
    );
    const sent = await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);
    const accepted = await repo.transitionOrder(context, {
      orderId: sent.id,
      expectedStateVersion: sent.stateVersion,
      toState: "ACCEPTED",
      exchangeOrderId: placed.orderId,
    });

    const service = createSqliteReconciliationService(getDb(), {
      connectorForMode: () => connector,
      nowMs: () => NOW,
    });

    const first = await service.reconcile(context, { kind: "order", orderId: accepted.id });
    const second = await service.reconcile(context, { kind: "order", orderId: accepted.id });

    expect(first.outcomes[0]?.classification).toBe("IN_SYNC");
    expect(second.outcomes[0]?.classification).toBe("IN_SYNC");
    expect(second.outcomes[0]?.recordedFills).toHaveLength(0);
  });
});
