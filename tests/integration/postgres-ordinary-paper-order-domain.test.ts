import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { createOrdinaryPaperOrderRepositoryPostgres } from "@/lib/trader/execution/ordinary-paper-order-repository-postgres";
import { EXECUTION_FACT_KIND_VENUE_FILL } from "@/lib/trader/execution/historical-execution-model.types";
import { createPostgresOrderRepository } from "@/lib/trader/execution/repository-adapters";
import { createPostgresReconciliationService } from "@/lib/trader/execution/reconciliation-service";
import { buildPaperLoopDepsFromEnv } from "@/lib/trader/paper/build-worker-deps";
import { runPaperLoopCycle } from "@/lib/trader/paper/run-paper-loop-cycle";
import { loadPaperFillEvents } from "@/lib/trader/paper/load-paper-fill-events";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { derivePortfolioAccountState } from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER = "00000000-0000-4000-8022-000000012002";

describe.skipIf(!enabled || !url)("DEE-1202 ordinary paper order domain", () => {
  let organizationId: string;
  let generic: ReturnType<typeof createPostgresOrderRepository>;
  let ordinary: ReturnType<typeof createOrdinaryPaperOrderRepositoryPostgres>;
  let ordinaryPaper: ReturnType<typeof createOrdinaryPaperOrderRepositoryPostgres>;
  const context = () => requireOrgContext(organizationId);
  const orderInput = (tag: string, overrides: Record<string, unknown> = {}) => ({
    venue: "mock",
    executionMode: "mock" as const,
    symbol: "BTC/USDT",
    side: "buy" as const,
    type: "limit" as const,
    price: "100",
    quantity: "1",
    clientOrderId: `dee1202-${tag}`,
    idempotencyKey: `dee1202-${tag}`,
    riskDecisionId: crypto.randomUUID(),
    ...overrides,
  });

  async function toAccepted(orderId: string) {
    for (const [expectedStateVersion, toState] of [
      [1, "RISK_APPROVED"], [2, "SENT_TO_EXCHANGE"], [3, "ACCEPTED"],
    ] as const) {
      await generic.transitionOrder(context(), { orderId, expectedStateVersion, toState });
    }
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    const local = parsed.hostname === "127.0.0.1" && parsed.port === "54329" &&
      parsed.username === "waia_validate" &&
      /^waia_hsv2_it_oct01_1202_[a-z0-9]+$/.test(parsed.pathname.slice(1));
    const ci = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" &&
      url === "postgresql://waia_it:waia_it@127.0.0.1:5432/waia_it";
    if (!local && !ci) {
      throw new Error("DEE1202_ISOLATED_POSTGRES_REQUIRED");
    }
    const proof = postgres(url!, { max: 1 });
    try {
      const rows = await proof`select current_database() as database, current_user as role`;
      if (rows[0]?.database !== parsed.pathname.slice(1) || rows[0]?.role !== parsed.username) {
        throw new Error("DEE1202_POSTGRES_IDENTITY_MISMATCH");
      }
    } finally {
      await proof.end({ timeout: 5 });
    }
    organizationId = await seedHtrPostgresUser(url!, USER, "DEE-1202 Ordinary Paper Domain");
    const db = getPostgresDrizzle();
    generic = createPostgresOrderRepository(db);
    ordinary = createOrdinaryPaperOrderRepositoryPostgres(db, organizationId, "mock");
    ordinaryPaper = createOrdinaryPaperOrderRepositoryPostgres(db, organizationId, "paper");
  });

  afterAll(async () => {
    await resetPostgresSingletonForTests();
  });

  it("reproduces old fill contamination and excludes terminal historical and half-tagged fills", async () => {
    const own = await generic.createOrder(context(), orderInput("own-filled"));
    const historical = await generic.createOrder(context(), orderInput("historical-filled", {
      venue: "HISTORICAL_SIMULATED_EXCHANGE",
      historicalRunId: "dee1202-run",
      historicalAccountKey: "dee1202-account",
    }));
    await expect(generic.createOrder(context(), orderInput("half-filled", {
      historicalRunId: "dee1202-malformed-run",
    }))).rejects.toThrow("HISTORICAL_RECONCILIATION_REFUSED:PARTIAL_SCOPE");
    const ownPaper = await generic.createOrder(context(), orderInput("own-paper-filled", {
      venue: "HTX", executionMode: "paper",
    }));
    for (const row of [own, historical, ownPaper]) {
      await toAccepted(row.id);
      await (row.id === ownPaper.id ? ordinaryPaper : generic).recordFill(context(), {
        orderId: row.id,
        exchangeTradeId: `trade-${row.id}`,
        price: "100",
        quantity: "1",
        ...(row.id === ownPaper.id ? { executionFactKind: EXECUTION_FACT_KIND_VENUE_FILL } : {}),
        executedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await generic.transitionOrder(context(), {
        orderId: row.id,
        expectedStateVersion: 4,
        toState: "FILLED",
        filledQuantity: "1",
        avgFillPrice: "100",
      });
    }

    const oldSource = await loadPaperFillEvents({ context: context(), orderRepository: generic,
      executionMode: "mock", allowOfflineRebuild: true });
    expect(oldSource.filledOrders.map(row => row.id)).toContain(historical.id);

    const scoped = await loadPaperFillEvents({ context: context(), orderRepository: ordinary,
      executionMode: "mock", allowOfflineRebuild: true });
    expect(scoped.filledOrders.map(row => row.id)).toEqual([own.id]);
    expect(scoped.fillEvents.map(event => event.order.id)).toEqual([own.id]);

    const state = await derivePortfolioAccountState({
      context: context(), orderRepository: ordinaryPaper, executionMode: "paper",
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "1000" },
      limits: { maxRiskPerTradePct: "0.01", maxPortfolioRiskPct: "0.05",
        maxConcurrentPositions: 3, maxNotional: "10000" },
      stopDistanceProvider: defaultStopDistanceProvider,
      markPrices: { marks: { "BTC/USDT": "100" } },
    });
    expect(state.availableBalanceUsdt).toBe("900");
    expect(state.openPositionCount).toBe(1);
    expect(state.equityUsdt).toBe("1000");

    const built = await buildPaperLoopDepsFromEnv({
      DATABASE_URL_POSTGRES: url!,
      PAPER_LOOP_ENABLED: "1",
      PAPER_LOOP_ORGANIZATION_ID: organizationId,
      PAPER_LOOP_ACCOUNT_KEY: "dee1202-paper-account",
    });
    try {
      const actualWorker = await loadPaperFillEvents({ context: context(),
        orderRepository: built.deps.orderRepository, executionMode: "paper", allowOfflineRebuild: true });
      expect(actualWorker.filledOrders.map(row => row.id)).toEqual([ownPaper.id]);
      const actualPortfolio = await derivePortfolioAccountState({
        context: context(), orderRepository: built.deps.orderRepository, executionMode: "paper",
        runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "1000" },
        limits: { maxRiskPerTradePct: "0.01", maxPortfolioRiskPct: "0.05",
          maxConcurrentPositions: 3, maxNotional: "10000" },
        stopDistanceProvider: defaultStopDistanceProvider,
        markPrices: { marks: { "BTC/USDT": "100" } },
      });
      expect(actualPortfolio.availableBalanceUsdt).toBe("900");
      expect(actualPortfolio.openPositionCount).toBe(1);
      const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "dee1202-paper" });
      const next = replay.next();
      expect(next.done).toBe(false);
      if (next.done) throw new Error("DEE1202_MISSING_REPLAY_FIXTURE");
      const filters: Array<string | undefined> = [];
      const originalListOrders = built.deps.orderRepository.listOrders.bind(built.deps.orderRepository);
      const originalListOpen = built.deps.orderRepository.listOpenOrders.bind(built.deps.orderRepository);
      built.deps.orderRepository = {
        ...built.deps.orderRepository,
        listOrders: async (ctx, filter) => {
          filters.push(filter?.executionMode);
          return originalListOrders(ctx, filter);
        },
        listOpenOrders: async (ctx, filter) => {
          filters.push(filter?.executionMode);
          return originalListOpen(ctx, filter);
        },
      };
      built.deps.poll = { fetchSnapshot: async () => next.snapshot, reset() {} };
      const cycle = await runPaperLoopCycle({ deps: built.deps });
      expect(cycle.organizationId).toBe(organizationId);
      expect(filters).toContain("paper");
      expect(filters).not.toContain("mock");
    } finally {
      await built.dispose();
    }
  });

  it("reproduces old startup mutation but scoped reconciliation leaves historical orders untouched", async () => {
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    const oldRow = await generic.createOrder(context(), orderInput("historical-old-open", {
      venue: "HISTORICAL_SIMULATED_EXCHANGE", historicalRunId: "run-old", historicalAccountKey: "account-old",
    }));
    await toAccepted(oldRow.id);
    const oldService = createPostgresReconciliationService(getPostgresDrizzle(), {
      orderRepository: generic, connectorForMode: () => connector,
    });
    const oldReport = await oldService.reconcile(context(), { kind: "open", executionMode: "mock" });
    expect(oldReport.outcomes.some(row => row.orderId === oldRow.id &&
      row.classification === "NOT_FOUND_AT_VENUE")).toBe(true);
    expect((await generic.getOrderById(context(), oldRow.id))?.state).toBe("RECONCILIATION_REQUIRED");

    const protectedRow = await generic.createOrder(context(), orderInput("historical-protected-open", {
      venue: "HISTORICAL_SIMULATED_EXCHANGE", historicalRunId: "run-protected",
      historicalAccountKey: "account-protected",
    }));
    await toAccepted(protectedRow.id);
    const ownOpen = await generic.createOrder(context(), orderInput("ordinary-open"));
    await toAccepted(ownOpen.id);
    const beforeEvents = await generic.listEvents(context(), protectedRow.id);
    const scopedService = createPostgresReconciliationService(getPostgresDrizzle(), {
      orderRepository: ordinary, connectorForMode: () => connector,
    });
    const report = await scopedService.reconcile(context(), { kind: "open", executionMode: "mock" });
    expect(report.outcomes.some(row => row.orderId === protectedRow.id)).toBe(false);
    expect((await generic.getOrderById(context(), protectedRow.id))?.state).toBe("ACCEPTED");
    expect(await generic.listEvents(context(), protectedRow.id)).toEqual(beforeEvents);

    const built = await buildPaperLoopDepsFromEnv({
      DATABASE_URL_POSTGRES: url!, PAPER_LOOP_ENABLED: "1",
      PAPER_LOOP_ORGANIZATION_ID: organizationId, PAPER_LOOP_ACCOUNT_KEY: "dee1202-paper-account",
    });
    try {
      const workerStartup = await built.deps.startupReconciliation.runStartupReconciliation(context(), "mock");
      expect(workerStartup.reconciliation.outcomes.some(row => row.orderId === protectedRow.id)).toBe(false);
      expect(workerStartup.reconciliation.outcomes.some(row => row.orderId === ownOpen.id)).toBe(true);
    } finally {
      await built.dispose();
    }
    expect((await generic.getOrderById(context(), protectedRow.id))?.state).toBe("ACCEPTED");
  });

  it("scopes direct reads and refuses foreign ID writes and key adoption", async () => {
    const foreign = await generic.createOrder(context(), orderInput("foreign-direct", {
      venue: "HISTORICAL_SIMULATED_EXCHANGE", historicalRunId: "direct-run",
      historicalAccountKey: "direct-account",
    }));
    const before = await generic.getOrderById(context(), foreign.id);
    const beforeEvents = await generic.listEvents(context(), foreign.id);
    expect(await ordinary.getOrderById(context(), foreign.id)).toBeNull();
    expect(await ordinary.findOrderByClientOrderId(context(), foreign.clientOrderId)).toBeNull();
    expect(await ordinary.findOrderByIdempotencyKey(context(), foreign.idempotencyKey)).toBeNull();
    expect(await ordinary.listEvents(context(), foreign.id)).toEqual([]);
    expect(await ordinary.listFills(context(), foreign.id)).toEqual([]);
    expect((await ordinary.listOrders(context(), { executionMode: "mock" }))
      .every(row => row.venue === "mock" && row.historicalRunId == null &&
        row.historicalAccountKey == null)).toBe(true);
    expect((await ordinary.listOpenOrders(context(), { executionMode: "mock" }))
      .every(row => row.venue === "mock" && row.historicalRunId == null &&
        row.historicalAccountKey == null)).toBe(true);
    await expect(ordinary.transitionOrder(context(), { orderId: foreign.id,
      expectedStateVersion: 1, toState: "RISK_APPROVED" })).rejects.toThrow();
    await expect(ordinary.recordFill(context(), { orderId: foreign.id,
      exchangeTradeId: "foreign-direct-fill", price: "100", quantity: "1",
      executedAt: new Date("2026-01-01T00:00:00.000Z") })).rejects.toThrow();
    await expect(ordinary.createOrder(context(), orderInput("foreign-direct", {
      idempotencyKey: "fresh-ordinary-key",
    }))).rejects.toThrow();
    await expect(ordinary.createOrder(context(), orderInput("fresh-client-foreign-idem", {
      idempotencyKey: foreign.idempotencyKey,
    }))).rejects.toThrow();
    await expect(ordinary.createOrder(context(), orderInput("foreign-input", {
      historicalRunId: "forbidden-run", historicalAccountKey: "forbidden-account",
    }))).rejects.toThrow("ORDINARY_PAPER_ORDER_DOMAIN_FORBIDDEN");
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    await connector.placeOrder({ clientOrderId: foreign.clientOrderId, symbol: foreign.symbol,
      side: foreign.side, type: foreign.type, price: foreign.price ?? undefined,
      quantity: foreign.quantity });
    const reconciliation = createPostgresReconciliationService(getPostgresDrizzle(), {
      orderRepository: ordinary, connectorForMode: () => connector,
    });
    const unknown = await reconciliation.reconcile(context(), { kind: "open", executionMode: "mock" });
    expect(unknown.outcomes.some(row => row.clientOrderId === foreign.clientOrderId &&
      row.classification === "UNKNOWN_POSITION")).toBe(true);
    expect(await generic.getOrderById(context(), foreign.id)).toEqual(before);
    expect(await generic.listEvents(context(), foreign.id)).toEqual(beforeEvents);
    expect(await generic.listFills(context(), foreign.id)).toEqual([]);
  });

  it("keeps exact mock mode, venue, organization, and disabled workers outside the domain", async () => {
    const own = await ordinary.createOrder(context(), orderInput("exact-own"));
    const paperMode = await generic.createOrder(context(), orderInput("paper-mode", {
      venue: "HTX", executionMode: "paper",
    }));
    const otherVenue = await generic.createOrder(context(), orderInput("other-venue", {
      venue: "HTX",
    }));
    expect((await ordinary.listOrders(context())).map(row => row.id)).toContain(own.id);
    for (const foreign of [paperMode, otherVenue]) {
      expect(await ordinary.getOrderById(context(), foreign.id)).toBeNull();
      expect(await ordinary.findOrderByClientOrderId(context(), foreign.clientOrderId)).toBeNull();
      expect(await ordinary.findOrderByIdempotencyKey(context(), foreign.idempotencyKey)).toBeNull();
      expect(await ordinary.listEvents(context(), foreign.id)).toEqual([]);
      expect(await ordinary.listFills(context(), foreign.id)).toEqual([]);
      await expect(ordinary.transitionOrder(context(), { orderId: foreign.id,
        expectedStateVersion: 1, toState: "RISK_APPROVED" })).rejects.toThrow();
      await expect(ordinary.createOrder(context(), orderInput(`adopt-${foreign.id}`, {
        idempotencyKey: foreign.idempotencyKey,
      }))).rejects.toThrow();
    }
    await expect(ordinary.createOrder(context(), orderInput("paper-create", {
      executionMode: "paper",
    }))).rejects.toThrow("ORDINARY_PAPER_ORDER_DOMAIN_FORBIDDEN");
    await expect(ordinaryPaper.createOrder(context(), orderInput("mock-create")))
      .rejects.toThrow("ORDINARY_PAPER_ORDER_DOMAIN_FORBIDDEN");
    await expect(ordinaryPaper.createOrder(context(), orderInput("paper-wrong-venue", {
      executionMode: "paper",
    }))).rejects.toThrow("ORDINARY_PAPER_ORDER_DOMAIN_FORBIDDEN");
    const createdPaper = await ordinaryPaper.createOrder(context(), orderInput("paper-valid", {
      venue: "HTX", executionMode: "paper",
    }));
    expect(createdPaper.venue).toBe("HTX");
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    await connector.placeOrder({ clientOrderId: paperMode.clientOrderId, symbol: paperMode.symbol,
      side: paperMode.side, type: paperMode.type, price: paperMode.price ?? undefined,
      quantity: paperMode.quantity });
    const mockReconciliation = createPostgresReconciliationService(getPostgresDrizzle(), {
      orderRepository: ordinary, connectorForMode: () => connector,
    });
    const paperClientSeenByMock = await mockReconciliation.reconcile(context(), {
      kind: "open", executionMode: "mock",
    });
    expect(paperClientSeenByMock.outcomes.some(outcome =>
      outcome.clientOrderId === paperMode.clientOrderId &&
      outcome.classification === "UNKNOWN_POSITION")).toBe(true);
    expect((await ordinaryPaper.listOrders(context())).map(row => row.id)).toContain(paperMode.id);
    expect((await ordinaryPaper.listOrders(context())).map(row => row.id)).toContain(createdPaper.id);
    expect((await ordinaryPaper.listOrders(context())).map(row => row.id)).not.toContain(own.id);
    expect((await ordinary.listOrders(context())).every(row =>
      row.venue === "mock" && row.executionMode === "mock" &&
      row.historicalRunId == null && row.historicalAccountKey == null)).toBe(true);
    const otherOrg = requireOrgContext("00000000-0000-4000-8022-000000012003");
    await expect(ordinary.getOrderById(otherOrg, own.id)).rejects.toThrow("ORDINARY_PAPER_ORG_MISMATCH");
    await expect(ordinary.transitionOrder(otherOrg, { orderId: own.id,
      expectedStateVersion: 1, toState: "RISK_APPROVED" })).rejects.toThrow("ORDINARY_PAPER_ORG_MISMATCH");
    const disabled = await buildPaperLoopDepsFromEnv({ DATABASE_URL_POSTGRES: url!, PAPER_LOOP_ENABLED: "0" });
    try {
      await expect(disabled.deps.orderRepository.listOrders(context())).rejects.toThrow(
        "ORDINARY_PAPER_WORKER_DISABLED");
    } finally {
      await disabled.dispose();
    }
    expect((await generic.getOrderById(context(), paperMode.id))?.state).toBe("CREATED");
  });

  it("refuses an existing foreign fill ID even when an ordinary parent is locked", async () => {
    const foreign = await generic.createOrder(context(), orderInput("foreign-fill-id-parent", {
      venue: "HTX",
    }));
    const own = await ordinary.createOrder(context(), orderInput("own-fill-id-parent"));
    await toAccepted(foreign.id);
    await toAccepted(own.id);
    const fillId = crypto.randomUUID();
    const shared = { fillId, exchangeTradeId: "dee1202-shared-fill-id", price: "100",
      quantity: "1", executedAt: new Date("2026-01-01T00:00:00.000Z") };
    const foreignFill = await generic.recordFill(context(), { ...shared, orderId: foreign.id });
    const foreignOrderBefore = await generic.getOrderById(context(), foreign.id);
    const foreignEventsBefore = await generic.listEvents(context(), foreign.id);
    await expect(ordinary.recordFill(context(), { ...shared, orderId: own.id }))
      .rejects.toThrow("ORDINARY_PAPER_FILL_ID_FOREIGN_ORDER");
    expect(await generic.listFills(context(), own.id)).toEqual([]);
    expect(await generic.listFills(context(), foreign.id)).toEqual([foreignFill]);
    expect(await generic.getOrderById(context(), foreign.id)).toEqual(foreignOrderBefore);
    expect(await generic.listEvents(context(), foreign.id)).toEqual(foreignEventsBefore);
  });

  it("captures caller-owned transition and fill input before a blocked parent lock", async () => {
    const target = await ordinary.createOrder(context(), orderInput("lock-target"));
    const foreign = await generic.createOrder(context(), orderInput("lock-foreign", {
      venue: "HISTORICAL_SIMULATED_EXCHANGE", historicalRunId: "lock-run",
      historicalAccountKey: "lock-account",
    }));
    const client = postgres(url!, { max: 3 });
    const waitForBlockedOrderLock = async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await client`select count(*)::int as blocked from pg_stat_activity
          where datname = current_database() and usename = current_user
            and wait_event_type = 'Lock' and query like '%trader_orders%'`;
        if (Number(rows[0]?.blocked) > 0) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("DEE1202_EXPECTED_BLOCKED_PARENT_LOCK");
    };
    const hold = async (orderId: string, body: (release: () => void) => Promise<void>) => {
      let release!: () => void;
      let locked!: () => void;
      const released = new Promise<void>(resolve => { release = resolve; });
      const acquired = new Promise<void>(resolve => { locked = resolve; });
      const blocking = client.begin(async tx => {
        await tx`select id from trader_orders where id = ${orderId} for update`;
        locked();
        await released;
      });
      await acquired;
      try { await body(release); } finally { release(); await blocking; }
    };
    try {
      const mutableContext = { organizationId };
      const transition = { orderId: target.id, expectedStateVersion: 1,
        toState: "RISK_APPROVED" as const,
        occurredAt: new Date("2026-01-01T00:00:00.000Z") };
      await hold(target.id, async release => {
        const pending = ordinary.transitionOrder(mutableContext, transition);
        await waitForBlockedOrderLock();
        mutableContext.organizationId = "00000000-0000-4000-8022-000000012003";
        transition.orderId = foreign.id;
        transition.occurredAt.setTime(Date.parse("2026-01-02T00:00:00.000Z"));
        release();
        await pending;
      });
      expect((await generic.getOrderById(context(), target.id))?.state).toBe("RISK_APPROVED");
      expect((await generic.listEvents(context(), target.id)).at(-1)?.occurredAt.toISOString())
        .toBe("2026-01-01T00:00:00.000Z");
      expect((await generic.getOrderById(context(), foreign.id))?.state).toBe("CREATED");

      const fillTarget = await ordinary.createOrder(context(), orderInput("lock-fill-target"));
      await toAccepted(fillTarget.id);
      const fillContext = { organizationId };
      const fill = { orderId: fillTarget.id, exchangeTradeId: "lock-fill-trade", price: "100",
        quantity: "1", executedAt: new Date("2026-01-01T00:00:00.000Z") };
      await hold(fillTarget.id, async release => {
        const pending = ordinary.recordFill(fillContext, fill);
        await waitForBlockedOrderLock();
        fillContext.organizationId = "00000000-0000-4000-8022-000000012003";
        fill.orderId = foreign.id;
        fill.executedAt.setTime(Date.parse("2026-01-02T00:00:00.000Z"));
        release();
        await pending;
      });
      expect((await generic.listFills(context(), fillTarget.id))[0]?.executedAt.toISOString())
        .toBe("2026-01-01T00:00:00.000Z");
      expect(await generic.listFills(context(), foreign.id)).toEqual([]);
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});
