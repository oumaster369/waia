import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  auditLogs,
  traderFills,
  traderKillSwitches,
  traderOrderEvents,
  traderOrders,
} from "@/db/schema";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order } from "@/lib/trader/connectors/types";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import {
  createReconciliationServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteStartupReconciliationRunner,
  createStartupReconciliationRunnerFromDeps,
  runStartupReconciliation,
  type OrderRepository,
  type OrderRow,
  type ReconciliationService,
} from "@/lib/trader/execution";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { createSqliteAutomaticTriggerDispatcher } from "@/lib/trader/risk/kill-switch";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000252a";
const NOW = 1_700_000_000_000;

function baseCreateInput(
  overrides: Partial<{
    clientOrderId: string;
    idempotencyKey: string;
    symbol: string;
    quantity: string;
  }> = {},
) {
  return {
    venue: "mock",
    executionMode: "mock" as const,
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

type ReconciliationTelemetryEvent = {
  event: string;
  kind: string;
  outcome: string;
  severity?: string;
  organization_id?: string;
  escalations_attempted?: number;
};

function captureTelemetrySink() {
  const lines: string[] = [];
  const sink: WaiaTraderTelemetrySink = (line) => lines.push(line);
  return { lines, sink };
}

function parseReconciliationEvents(lines: string[]): ReconciliationTelemetryEvent[] {
  return lines
    .map((line) => JSON.parse(line) as ReconciliationTelemetryEvent)
    .filter((event) => event.event === "waia_trader_event" && event.kind === "reconciliation");
}

function createRunnerWithConnector(
  repo: OrderRepository,
  connector: ExchangeConnector,
  telemetrySink?: WaiaTraderTelemetrySink,
) {
  const reconciliationService = createReconciliationServiceFromDeps({
    orderRepository: repo,
    connectorForMode: () => connector,
    writeAudit: vi.fn((input) => input.entityId ?? "audit"),
    nowMs: () => NOW,
    reconciliationTelemetrySink: telemetrySink,
  });
  const triggerPort = createSqliteAutomaticTriggerDispatcher(getDb());

  return createStartupReconciliationRunnerFromDeps({
    reconciliationService,
    triggerPort,
    reconciliationTelemetrySink: telemetrySink,
    nowMs: () => NOW,
  });
}

describe("trader order reconciliation startup drill (DEE-252)", () => {
  let orgA: string;
  let repo: OrderRepository;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-recon-startup-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-recon-startup.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-recon-startup-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Startup Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Order Recon Startup Org A",
    });

    repo = createSqliteOrderRepository(db);
  });

  beforeEach(() => {
    const db = getDb();
    db.delete(traderKillSwitches).where(eq(traderKillSwitches.organizationId, orgA)).run();
    db.delete(traderFills).where(eq(traderFills.organizationId, orgA)).run();
    db.delete(traderOrderEvents).where(eq(traderOrderEvents.organizationId, orgA)).run();
    db.delete(traderOrders).where(eq(traderOrders.organizationId, orgA)).run();
  });

  it("happy path: in-sync open orders produce zero escalation activations", async () => {
    const context = requireOrgContext(orgA);
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

    const clientOrderId = "startup-happy-252";
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
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-startup-happy-252" }),
    );
    const sent = await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);
    await repo.transitionOrder(context, {
      orderId: sent.id,
      expectedStateVersion: sent.stateVersion,
      toState: "ACCEPTED",
      exchangeOrderId: placed.orderId,
    });

    const runner = createRunnerWithConnector(repo, connector);
    const result = await runner.runStartupReconciliation(context, "mock");

    expect(result.organizationId).toBe(orgA);
    expect(result.executionMode).toBe("mock");
    expect(result.reconciliation.outcomes.some((o) => o.classification === "IN_SYNC")).toBe(true);
    expect(result.escalation.escalationsAttempted).toBe(0);
    expect(result.escalation.outcomes).toHaveLength(0);
  });

  it("drift drill: NOT_FOUND_AT_VENUE trips RECON_MISMATCH with automatic origin", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "startup-not-found-252",
        idempotencyKey: "idem-startup-not-found-252",
      }),
    );
    await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const runner = createRunnerWithConnector(repo, stubConnector());
    const result = await runner.runStartupReconciliation(context, "mock");

    const notFound = result.reconciliation.outcomes.find(
      (o) => o.classification === "NOT_FOUND_AT_VENUE",
    );
    expect(notFound).toBeDefined();

    expect(result.escalation.escalationsAttempted).toBe(1);
    expect(result.escalation.outcomes[0]?.switchType).toBe("RECON_MISMATCH");
    expect(result.escalation.outcomes[0]?.status).toBe("tripped");

    const db = getDb();
    const row = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgA),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];

    expect(row?.state).toBe("ACTIVE");
    expect(row?.origin).toBe("automatic");
  });

  it("phantom terminal drift trips RECON_MISMATCH via open-scan TERMINAL_DRIFT", async () => {
    const context = requireOrgContext(orgA);
    await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "anchor-terminal-drift-252",
        idempotencyKey: "anchor-terminal-drift-252",
      }),
    );

    const clientOrderId = "startup-terminal-drift-252";
    const created = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-startup-terminal-drift-252" }),
    );
    await advanceTo(repo, context, created, [
      "RISK_APPROVED",
      "SENT_TO_EXCHANGE",
      "ACCEPTED",
      "FILLED",
    ]);

    const phantom: Order = {
      orderId: "phantom-startup-252",
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

    const runner = createRunnerWithConnector(
      repo,
      stubConnector({
        getOpenOrders: vi.fn().mockResolvedValue([phantom]),
      }),
    );
    const result = await runner.runStartupReconciliation(context, "mock");

    const drift = result.reconciliation.outcomes.find((o) => o.classification === "TERMINAL_DRIFT");
    expect(drift).toBeDefined();

    expect(result.escalation.escalationsAttempted).toBe(1);
    expect(result.escalation.outcomes[0]?.switchType).toBe("RECON_MISMATCH");
    expect(result.escalation.outcomes[0]?.status).toBe("tripped");
  });

  it("connector read failure yields AMBIGUOUS_STALE and trips STALE_STATE", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "startup-ambiguous-252",
        idempotencyKey: "idem-startup-ambiguous-252",
      }),
    );
    await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const runner = createRunnerWithConnector(
      repo,
      stubConnector({
        getOpenOrders: vi.fn().mockRejectedValue(new Error("connector unavailable")),
      }),
    );
    const result = await runner.runStartupReconciliation(context, "mock");

    const ambiguous = result.reconciliation.outcomes.find(
      (o) => o.classification === "AMBIGUOUS_STALE",
    );
    expect(ambiguous).toBeDefined();

    expect(result.escalation.escalationsAttempted).toBe(1);
    expect(result.escalation.outcomes[0]?.switchType).toBe("STALE_STATE");
    expect(result.escalation.outcomes[0]?.status).toBe("tripped");
  });

  it("SKIPPED_CONFLICT produces zero escalation activations", async () => {
    const context = requireOrgContext(orgA);
    const triggerPort = createSqliteAutomaticTriggerDispatcher(getDb());
    const activateSpy = vi.spyOn(triggerPort, "activate");

    const result = await runStartupReconciliation(context, "mock", {
      reconciliationService: {
        reconcile: async () => ({
          organizationId: orgA,
          runStartedAt: new Date(NOW),
          outcomes: [
            {
              clientOrderId: "startup-skipped-252",
              classification: "SKIPPED_CONFLICT",
              recordedFills: [],
              markedReconciliationRequired: false,
            },
          ],
          counts: {
            IN_SYNC: 0,
            VENUE_ACKED: 0,
            FILL_PROGRESS: 0,
            VENUE_TERMINALIZED: 0,
            NOT_FOUND_AT_VENUE: 0,
            UNKNOWN_POSITION: 0,
            AMBIGUOUS_STALE: 0,
            TERMINAL_DRIFT: 0,
            SKIPPED_CONFLICT: 1,
          },
        }),
      },
      triggerPort,
    });

    expect(
      result.reconciliation.outcomes.some((o) => o.classification === "SKIPPED_CONFLICT"),
    ).toBe(true);
    expect(result.escalation.escalationsAttempted).toBe(0);
    expect(activateSpy).not.toHaveBeenCalled();
  });

  it("second startup returns already_active without duplicate trip audit", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "startup-repeat-252",
        idempotencyKey: "idem-startup-repeat-252",
      }),
    );
    await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const runner = createRunnerWithConnector(repo, stubConnector());
    const first = await runner.runStartupReconciliation(context, "mock");
    expect(first.escalation.outcomes[0]?.status).toBe("tripped");

    const db = getDb();
    const auditsAfterFirst = db.select().from(auditLogs).all().length;

    const second = await runner.runStartupReconciliation(context, "mock");
    expect(second.escalation.outcomes[0]?.status).toBe("already_active");
    expect(db.select().from(auditLogs).all().length).toBe(auditsAfterFirst);
  });

  it("does not run escalation when reconcile throws", async () => {
    const context = requireOrgContext(orgA);
    const reconciliationService: ReconciliationService = {
      reconcile: vi.fn().mockRejectedValue(new Error("reconcile failed")),
    };
    const triggerPort = createSqliteAutomaticTriggerDispatcher(getDb());
    const activateSpy = vi.spyOn(triggerPort, "activate");

    await expect(
      runStartupReconciliation(context, "mock", {
        reconciliationService,
        triggerPort,
      }),
    ).rejects.toThrow(/reconcile failed/i);

    expect(activateSpy).not.toHaveBeenCalled();
  });

  it("calls reconcile with open target before escalation", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "startup-order-252",
        idempotencyKey: "idem-startup-order-252",
      }),
    );
    await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const reconciliationService = createReconciliationServiceFromDeps({
      orderRepository: repo,
      connectorForMode: () => stubConnector(),
      writeAudit: vi.fn(() => "audit"),
      nowMs: () => NOW,
    });
    const reconcileSpy = vi.spyOn(reconciliationService, "reconcile");
    const triggerPort = createSqliteAutomaticTriggerDispatcher(getDb());
    const activateSpy = vi.spyOn(triggerPort, "activate");

    await runStartupReconciliation(context, "mock", {
      reconciliationService,
      triggerPort,
    });

    expect(reconcileSpy).toHaveBeenCalledWith(context, {
      kind: "open",
      executionMode: "mock",
    });
    expect(activateSpy).toHaveBeenCalled();
    expect(reconcileSpy.mock.invocationCallOrder[0]).toBeLessThan(
      activateSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("sqlite factory runner executes startup reconciliation", async () => {
    const context = requireOrgContext(orgA);
    const runner = createSqliteStartupReconciliationRunner(getDb(), {
      reconciliationService: createReconciliationServiceFromDeps({
        orderRepository: repo,
        connectorForMode: () => stubConnector(),
        writeAudit: vi.fn(() => "audit"),
        nowMs: () => NOW,
      }),
    });

    const result = await runner.runStartupReconciliation(context, "mock");
    expect(result.organizationId).toBe(orgA);
    expect(result.reconciliation).toBeDefined();
    expect(result.escalation).toBeDefined();
  });

  it("startup drill emits one startup_complete and does not duplicate critical mismatch events", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "startup-telemetry-255",
        idempotencyKey: "idem-startup-telemetry-255",
      }),
    );
    await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const { lines, sink } = captureTelemetrySink();
    const runner = createRunnerWithConnector(repo, stubConnector(), sink);
    const result = await runner.runStartupReconciliation(context, "mock");

    const events = parseReconciliationEvents(lines);
    const runComplete = events.filter((event) => event.outcome === "run_complete");
    const startupComplete = events.filter((event) => event.outcome === "startup_complete");
    const critical = events.filter(
      (event) => event.outcome !== "run_complete" && event.outcome !== "startup_complete",
    );

    expect(runComplete).toHaveLength(1);
    expect(startupComplete).toHaveLength(1);
    expect(startupComplete[0]?.severity).toBe("info");
    expect(startupComplete[0]?.escalations_attempted).toBe(result.escalation.escalationsAttempted);
    expect(critical.length).toBe(
      result.reconciliation.outcomes.filter((o) =>
        ["NOT_FOUND_AT_VENUE", "UNKNOWN_POSITION", "AMBIGUOUS_STALE", "TERMINAL_DRIFT"].includes(
          o.classification,
        ),
      ).length,
    );
    expect(JSON.stringify(events)).not.toContain(created.id);
  });

  it("startup_complete includes escalations_attempted when escalation fires", async () => {
    const context = requireOrgContext(orgA);
    const created = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "startup-escalation-telemetry-255",
        idempotencyKey: "idem-startup-escalation-telemetry-255",
      }),
    );
    await advanceTo(repo, context, created, ["RISK_APPROVED", "SENT_TO_EXCHANGE"]);

    const { lines, sink } = captureTelemetrySink();
    const runner = createRunnerWithConnector(repo, stubConnector(), sink);
    const result = await runner.runStartupReconciliation(context, "mock");

    const startupComplete = parseReconciliationEvents(lines).find(
      (event) => event.outcome === "startup_complete",
    );
    expect(result.escalation.escalationsAttempted).toBeGreaterThanOrEqual(1);
    expect(startupComplete?.escalations_attempted).toBe(result.escalation.escalationsAttempted);
  });
});
