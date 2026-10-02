/** Native proof that research mock-order storage is isolated by run + account. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { createPostgresOrderRepository } from "@/lib/trader/execution/repository-adapters";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { EXECUTION_FACT_KIND_VENUE_FILL } from "@/lib/trader/execution/historical-execution-model.types";
import { buildRecordFillPayload } from "@/lib/trader/execution/historical-simulated-exchange";
import type { RecordFillInput, RecordFillProgressInput } from "@/lib/trader/execution/order-repository.types";
import {
  createHistoricalMockOrderRepositoryFromExecutor,
  createHistoricalMockOrderRepositoryPostgres,
  deleteHistoricalMockExecutionArtifactsPostgres,
} from "@/lib/trader/execution/historical-mock-order-repository-postgres";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!enabled || !url)("DEE-1159 scoped research mock ledger", () => {
  let ownerSql: postgres.Sql;
  let db: WaiaPostgresDb;
  let organizationA = "";
  let organizationB = "";
  const userIds: string[] = [];

  async function seedOrganization(label: string): Promise<string> {
    const userId = randomUUID();
    userIds.push(userId);
    await ownerSql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING`;
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: label,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
    return ensureUserCoreSeedPostgres(db, { userId, displayName: label });
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    const localProof = parsed.hostname === "127.0.0.1" && parsed.port === "54329" &&
      decodeURIComponent(parsed.username) === "waia_validate" &&
      /^\/waia_hsv2_it_oct01_mock_ledger_scope_[a-z0-9_]+$/.test(parsed.pathname);
    const ciProof = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" &&
      url === "postgresql://waia_it:waia_it@127.0.0.1:5432/waia_dee1159" &&
      process.env.DATABASE_URL_POSTGRES_SESSION === url;
    if ((!localProof && !ciProof) || process.env.WAIA_DB_BACKEND !== "postgres") {
      throw new Error("DEE1159_MOCK_LEDGER_TEST_DATABASE_REFUSED");
    }
    ownerSql = postgres(url!, { max: 4, prepare: false });
    db = drizzle(ownerSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    organizationA = await seedOrganization("DEE-1159 mock ledger A");
    organizationB = await seedOrganization("DEE-1159 mock ledger B");
  }, 30_000);

  afterAll(async () => {
    // The disposable validation database retains this suite's append-only
    // fill/economics fixtures; it is never reused for another proof run.
    await ownerSql?.end({ timeout: 5 });
  }, 20_000);

  const makeScope = (organizationId: string, historicalRunId: string, historicalAccountKey: string) => ({
    organizationId,
    historicalRunId,
    historicalAccountKey,
  });

  function makeInput(label: string, quantity = "1") {
    return {
      venue: "mock",
      executionMode: "mock" as const,
      symbol: "BTC/USDT",
      side: "buy" as const,
      type: "market" as const,
      price: "100",
      quantity,
      clientOrderId: `dee1159-${label}-${randomUUID()}`,
      idempotencyKey: `dee1159-${label}-${randomUUID()}`,
      riskDecisionId: randomUUID(),
    };
  }

  function makeHistoricalFillPayload(
    orderId: string,
    sequence: number,
    options?: { quantity?: string; remainingQuantityAfter?: string; filledQuantity?: string; avgFillPrice?: string },
  ): RecordFillInput;
  function makeHistoricalFillPayload(
    orderId: string,
    sequence: number,
    options: { quantity?: string; remainingQuantityAfter?: string; filledQuantity?: string; avgFillPrice?: string; progress: true },
  ): RecordFillProgressInput;
  function makeHistoricalFillPayload(
    orderId: string,
    sequence: number,
    options: {
      quantity?: string;
      remainingQuantityAfter?: string;
      filledQuantity?: string;
      avgFillPrice?: string;
      progress?: boolean;
    } = {},
  ): RecordFillInput | RecordFillProgressInput {
    const quantity = options.quantity ?? "1";
    const event = {
      orderId,
      organizationId: organizationA,
      symbol: "BTCUSDT",
      side: "buy" as const,
      fillSequence: sequence,
      sourceBarIndex: sequence,
      sourceBar: makeWp17Bar(sequence),
      grossFillPrice: "100",
      sliceQuantity: quantity,
      remainingQuantityAfter: options.remainingQuantityAfter ?? "0",
      acceptedAt: new Date("2026-09-01T00:00:00.000Z"),
      fillTimestamp: new Date("2026-09-01T00:01:00.000Z"),
      submitLatencyMs: 50,
      cancelLatencyMs: null,
    };
    const economics = applyHistoricalExecutionEconomics(event, createHistoricalExecutionModelV1());
    return buildRecordFillPayload(
      event, economics, organizationA, orderId, "buy", options.avgFillPrice ?? economics.netFillPrice,
      options.filledQuantity ?? quantity, options.progress ?? false,
    );
  }

  it("tags new orders and cleanup deletes only the exact run/account scope", async () => {
    const context = requireOrgContext(organizationA);
    const sameAccountOtherRun = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-B", "account-X"),
    );
    const sameRunOtherAccount = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-A", "account-Y"),
    );
    const selected = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-A", "account-X"),
    );
    const ordinary = createPostgresOrderRepository(db);

    const selectedOrder = await selected.createOrder(context, makeInput("selected"));
    const otherRunOrder = await sameAccountOtherRun.createOrder(context, makeInput("other-run"));
    const otherAccountOrder = await sameRunOtherAccount.createOrder(context, makeInput("other-account"));
    const unscopedOrder = await ordinary.createOrder(context, makeInput("unscoped"));
    const paperOrder = await ordinary.createOrder(context, {
      ...makeInput("paper"), executionMode: "paper",
    });
    const executorBoundOrder = await db.transaction(async tx =>
      createHistoricalMockOrderRepositoryFromExecutor(
        tx,
        makeScope(organizationA, "run-executor", "account-X"),
      ).createOrder(context, makeInput("executor-bound")),
    );

    expect(selectedOrder).toMatchObject({
      executionMode: "mock",
      historicalRunId: "run-A",
      historicalAccountKey: "account-X",
    });
    expect(await selected.listOrders(context, { executionMode: "mock" })).toEqual([selectedOrder]);

    await deleteHistoricalMockExecutionArtifactsPostgres(
      db,
      makeScope(organizationA, "run-A", "account-X"),
    );

    expect(await selected.listOrders(context, { executionMode: "mock" })).toEqual([]);
    expect((await ordinary.listOrders(context)).map(order => order.id).sort()).toEqual(
      [otherRunOrder.id, otherAccountOrder.id, unscopedOrder.id, paperOrder.id, executorBoundOrder.id].sort(),
    );
  });

  it("does not expose another run through direct reads, fills, events, or ID lookups", async () => {
    const context = requireOrgContext(organizationA);
    const scopeA = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-read-A", "account-X"),
    );
    const scopeB = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-read-B", "account-X"),
    );
    const orderA = await scopeA.createOrder(context, makeInput("read-A"));
    const orderB = await scopeB.createOrder(context, makeInput("read-B"));

    expect(await scopeA.listOrders(context, { executionMode: "mock" })).toEqual([orderA]);
    expect(await scopeA.getOrderById(context, orderB.id)).toBeNull();
    expect(await scopeA.findOrderByClientOrderId(context, orderB.clientOrderId)).toBeNull();
    expect(await scopeA.findOrderByIdempotencyKey(context, orderB.idempotencyKey)).toBeNull();
    expect(await scopeA.listEvents(context, orderB.id)).toEqual([]);
    expect(await scopeA.listFills(context, orderB.id)).toEqual([]);
    await expect(scopeA.transitionOrder(context, {
      orderId: orderB.id, expectedStateVersion: orderB.stateVersion, toState: "RISK_APPROVED",
    })).rejects.toThrow();
    await expect(scopeA.recordFill(context, {
      orderId: orderB.id,
      exchangeTradeId: "foreign-trade",
      price: "100",
      quantity: "1",
      executedAt: new Date("2026-09-01T00:00:00.000Z"),
    })).rejects.toThrow();
  });

  it("rejects context and create requests that attempt to escape the bound mock scope", async () => {
    const contextA = requireOrgContext(organizationA);
    const contextB = requireOrgContext(organizationB);
    const scoped = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-boundary", "account-boundary"),
    );

    await expect(scoped.listOrders(contextB, { executionMode: "mock" })).rejects.toThrow();
    await expect(scoped.createOrder(contextB, makeInput("cross-context"))).rejects.toThrow();
    await expect(scoped.createOrder(contextA, {
      ...makeInput("wrong-mode"), executionMode: "paper",
    })).rejects.toThrow();
    await expect(scoped.createOrder(contextA, {
      ...makeInput("live-mode"), executionMode: "live",
    })).rejects.toThrow();
    await expect(scoped.createOrder(contextA, {
      ...makeInput("wrong-run-tag"), historicalRunId: "another-run",
    })).rejects.toThrow();
    await expect(scoped.createOrder(contextA, {
      ...makeInput("wrong-account-tag"), historicalAccountKey: "another-account",
    })).rejects.toThrow();
    expect(await scoped.listOrders(contextA, { executionMode: "mock" })).toEqual([]);
  });

  it("isolates concurrent scoped create/fill streams and rejects cross-run idempotency collisions", async () => {
    const context = requireOrgContext(organizationA);
    const runA = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-concurrent-A", "account-X"),
    );
    const runB = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-concurrent-B", "account-X"),
    );
    const inputA = makeInput("concurrent-A");
    const inputB = makeInput("concurrent-B");
    const [orderA, orderB] = await Promise.all([
      runA.createOrder(context, inputA),
      runB.createOrder(context, inputB),
    ]);
    const [fillA, fillB] = await Promise.all([
      runA.recordFill(context, {
        orderId: orderA.id, exchangeTradeId: "concurrent-trade-A", price: "100", quantity: "1",
        executedAt: new Date("2026-09-04T00:00:00.000Z"),
      }),
      runB.recordFill(context, {
        orderId: orderB.id, exchangeTradeId: "concurrent-trade-B", price: "200", quantity: "1",
        executedAt: new Date("2026-09-04T00:01:00.000Z"),
      }),
    ]);

    const retryA = await runA.createOrder(context, inputA);
    expect(retryA.id).toBe(orderA.id);
    expect(await runA.listOrders(context, { executionMode: "mock" })).toMatchObject([
      { id: orderA.id, historicalRunId: "run-concurrent-A", historicalAccountKey: "account-X" },
    ]);
    expect(await runB.listOrders(context, { executionMode: "mock" })).toMatchObject([
      { id: orderB.id, historicalRunId: "run-concurrent-B", historicalAccountKey: "account-X" },
    ]);
    expect(await runA.listFills(context, orderA.id)).toMatchObject([{ id: fillA.id }]);
    expect(await runB.listFills(context, orderB.id)).toMatchObject([{ id: fillB.id }]);

    await expect(runB.createOrder(context, inputA)).rejects.toThrow();
    expect(await runA.getOrderById(context, orderA.id)).toMatchObject({ id: orderA.id });
    expect(await runB.getOrderById(context, orderB.id)).toMatchObject({ id: orderB.id });
    expect(await runB.listOrders(context, { executionMode: "mock" })).toHaveLength(1);
  });

  it("keeps executor-bound order and fill writes inside the caller rollback boundary", async () => {
    const context = requireOrgContext(organizationA);
    const scope = makeScope(organizationA, "run-rollback", "account-X");
    const orderId = randomUUID();
    const fillId = randomUUID();

    await expect(db.transaction(async tx => {
      const repository = createHistoricalMockOrderRepositoryFromExecutor(tx, scope);
      const order = await repository.createOrder(context, { ...makeInput("rollback"), id: orderId });
      await repository.recordFill(context, {
        fillId,
        orderId: order.id,
        exchangeTradeId: "rollback-trade",
        price: "100",
        quantity: "1",
        executedAt: new Date("2026-09-03T00:00:00.000Z"),
      });
      throw new Error("rollback-scope-proof");
    })).rejects.toThrow("rollback-scope-proof");

    const ordinary = createPostgresOrderRepository(db);
    expect(await ordinary.getOrderById(context, orderId)).toBeNull();
    const remaining = await ownerSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM trader_fills WHERE id = ${fillId}::uuid
    `;
    expect(remaining[0]?.count).toBe(0);
  });

  it("refuses identical fill IDs reused from another scoped parent or trade", async () => {
    const context = requireOrgContext(organizationA);
    const runA = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-fill-A", "account-X"),
    );
    const runB = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-fill-B", "account-X"),
    );
    const orderA = await runA.createOrder(context, makeInput("fill-A"));
    const orderB = await runB.createOrder(context, makeInput("fill-B"));
    const fillId = randomUUID();
    const executedAt = new Date("2026-09-02T00:00:00.000Z");
    await runA.recordFill(context, {
      fillId,
      orderId: orderA.id,
      exchangeTradeId: "trade-A",
      price: "100",
      quantity: "1",
      fee: "0.1",
      feeAsset: "USDT",
      executedAt,
    });

    await expect(runA.recordFill(context, {
      fillId: randomUUID(),
      orderId: orderA.id,
      exchangeTradeId: "trade-A",
      price: "100",
      quantity: "1",
      fee: "0.1",
      feeAsset: "USDT",
      executedAt,
    })).rejects.toThrow();
    await expect(runB.recordFill(context, {
      fillId,
      orderId: orderB.id,
      exchangeTradeId: "trade-B",
      price: "100",
      quantity: "1",
      fee: "0.1",
      feeAsset: "USDT",
      executedAt,
    })).rejects.toThrow();
    expect(await runB.listFills(context, orderB.id)).toEqual([]);
    expect(await runA.listFills(context, orderA.id)).toHaveLength(1);
  });

  it("requires complete scoped historical economics and validates the stored fill tuple on retry", async () => {
    const context = requireOrgContext(organizationA);
    const scoped = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-economics-tuple", "account-X"),
    );

    const missingRowOrder = await scoped.createOrder(context, makeInput("missing-economics-row"));
    const missingRowPayload = makeHistoricalFillPayload(missingRowOrder.id, 1);
    await expect(scoped.recordFill(context, {
      ...missingRowPayload,
      economicsRow: undefined,
    })).rejects.toThrow();
    expect(await scoped.listFills(context, missingRowOrder.id)).toEqual([]);

    const missingIdOrder = await scoped.createOrder(context, makeInput("missing-fill-id"));
    const missingIdPayload = makeHistoricalFillPayload(missingIdOrder.id, 2);
    await expect(scoped.recordFill(context, {
      ...missingIdPayload,
      fillId: undefined,
    })).rejects.toThrow();
    expect(await scoped.listFills(context, missingIdOrder.id)).toEqual([]);

    const missingKindOrder = await scoped.createOrder(context, makeInput("missing-fact-kind"));
    const missingKindPayload = makeHistoricalFillPayload(missingKindOrder.id, 4);
    await expect(scoped.recordFill(context, {
      ...missingKindPayload,
      executionFactKind: undefined,
    })).rejects.toThrow();
    expect(await scoped.listFills(context, missingKindOrder.id)).toEqual([]);

    const venueKindOrder = await scoped.createOrder(context, makeInput("venue-fact-kind"));
    const venueKindPayload = makeHistoricalFillPayload(venueKindOrder.id, 5);
    await expect(scoped.recordFill(context, {
      ...venueKindPayload,
      executionFactKind: EXECUTION_FACT_KIND_VENUE_FILL,
    })).rejects.toThrow();
    expect(await scoped.listFills(context, venueKindOrder.id)).toEqual([]);

    const replacementOrder = await scoped.createOrder(context, makeInput("economics-replacement"));
    const validPayload = makeHistoricalFillPayload(replacementOrder.id, 3);
    if (!validPayload.economicsRow) throw new Error("expected historical economics row");
    const foreignParent = await scoped.createOrder(context, makeInput("foreign-economics-parent"));
    await expect(scoped.recordFill(context, {
      ...validPayload,
      economicsRow: { ...validPayload.economicsRow, orderId: foreignParent.id },
    })).rejects.toThrow();
    await expect(scoped.recordFill(context, {
      ...validPayload,
      economicsRow: { ...validPayload.economicsRow, exchangeTradeId: "foreign-trade" },
    })).rejects.toThrow();

    const validFill = await scoped.recordFill(context, validPayload);
    expect(await scoped.recordFill(context, validPayload)).toEqual(validFill);

    const corruptStoredRow = [
      { name: "id", mutate: (row: NonNullable<typeof validPayload.economicsRow>) => ({ ...row, id: randomUUID() }) },
      { name: "exchange_trade_id", mutate: (row: NonNullable<typeof validPayload.economicsRow>) => ({ ...row, exchangeTradeId: `different-${randomUUID()}` }) },
    ] as const;

    for (const [index, corruption] of corruptStoredRow.entries()) {
      const order = await scoped.createOrder(context, makeInput(`stored-tuple-${corruption.name}`));
      const payload = makeHistoricalFillPayload(order.id, 10 + index);
      if (!payload.fillId) throw new Error("expected deterministic historical fill id");
      if (!payload.economicsRow) throw new Error("expected historical economics row");
      await db.insert(pgSchema.traderFills).values({
        id: payload.fillId,
        organizationId: organizationA,
        orderId: order.id,
        exchangeTradeId: payload.exchangeTradeId,
        price: payload.price,
        quantity: payload.quantity,
        fee: payload.fee ?? "0",
        feeAsset: payload.feeAsset ?? "",
        executedAt: payload.executedAt,
      });
      const corruptedRow = corruption.mutate(payload.economicsRow);
      await db.insert(pgSchema.traderFillExecutionEconomics).values(corruptedRow);

      await expect(scoped.recordFill(context, payload)).rejects.toThrow();
    }
  });

  it("makes scoped progress retries deterministic, idempotent, and non-regressing", async () => {
    const context = requireOrgContext(organizationA);
    let ids = 0;
    let clocks = 0;
    const runtime = {
      newId: () => `10000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
      now: () => new Date(Date.UTC(2026, 9, 1, 0, 0, ++clocks)),
    };
    const scoped = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-progress-idempotency", "account-X"),
      runtime,
    );

    async function acceptedPartiallyFilledOrder(label: string) {
      let order = await scoped.createOrder(context, makeInput(label, "3"));
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "RISK_APPROVED",
      });
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "SENT_TO_EXCHANGE",
      });
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "ACCEPTED",
      });
      const first = makeHistoricalFillPayload(order.id, 1, { remainingQuantityAfter: "2" });
      order = await scoped.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: order.stateVersion,
        toState: "PARTIALLY_FILLED",
        filledQuantity: "1",
        avgFillPrice: first.price,
      });
      await scoped.recordFill(context, first);
      return { order, first };
    }

    const { order } = await acceptedPartiallyFilledOrder("progress-old-retry");
    const second = makeHistoricalFillPayload(order.id, 2, {
      remainingQuantityAfter: "1", filledQuantity: "2", avgFillPrice: order.avgFillPrice ?? "0",
      progress: true,
    });
    const secondFill = await scoped.recordFillProgress(context, second);
    const initialProgressEvents = (await scoped.listEvents(context, order.id))
      .filter(event => event.eventType === "fill_recorded");
    expect(initialProgressEvents).toHaveLength(1);
    const afterSecond = await scoped.getOrderById(context, order.id);
    const idsAfterSecond = ids;
    const clocksAfterSecond = clocks;

    await expect(scoped.recordFillProgress(context, second)).resolves.toEqual(secondFill);
    expect(ids).toBe(idsAfterSecond);
    expect(clocks).toBe(clocksAfterSecond);
    expect((await scoped.listEvents(context, order.id)).filter(event => event.eventType === "fill_recorded"))
      .toHaveLength(1);

    await expect(scoped.recordFillProgress(context, {
      ...second,
      filledQuantity: "2.1",
    })).rejects.toThrow();
    expect((await scoped.listEvents(context, order.id)).filter(event => event.eventType === "fill_recorded"))
      .toHaveLength(1);

    const third = makeHistoricalFillPayload(order.id, 3, {
      remainingQuantityAfter: "0", filledQuantity: "3", avgFillPrice: order.avgFillPrice ?? "0",
      progress: true,
    });
    await scoped.recordFillProgress(context, third);
    const afterThird = await scoped.getOrderById(context, order.id);
    expect(afterThird?.filledQuantity).toBe("3");
    const eventsAfterThird = (await scoped.listEvents(context, order.id))
      .filter(event => event.eventType === "fill_recorded");
    expect(eventsAfterThird).toHaveLength(2);

    await expect(scoped.recordFillProgress(context, second)).resolves.toEqual(secondFill);
    expect(await scoped.getOrderById(context, order.id)).toMatchObject({
      filledQuantity: "3",
      avgFillPrice: afterThird?.avgFillPrice,
      updatedAt: afterThird?.updatedAt,
    });
    expect((await scoped.listEvents(context, order.id)).filter(event => event.eventType === "fill_recorded"))
      .toHaveLength(2);
    expect(afterSecond?.filledQuantity).toBe("2");
  });

  it("serializes concurrent exact progress retries and refuses stale distinct-fill cumulative progress", async () => {
    const context = requireOrgContext(organizationA);
    const scoped = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-progress-concurrency", "account-X"),
    );

    async function partiallyFilled(label: string) {
      let order = await scoped.createOrder(context, makeInput(label, "3"));
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "RISK_APPROVED",
      });
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "SENT_TO_EXCHANGE",
      });
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "ACCEPTED",
      });
      const first = makeHistoricalFillPayload(order.id, 1, { remainingQuantityAfter: "2" });
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "PARTIALLY_FILLED",
        filledQuantity: "1", avgFillPrice: first.price,
      });
      await scoped.recordFill(context, first);
      return order;
    }

    const retryOrder = await partiallyFilled("progress-concurrent-retry");
    const exactProgress = makeHistoricalFillPayload(retryOrder.id, 2, {
      remainingQuantityAfter: "1", filledQuantity: "2", avgFillPrice: retryOrder.avgFillPrice ?? "0",
      progress: true,
    });
    const exactResults = await Promise.all([
      scoped.recordFillProgress(context, exactProgress),
      scoped.recordFillProgress(context, exactProgress),
    ]);
    expect(exactResults[0]?.id).toBe(exactResults[1]?.id);
    expect((await scoped.listEvents(context, retryOrder.id)).filter(event => event.eventType === "fill_recorded"))
      .toHaveLength(1);

    const competingOrder = await partiallyFilled("progress-concurrent-distinct");
    const candidateA = makeHistoricalFillPayload(competingOrder.id, 2, {
      remainingQuantityAfter: "1", filledQuantity: "2", avgFillPrice: competingOrder.avgFillPrice ?? "0",
      progress: true,
    });
    const candidateB = makeHistoricalFillPayload(competingOrder.id, 3, {
      remainingQuantityAfter: "1", filledQuantity: "2", avgFillPrice: competingOrder.avgFillPrice ?? "0",
      progress: true,
    });
    const competingResults = await Promise.allSettled([
      scoped.recordFillProgress(context, candidateA),
      scoped.recordFillProgress(context, candidateB),
    ]);
    expect(competingResults.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(competingResults.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await scoped.getOrderById(context, competingOrder.id)).toMatchObject({ filledQuantity: "2" });
    expect((await scoped.listEvents(context, competingOrder.id)).filter(event => event.eventType === "fill_recorded"))
      .toHaveLength(1);
    expect(await scoped.listFills(context, competingOrder.id)).toHaveLength(2);
  });

  it("rejects progress without prior fill evidence and refuses new progress after a terminal state", async () => {
    const context = requireOrgContext(organizationA);
    const scoped = createHistoricalMockOrderRepositoryPostgres(
      db,
      makeScope(organizationA, "run-progress-evidence-guard", "account-X"),
    );

    async function acceptedOrder(label: string) {
      let order = await scoped.createOrder(context, makeInput(label, "3"));
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "RISK_APPROVED",
      });
      order = await scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "SENT_TO_EXCHANGE",
      });
      return scoped.transitionOrder(context, {
        orderId: order.id, expectedStateVersion: order.stateVersion, toState: "ACCEPTED",
      });
    }

    const bareOrder = await acceptedOrder("progress-no-prior-fill");
    const forgedProgress = makeHistoricalFillPayload(bareOrder.id, 1, {
      remainingQuantityAfter: "2", filledQuantity: "1", avgFillPrice: "100", progress: true,
    });
    await expect(scoped.recordFillProgress(context, forgedProgress)).rejects.toThrow();
    expect(await scoped.listFills(context, bareOrder.id)).toEqual([]);
    expect((await scoped.listEvents(context, bareOrder.id)).filter(event => event.eventType === "fill_recorded"))
      .toEqual([]);

    let alreadyFilled = await acceptedOrder("progress-double-count-refusal");
    const recordedFirstSlice = makeHistoricalFillPayload(alreadyFilled.id, 4, { remainingQuantityAfter: "2" });
    alreadyFilled = await scoped.transitionOrder(context, {
      orderId: alreadyFilled.id,
      expectedStateVersion: alreadyFilled.stateVersion,
      toState: "PARTIALLY_FILLED",
      filledQuantity: "1",
      avgFillPrice: recordedFirstSlice.price,
    });
    await scoped.recordFill(context, recordedFirstSlice);
    const forgedDoubleCount = makeHistoricalFillPayload(alreadyFilled.id, 4, {
      remainingQuantityAfter: "2", filledQuantity: "2", avgFillPrice: recordedFirstSlice.price,
      progress: true,
    });
    await expect(scoped.recordFillProgress(context, forgedDoubleCount)).rejects.toThrow();
    expect(await scoped.getOrderById(context, alreadyFilled.id)).toMatchObject({
      state: "PARTIALLY_FILLED", filledQuantity: "1",
    });
    expect(await scoped.listFills(context, alreadyFilled.id)).toHaveLength(1);
    expect((await scoped.listEvents(context, alreadyFilled.id)).filter(event => event.eventType === "fill_recorded"))
      .toEqual([]);

    let terminalOrder = await acceptedOrder("progress-terminal-refusal");
    const first = makeHistoricalFillPayload(terminalOrder.id, 2, { remainingQuantityAfter: "2" });
    terminalOrder = await scoped.transitionOrder(context, {
      orderId: terminalOrder.id,
      expectedStateVersion: terminalOrder.stateVersion,
      toState: "PARTIALLY_FILLED",
      filledQuantity: "1",
      avgFillPrice: first.price,
    });
    await scoped.recordFill(context, first);
    terminalOrder = await scoped.transitionOrder(context, {
      orderId: terminalOrder.id,
      expectedStateVersion: terminalOrder.stateVersion,
      toState: "FILLED",
      filledQuantity: "3",
      avgFillPrice: first.price,
    });
    const terminalProgress = makeHistoricalFillPayload(terminalOrder.id, 3, {
      remainingQuantityAfter: "1", filledQuantity: "2", avgFillPrice: terminalOrder.avgFillPrice ?? "100",
      progress: true,
    });
    await expect(scoped.recordFillProgress(context, terminalProgress)).rejects.toThrow();
    expect(await scoped.getOrderById(context, terminalOrder.id)).toMatchObject({ state: "FILLED", filledQuantity: "3" });
    expect((await scoped.listEvents(context, terminalOrder.id)).filter(event => event.eventType === "fill_recorded"))
      .toHaveLength(0);
    expect(await scoped.listFills(context, terminalOrder.id)).toHaveLength(1);
  });
});
