/** Disposable Postgres only. No exchange calls or production financial commands. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { readOverviewSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";
import { collectAccountValuations } from "@/lib/trader/admin-console/collectors/valuation-persist";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { consoleObservation } from "@/tests/helpers/admin-console-observation";
import { handleAdminConsoleAttentionGet } from "@/lib/trader/admin-console/handlers/attention";
import { handleAdminConsoleNewsGet } from "@/lib/trader/admin-console/handlers/news";
import { handleAdminConsoleCyclesGet } from "@/lib/trader/admin-console/handlers/cycles";
import { handleAdminConsoleCycleTraceGet } from "@/lib/trader/admin-console/handlers/cycle-trace";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";

import { handleAdminConsoleStrategyDetailGet } from "@/lib/trader/admin-console/handlers/strategy-detail";
import { createLifecycleRecorder } from "@/lib/trader/lifecycle/lifecycle-recorder";
import { createPostgresLifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository-postgres";
import { pairFillsFifo, type PairingFillEvent } from "@/lib/trader/lifecycle/trade-pairing";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";

const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
const now = Math.floor(Date.now() / 300_000) * 300_000;
const iso = (at: number) => new Date(at).toISOString();
describe.skipIf(!enabled)("immutable period finance on Postgres", () => {
  let client: postgres.Sql;
  let db: AdminPostgresDb;
  const adminId = randomUUID();
  const deps = (): AdminRouteHandlerDeps => ({
    getUserId: async () => adminId,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  async function seed() {
    const userId = randomUUID();
    await client`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
    await client`INSERT INTO users (id,identity_label,email) VALUES (${userId}::uuid,'Period fixture',${`${userId}@waia.invalid`})`;
    await ensureUserCoreSeedPostgres(db, { userId, displayName: "Period fixture" });
    const binding = {
      organizationId: personalOrganizationIdFromUserId(userId),
      credentialId: randomUUID(),
      exchangeAccountId: randomUUID(),
      credentialRevision: "1",
      configurationRevision: "test",
    };
    await client`INSERT INTO exchange_credentials (id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${binding.credentialId}::uuid,${binding.organizationId}::uuid,'htx',${binding.exchangeAccountId},'synthetic-not-a-key')`;
    await client`INSERT INTO trader_account_collection_state (organization_id,credential_id,exchange_account_id,configuration_revision,symbols) VALUES (${binding.organizationId}::uuid,${binding.credentialId}::uuid,${binding.exchangeAccountId},'test','["BTCUSDT"]')`;
    await observe(binding, "1000", now);
    return binding;
  }
  async function observe(
    binding: Parameters<typeof consoleObservation>[0],
    amount: string | null,
    at: number,
    partialOrders = false,
    unpricedAsset = false,
  ) {
    const full = consoleObservation(binding, amount, at);
    const balances = unpricedAsset
      ? {
          ...full.balances,
          values: [
            ...(full.balances.values ?? []),
            { asset: "XQAZUNPRICEDFIXTURE", free: "1", locked: "0", total: "1" },
          ],
        }
      : full.balances;
    const observation = {
      ...full,
      balances,
      holdings: balances.values,
      status: partialOrders ? "PARTIAL" : full.status,
      openOrders: {
        ...full.openOrders,
        status: partialOrders ? "PARTIAL" : full.openOrders.status,
      },
    };
    await client`INSERT INTO trader_account_observations (organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at) VALUES (${binding.organizationId}::uuid,${binding.credentialId}::uuid,${binding.exchangeAccountId},${observation.observationId}::uuid,1,'test',${randomUUID()}::uuid,${JSON.stringify(observation)}::jsonb,${iso(at)}::timestamptz)`;
    await client`UPDATE trader_account_collection_state SET last_observation_id=${observation.observationId}::uuid WHERE credential_id=${binding.credentialId}::uuid`;
  }
  const scope = (binding: Awaited<ReturnType<typeof seed>>) => ({
    kind: "account" as const,
    organizationId: binding.organizationId,
    exchangeAccountId: binding.exchangeAccountId,
  });
  async function point(binding: Awaited<ReturnType<typeof seed>>, at: number, unrealized = "0") {
    const key = randomUUID();
    await client`INSERT INTO trader_admin_equity_point (organization_id,exchange_account_id,bucket,equity,trader_unrealized,valuation_key,method_version,state) VALUES (${binding.organizationId}::uuid,${binding.exchangeAccountId},${iso(at)}::timestamptz,'1000',${unrealized},${key},'htx_spot_last:usdt','ok')`;
    // A retained valuation proves the exact endpoint; absent evidence is conservatively later.
    await client`INSERT INTO trader_admin_account_valuation (id,organization_id,exchange_account_id,valuation_key,lots_revision,quote_set_json,quote_set_digest,method_version,equity,free_quote,locked_quote,holdings_value,trader_lots_value,trader_cost_basis,trader_unrealized,currency,state,reasons,computed_at) VALUES (${randomUUID()}::uuid,${binding.organizationId}::uuid,${binding.exchangeAccountId},${key},'fixture','[]','fixture','htx_spot_last:usdt','1000','1000','0','0','0','0',${unrealized},'USDT','ok','[]',${iso(at)}::timestamptz)`;
  }
  async function trade(
    binding: Awaited<ReturnType<typeof seed>>,
    mode = "live",
    feeAsset = "USDT",
    pnl = "8",
  ) {
    const tradeId = randomUUID(),
      lot = randomUUID();
    await client`INSERT INTO trader_trades (id,organization_id,symbol,venue,account_key,position_side,instrument_kind,strategy_signal_id,strategy_id,strategy_version,state,semantics_version,opened_at,closed_at,risk_decision_id) VALUES (${tradeId}::uuid,${binding.organizationId}::uuid,'BTCUSDT','htx',${binding.exchangeAccountId},'LONG','SPOT',${tradeId},'test','1','CLOSED','test',${iso(now - 120000)}::timestamptz,${iso(now - 60000)}::timestamptz,'test')`;
    await client`INSERT INTO trader_position_lots (id,organization_id,symbol,venue,account_key,position_side,instrument_kind,strategy_signal_id,state,open_qty,remaining_qty,avg_cost,opened_at,closed_at,trade_id) VALUES (${lot}::uuid,${binding.organizationId}::uuid,'BTCUSDT','htx',${binding.exchangeAccountId},'LONG','SPOT',${tradeId},'CLOSED','1','0','100',${iso(now - 120000)}::timestamptz,${iso(now - 60000)}::timestamptz,${tradeId}::uuid)`;
    for (const [kind, side, price, fee, legPnl, at] of [
      ["OPEN_FILL", "buy", "100", "1", "0", now - 120000],
      ["CLOSE_FILL", "sell", "110", "2", pnl, now - 60000],
    ] as const) {
      const order = randomUUID(),
        fill = randomUUID();
      await client`INSERT INTO trader_orders (id,organization_id,credential_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${order}::uuid,${binding.organizationId}::uuid,${binding.credentialId}::uuid,'htx',${mode}::order_execution_mode,'BTCUSDT',${side}::order_side,'market','1','FILLED',${order},${order},'test')`;
      await client`INSERT INTO trader_fills (id,organization_id,order_id,exchange_trade_id,price,quantity,fee,fee_asset,executed_at) VALUES (${fill}::uuid,${binding.organizationId}::uuid,${order}::uuid,${fill},${price},'1',${fee},${kind === "OPEN_FILL" ? "USDT" : feeAsset},${iso(at)}::timestamptz)`;
      await client`INSERT INTO trader_trade_legs (id,organization_id,trade_id,position_lot_id,kind,order_id,fill_id,quantity,price,fee,executed_at,leg_pnl) VALUES (${randomUUID()}::uuid,${binding.organizationId}::uuid,${tradeId}::uuid,${lot}::uuid,${kind}::trader_trade_leg_kind,${order}::uuid,${fill}::uuid,'1',${price},${fee},${iso(at)}::timestamptz,${legPnl})`;
    }
  }
  const read = (
    binding: Awaited<ReturnType<typeof seed>>,
    currentPeriod = false,
    currency: "USD" | "USDT" = "USDT",
  ) =>
    readOverviewSnapshot(db, {
      scope: scope(binding),
      start: iso(now - 300000),
      end: iso(now),
      nowMs: now,
      currency,
      mode: "live",
      currentPeriod,
    });
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 3, prepare: false });
    db = drizzle(client, { schema });
    await client`INSERT INTO auth.users (id) VALUES (${adminId}::uuid)`;
    await client`INSERT INTO users (id,identity_label,email) VALUES (${adminId}::uuid,'Admin period fixture',${`${adminId}@waia.invalid`})`;
    await ensureUserCoreSeedPostgres(db, { userId: adminId, displayName: "Admin period fixture" });
    await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${adminId}::uuid`;
  });
  afterAll(async () => {
    await client?.end();
  });
  it("counts live opening/closing fees once and excludes paper and other accounts", async () => {
    const binding = await seed(),
      other = await seed();
    await trade(binding);
    await trade(binding, "paper", "USDT", "900");
    await trade(other, "live", "USDT", "500");
    await point(binding, now - 300000);
    await point(binding, now);
    const snapshot = await read(binding);
    expect(snapshot.value.overview.finance.pnl.value?.amount).toBe("7");
    expect(snapshot.value.accounts[0]?.periodResult).toMatchObject({
      realized: "7",
      unrealizedChange: "0",
      openFees: "1",
      closeFees: "2",
      tradingFees: "3",
      state: "ok",
    });
    expect(JSON.stringify(snapshot.value)).not.toContain(other.exchangeAccountId);
  });
  it("keeps uncertain close-fee denominations unavailable", async () => {
    const binding = await seed();
    await trade(binding, "live", "BTC");
    await point(binding, now - 300000);
    await point(binding, now);
    expect((await read(binding)).value.accounts[0]?.periodResult).toMatchObject({
      total: null,
      realized: null,
      reasons: ["CLOSE_FEE_DENOMINATION_UNVERIFIED"],
    });
  });
  it("persists native-fee net lots and exact partial closes, with reader and reconstruction parity", async () => {
    const binding = await seed();
    const context = requireOrgContext(binding.organizationId);
    const repo = createPostgresLifecycleRepository(db);
    const recorder = createLifecycleRecorder({ repository: repo });
    const signal = randomUUID();
    const events: PairingFillEvent[] = [];
    for (const [side, quantity, price, fee, at] of [
      ["buy", "1.02", "100", "0.01", now - 120000],
      ["sell", "0.4", "110", "0.005", now - 90000],
      ["sell", "0.6", "110", "0.005", now - 60000],
    ] as const) {
      const orderId = randomUUID(),
        fillId = randomUUID();
      await client`INSERT INTO trader_orders (id,organization_id,credential_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id,strategy_signal_id) VALUES (${orderId}::uuid,${binding.organizationId}::uuid,${binding.credentialId}::uuid,'htx','live','BTC/USDT',${side}::order_side,'market',${quantity},'FILLED',${orderId},${orderId},'test',${signal})`;
      await client`INSERT INTO trader_fills (id,organization_id,order_id,exchange_trade_id,price,quantity,fee,fee_asset,executed_at) VALUES (${fillId}::uuid,${binding.organizationId}::uuid,${orderId}::uuid,${fillId},${price},${quantity},${fee},'BTC',${iso(at)}::timestamptz)`;
      const order: OrderRow = {
        id: orderId,
        organizationId: binding.organizationId,
        credentialId: binding.credentialId,
        venue: "htx",
        executionMode: "live",
        symbol: "BTC/USDT",
        side,
        type: "market",
        price: null,
        quantity,
        filledQuantity: quantity,
        avgFillPrice: price,
        state: "FILLED",
        stateVersion: 1,
        exchangeOrderId: orderId,
        clientOrderId: orderId,
        idempotencyKey: orderId,
        riskDecisionId: "test",
        allocationDecisionId: null,
        strategySignalId: signal,
        createdAt: new Date(at),
        updatedAt: new Date(at),
      };
      const fill: FillRow = {
        id: fillId,
        orderId,
        organizationId: binding.organizationId,
        exchangeTradeId: fillId,
        price,
        quantity,
        fee,
        feeAsset: "BTC",
        executedAt: new Date(at),
        createdAt: new Date(at),
      };
      const event = {
        order,
        fill,
        accountKey: binding.exchangeAccountId,
        lineage: {
          strategySignalId: signal,
          strategyId: "test",
          strategyVersion: "1",
          riskDecisionId: "test",
        },
      };
      events.push(event);
      await recorder.recordFillLifecycle({ context, ...event });
      if (side === "buy") {
        expect((await repo.listOpenPositionLots(context))[0]?.remainingQty).toBe("1.01");
        const legsBefore = await repo.listTradeLegs(
          context,
          (await repo.listTrades(context))[0]!.id,
        );
        await expect(
          recorder.recordFillLifecycle({
            context,
            ...event,
            order: { ...order, side: "sell" },
            fill: { ...fill, quantity: "2" },
          }),
        ).rejects.toThrow(/insufficient open qty/);
        expect((await repo.listOpenPositionLots(context))[0]?.remainingQty).toBe("1.01");
        expect(await repo.listTradeLegs(context, (await repo.listTrades(context))[0]!.id)).toEqual(
          legsBefore,
        );
      }
      if (quantity === "0.4")
        expect((await repo.listOpenPositionLots(context))[0]?.remainingQty).toBe("0.605");
    }
    expect(await repo.listOpenPositionLots(context)).toEqual([]);
    const trades = await repo.listTrades(context);
    expect(trades[0]).toMatchObject({ state: "CLOSED", realizedPnl: "9" });
    expect(pairFillsFifo({ events }).trades[0]?.realizedPnl).toBe(trades[0]?.realizedPnl);
    const legs = await repo.listTradeLegs(context, trades[0]!.id);
    expect(legs.filter((l) => l.kind === "CLOSE_FILL").map((l) => l.quantity)).toEqual([
      "0.405",
      "0.605",
    ]);
    await point(binding, now - 300000);
    await point(binding, now);
    expect((await read(binding)).value.accounts[0]?.periodResult).toMatchObject({
      total: "8",
      realized: "8",
      openFees: "1",
      closeFees: "1.1",
      tradingFees: "2.1",
      state: "ok",
    });
    const before = (await repo.listLifecycleEvents(context)).length;
    await expect(
      recorder.recordFillLifecycle({
        context,
        ...events[0]!,
        fill: { ...events[0]!.fill, feeAsset: "HT" },
      }),
    ).rejects.toThrow(/FEE_ASSET_UNCONVERTIBLE/);
    await expect(recorder.recordFillLifecycle({ context, ...events[2]! })).rejects.toThrow(
      /no open lot/,
    );
    expect((await repo.listLifecycleEvents(context)).length).toBe(before);
    expect(await repo.listTrades(context)).toEqual(trades);
  });
  it("does not accept another leg's fee proof for legacy close PnL", async () => {
    const binding = await seed();
    await trade(binding, "live", "BTC");
    const fills =
      await client`SELECT f.id FROM trader_fills f JOIN trader_orders o ON o.id=f.order_id AND o.organization_id=f.organization_id WHERE f.organization_id=${binding.organizationId}::uuid AND o.side='sell'`;
    await client`INSERT INTO trader_lifecycle_events(id,organization_id,entity_type,entity_id,phase,payload,occurred_at) VALUES (${randomUUID()}::uuid,${binding.organizationId}::uuid,'FILL',${String(fills[0]!.id)},'ORDER_FILLED',${JSON.stringify({ feeAccountingVersion: "native-fee-inventory/v1", legId: randomUUID(), nativeFee: "2", inventoryQuantity: "1", quoteFee: "220" })},${iso(now - 60000)}::timestamptz)`;
    await point(binding, now - 300000);
    await point(binding, now);
    expect((await read(binding)).value.accounts[0]?.periodResult).toMatchObject({
      total: null,
      reasons: ["CLOSE_FEE_DENOMINATION_UNVERIFIED"],
    });
  });
  it("does not turn a legacy closed trade without executions into zero profit", async () => {
    const binding = await seed(),
      id = randomUUID();
    await client`INSERT INTO trader_trades(id,organization_id,symbol,venue,account_key,position_side,instrument_kind,strategy_signal_id,strategy_id,strategy_version,state,semantics_version,opened_at,closed_at,risk_decision_id) VALUES (${id}::uuid,${binding.organizationId}::uuid,'BTCUSDT','htx',${binding.exchangeAccountId},'LONG','SPOT',${id},'legacy','1','CLOSED','legacy',${iso(now - 120000)}::timestamptz,${iso(now - 60000)}::timestamptz,'legacy')`;
    await point(binding, now - 300000);
    await point(binding, now);
    expect((await read(binding)).value.accounts[0]?.periodResult).toMatchObject({
      total: null,
      realized: null,
      reasons: ["UNATTRIBUTED"],
    });
  });
  it("uses the current verified endpoint without backfilling saved history", async () => {
    const binding = await seed();
    await trade(binding);
    await point(binding, now - 300000, "10");
    expect((await read(binding)).value.accounts[0]?.periodResult?.total).toBeNull();
    expect((await read(binding, true)).value.accounts[0]?.periodResult).toMatchObject({
      total: "-3",
      realized: "7",
      unrealizedChange: "-10",
    });
    expect(
      (
        await client`SELECT count(*)::int AS n FROM trader_admin_equity_point WHERE organization_id=${binding.organizationId}::uuid`
      )[0]?.n,
    ).toBe(1);
    await client`INSERT INTO trader_admin_market_quote_latest (source,symbol,base,quote,last,price_definition,source_ts,observed_at) VALUES ('coinbase','USDT-USD','USDT','USD','2','last',${iso(now)}::timestamptz,${iso(now)}::timestamptz) ON CONFLICT (source,symbol) DO UPDATE SET last='2',source_ts=excluded.source_ts,observed_at=excluded.observed_at`;
    expect((await read(binding, true, "USD")).value.accounts[0]?.periodResult).toMatchObject({
      total: "-6",
      realized: "14",
      unrealizedChange: "-20",
      currency: "USD",
    });
    await client`UPDATE trader_admin_market_quote_latest SET source_ts=${iso(now - 240000)}::timestamptz WHERE source='coinbase' AND symbol='USDT-USD'`;
    await client`INSERT INTO trader_admin_market_quote_latest (source,symbol,base,quote,last,price_definition,source_ts,observed_at) VALUES ('kraken','USDT-USD','USDT','USD','0.99','last',${iso(now)}::timestamptz,${iso(now)}::timestamptz) ON CONFLICT (source,symbol) DO UPDATE SET last='0.99',source_ts=excluded.source_ts,observed_at=excluded.observed_at`;
    expect((await read(binding, true, "USD")).value.accounts[0]).toMatchObject({
      equity: "990",
      method: "usdt_usd:kraken",
      periodResult: {
        total: "-2.97",
        realized: "6.93",
        unrealizedChange: "-9.9",
        method: "operational_pnl:usdt_usd:kraken",
      },
    });
  });
  it("persists a complete monetary valuation despite partial order evidence and uses its current endpoint", async () => {
    const binding = await seed();
    await observe(binding, "1000.12345678", now, true);
    expect(await collectAccountValuations(db, new Date(now), scope(binding))).toEqual({
      processed: 2,
      blocked: 0,
    });
    const saved =
      await client`SELECT state,reasons,equity FROM trader_admin_account_valuation WHERE organization_id=${binding.organizationId}::uuid`;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      state: "ok",
      equity: "1000.12345678",
      reasons: ["OPEN_ORDERS_PARTIAL"],
    });
    await observe(binding, "2000.12345678", now + 60000, true);
    const result = await readOverviewSnapshot(db, {
      scope: scope(binding),
      start: iso(now),
      end: iso(now + 60000),
      nowMs: now + 60000,
      currency: "USDT",
      mode: "live",
      currentPeriod: true,
    });
    expect(result.value.accounts[0]).toMatchObject({
      state: "partial",
      reasons: ["OPEN_ORDERS_PARTIAL"],
      periodResult: { total: "0", unrealizedChange: "0", coverageEnd: iso(now + 60000) },
    });
    await observe(binding, "2000.12345678", now + 60500, true, true);
    expect(await collectAccountValuations(db, new Date(now + 60500), scope(binding))).toEqual({
      processed: 0,
      blocked: 1,
    });
    await observe(binding, null, now + 61000);
    expect(await collectAccountValuations(db, new Date(now + 61000), scope(binding))).toEqual({
      processed: 0,
      blocked: 1,
    });
  });
  it("persists immutable versions and one point per bucket, never an error as zero", async () => {
    const binding = await seed();
    expect(await collectAccountValuations(db, new Date(now), scope(binding))).toEqual({
      processed: 2,
      blocked: 0,
    });
    expect(await collectAccountValuations(db, new Date(now), scope(binding))).toEqual({
      processed: 0,
      blocked: 0,
    });
    await observe(binding, "1007", now + 1000);
    expect(await collectAccountValuations(db, new Date(now + 1000), scope(binding))).toEqual({
      processed: 1,
      blocked: 0,
    });
    const points =
      await client`SELECT equity FROM trader_admin_equity_point WHERE organization_id=${binding.organizationId}::uuid`;
    expect(points.map((p) => p.equity)).toEqual(["1000"]);
    const versions =
      await client`SELECT equity FROM trader_admin_account_valuation WHERE organization_id=${binding.organizationId}::uuid ORDER BY computed_at`;
    expect(versions.map((v) => v.equity)).toEqual(["1000", "1007"]);
    await observe(binding, null, now + 2000);
    expect(await collectAccountValuations(db, new Date(now + 2000), scope(binding))).toEqual({
      processed: 0,
      blocked: 1,
    });
  });
  it("scopes attention by account and mode and finds ownership conflict outside the requested tenant", async () => {
    const binding = await seed(),
      other = await seed();
    const ids: string[] = [];
    for (const [credential, org, mode] of [
      [binding.credentialId, binding.organizationId, "live"],
      [binding.credentialId, binding.organizationId, "paper"],
      [other.credentialId, other.organizationId, "live"],
    ]) {
      const id = randomUUID();
      ids.push(id);
      await client`INSERT INTO trader_orders (id,organization_id,credential_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${id}::uuid,${org}::uuid,${credential}::uuid,'htx',${mode}::order_execution_mode,'BTCUSDT','buy','market','1','RECONCILIATION_REQUIRED',${id},${id},'test')`;
    }
    await client`INSERT INTO exchange_credentials (id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${randomUUID()}::uuid,${other.organizationId}::uuid,'htx',${binding.exchangeAccountId},'synthetic-not-a-key')`;
    const query = new URLSearchParams({
      organization_id: binding.organizationId,
      exchange_account_id: binding.exchangeAccountId,
      mode: "live",
    });
    const response = await handleAdminConsoleAttentionGet(
      new Request(`http://localhost/api/trader/admin/console/attention?${query}`),
      deps(),
    );
    expect(response.status).toBe(200);
    const body = response.body as { data: { items: { reason: string; entityIds: string[] }[] } };
    expect(body.data.items.find((i) => i.reason === "UNKNOWN_ORDER_OUTCOME")?.entityIds).toEqual([
      ids[0],
    ]);
    expect(body.data.items.find((i) => i.reason === "OWNERSHIP_CONFLICT")?.entityIds).toEqual([
      `htx:${binding.exchangeAccountId}`,
    ]);
    expect(JSON.stringify(body)).not.toContain(ids[1]);
    expect(JSON.stringify(body)).not.toContain(ids[2]);
  });
  it("reads news versions and metadata-only cycles without inventing their mode", async () => {
    const binding = await seed(),
      cycle = randomUUID(),
      news = randomUUID();
    await client`INSERT INTO trader_intelligence_cycle_envelope (id,organization_id,run_id,cycle_id,symbol,evaluated_at,historical_profile_id,historical_profile_digest,matrix_digest,terminal_reason_code,input_semantic_digest,output_semantic_digest,content_digest,schema_version) VALUES (${cycle}::uuid,${binding.organizationId}::uuid,${randomUUID()},'cycle-fixture','BTCUSDT',${iso(now - 60000)}::timestamptz,'fixture','fixture','fixture','NO_TRADE','fixture','fixture','fixture','fixture')`;
    await client`INSERT INTO trader_admin_news_item (id,dedupe_key,source,url,published_at,first_observed_at,symbols,category,current_version) VALUES (${news}::uuid,${news},'Fixture','https://example.invalid/news',${iso(now - 60000)}::timestamptz,${iso(now - 60000)}::timestamptz,'{}','news',1)`;
    await client`INSERT INTO trader_admin_news_item_version (news_item_id,version,title,summary,content_hash,observed_at) VALUES (${news}::uuid,1,'<![CDATA[A saved news title]]>','<![CDATA[Forecast < 1 & > 0]]>',${news},${iso(now - 60000)}::timestamptz)`;
    const query = new URLSearchParams({
      organization_id: binding.organizationId,
      mode: "all",
      period: "custom",
      from: iso(now - 300000),
      to: iso(now),
    });
    const cycles = await handleAdminConsoleCyclesGet(
      new Request(`http://localhost/api/trader/admin/console/cycles?${query}`),
      deps(),
    );
    expect(cycles.status).toBe(200);
    expect((cycles.body as { data: { items: unknown[] } }).data.items).toEqual([
      expect.objectContaining({ id: cycle, mode: "undetermined", reason: "NO_TRADE" }),
    ]);
    const trace = await handleAdminConsoleCycleTraceGet(
      new Request(`http://localhost/api/trader/admin/console/cycles/${cycle}?${query}`),
      deps(),
      cycle,
    );
    expect(trace.status).toBe(200);
    expect((trace.body as { data: { stages: unknown[] } }).data.stages).toHaveLength(23);
    const wrongScope = new URLSearchParams(query);
    wrongScope.set("organization_id", randomUUID());
    expect(
      (
        await handleAdminConsoleCycleTraceGet(
          new Request(`http://localhost/api/trader/admin/console/cycles/${cycle}?${wrongScope}`),
          deps(),
          cycle,
        )
      ).status,
    ).toBe(404);
    query.set("mode", "live");
    const live = await handleAdminConsoleCyclesGet(
      new Request(`http://localhost/api/trader/admin/console/cycles?${query}`),
      deps(),
    );
    expect((live.body as { data: { items: unknown[] } }).data.items).toEqual([]);
    const newsResponse = await handleAdminConsoleNewsGet(
      new Request(`http://localhost/api/trader/admin/console/news?${query}`),
      deps(),
    );
    expect(newsResponse.status).toBe(200);
    expect((newsResponse.body as { data: { items: unknown[] } }).data.items).toContainEqual(
      expect.objectContaining({
        id: news,
        title: "A saved news title",
        summary: "Forecast < 1 & > 0",
        source: "Fixture",
        url: "https://example.invalid/news",
        publishedAt: iso(now - 60000),
        observedAt: iso(now - 60000),
      }),
    );
    const stored =
      await client`SELECT title,summary FROM trader_admin_news_item_version WHERE news_item_id=${news}::uuid AND version=1`;
    expect(stored[0]).toEqual({
      title: "<![CDATA[A saved news title]]>",
      summary: "<![CDATA[Forecast < 1 & > 0]]>",
    });
  });
  it("strategy details preserve version/mode boundaries and the exact period fee semantics", async () => {
    const binding = await seed();
    await trade(binding, "live", "USDT", "8");
    await trade(binding, "paper", "USDT", "108");
    await trade(binding, "mock", "USDT", "1008");
    const read = async (version: string) =>
      handleAdminConsoleStrategyDetailGet(
        new Request(
          `http://localhost/api/trader/admin/console/strategies/detail?organization_id=${binding.organizationId}&strategy_id=test&strategy_version=${version}&mode=all&period=7d`,
        ),
        deps(),
      );
    const result = await read("1");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        performance: [
          expect.objectContaining({
            mode: "live",
            realized: "7",
            tradingFees: "3",
            closedTradeCount: 1,
          }),
          expect.objectContaining({
            mode: "paper",
            realized: "107",
            tradingFees: "3",
            closedTradeCount: 1,
          }),
          expect.objectContaining({ mode: "history", state: "empty", realized: "0" }),
        ],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("1008");
    const otherVersion = await read("2");
    expect(otherVersion.body).toMatchObject({
      data: {
        performance: [
          expect.objectContaining({ mode: "live", state: "empty", totalTrades: 0 }),
          expect.objectContaining({ mode: "paper", state: "empty", totalTrades: 0 }),
          expect.objectContaining({ mode: "history", state: "empty", totalTrades: 0 }),
        ],
      },
    });
  });
});
