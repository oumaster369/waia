/** Synthetic tenant/account fixtures against a fully migrated disposable local database. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { handleAdminConsoleOrdersGet } from "@/lib/trader/admin-console/handlers/orders";
import { handleAdminConsoleFillsGet } from "@/lib/trader/admin-console/handlers/fills";
import {
  handleAdminConsoleInvoicesGet,
  handleAdminConsoleInvoiceDetailGet,
} from "@/lib/trader/admin-console/handlers/invoices";
import { handleAdminConsoleExportGet } from "@/lib/trader/admin-console/handlers/export";
import { handleAdminConsoleStreamPoll } from "@/lib/trader/admin-console/stream/console-stream";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";
const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);

describe.skipIf(!enabled)("scope parity for admin read surfaces on Postgres", () => {
  let client: postgres.Sql;
  let db: AdminPostgresDb;
  const admin = randomUUID();
  const other = randomUUID();
  const org = personalOrganizationIdFromUserId(admin);
  const otherOrg = personalOrganizationIdFromUserId(other);
  const account = randomUUID();
  const secondAccount = randomUUID();
  const credential = randomUUID();
  const secondCredential = randomUUID();
  const foreignCredential = randomUUID();
  const order = randomUUID();
  const foreignOrder = randomUUID();
  const invoice = randomUUID();
  const foreignInvoice = randomUUID();
  const deps = (): AdminRouteHandlerDeps => ({
    getUserId: async () => admin,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  const request = (path: string, extra = "") =>
    new Request(
      `http://localhost/api/trader/admin/console/${path}?organization_id=${org}&exchange_account_id=${account}&mode=live${extra}`,
    );
  async function insertOrder(
    id: string,
    orgId: string,
    credentialId: string,
    mode = "live",
    historicalRun: string | null = null,
  ) {
    await client`INSERT INTO trader_orders (id, organization_id, credential_id, venue, execution_mode, historical_run_id, historical_account_key, symbol, side, type, quantity, state, client_order_id, idempotency_key, risk_decision_id)
      VALUES (${id}::uuid, ${orgId}::uuid, ${credentialId}::uuid, 'htx', ${mode}::order_execution_mode, ${historicalRun}, ${historicalRun ? "historical-test" : null}, 'BTCUSDT', 'buy', 'market', '2', 'CREATED', ${id}, ${id}, 'test')`;
    await client`INSERT INTO trader_fills (id, organization_id, order_id, exchange_trade_id, price, quantity, fee, fee_asset, executed_at)
      VALUES (${randomUUID()}::uuid, ${orgId}::uuid, ${id}::uuid, ${randomUUID()}, '11.01', '2', '0.1', 'USDT', now())`;
  }
  async function insertInvoice(id: string, orgId: string, accountId: string, amount: string) {
    await client`INSERT INTO trader_invoices (id, organization_id, exchange_account_id, reporting_period_id, fee_artifact_digest, status, currency, period_realized_strategy_profit, cumulative_realized_strategy_profit, previous_high_water_mark, new_profit_above_hwm, fee_rate, performance_fee, proposed_new_high_water_mark, billable, realized_fill_finality, starting_equity, ending_equity, net_deposits, net_withdrawals, period_start, period_end, valuation_source, fee_computed_at, schema_version, record_content_digest)
      VALUES (${id}::uuid, ${orgId}::uuid, ${accountId}, ${randomUUID()}, 'synthetic', 'DRAFT', 'USDT', '100', '100', '0', '100', '0.3', ${amount}, '100', true, false, '1000', '1100', '0', '0', now()-interval '1 day', now(), 'synthetic', now(), 'test', ${id})`;
  }
  beforeAll(async () => {
    if (!["127.0.0.1", "localhost", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 4, prepare: false });
    db = drizzle(client, { schema });
    for (const id of [admin, other]) {
      await client`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
      await client`INSERT INTO users (id, identity_label, email) VALUES (${id}::uuid, 'Scope test', ${`${id}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: id, displayName: "Scope test" });
    }
    await client`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${admin}::uuid`;
    for (const [id, orgId, accountId] of [
      [credential, org, account],
      [secondCredential, org, secondAccount],
      [foreignCredential, otherOrg, account],
    ])
      await client`INSERT INTO exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload) VALUES (${id}::uuid, ${orgId}::uuid, 'htx', ${accountId}, 'synthetic-not-a-key')`;
    await insertOrder(order, org, credential);
    await insertOrder(foreignOrder, otherOrg, foreignCredential);
    await insertOrder(randomUUID(), org, secondCredential);
    await insertOrder(randomUUID(), org, credential, "paper");
    await insertOrder(randomUUID(), org, credential, "mock", randomUUID());
    await insertInvoice(invoice, org, account, "30.00000001");
    await insertInvoice(randomUUID(), org, secondAccount, "90");
    await insertInvoice(foreignInvoice, otherOrg, account, "999");
  });
  afterAll(async () => {
    await client?.end();
  });
  it("filters organization, account and execution mode before LIMIT and matches the assistant", async () => {
    const req = request("orders", "&limit=1");
    const http = await handleAdminConsoleOrdersGet(req, deps());
    expect(http.body).toMatchObject({
      cursor: expect.stringMatching(/^\d+$/),
      data: { items: [{ id: order, mode: "live" }] },
    });
    const assistant = await readAssistantTool("list_orders", req, deps());
    expect((assistant.body as { data: unknown }).data).toEqual(
      (http.body as { data: unknown }).data,
    );
    const fills = await handleAdminConsoleFillsGet(request("fills"), deps());
    expect(fills.body).toMatchObject({
      data: { items: [{ orderId: order, mode: "live", price: "11.01" }] },
    });
    expect((fills.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  });
  it("shares saved invoice amounts, aggregate and finance revision with CSV", async () => {
    const http = await handleAdminConsoleInvoicesGet(request("invoices"), deps());
    const body = http.body as {
      financeRevision: string;
      data: { items: { id: string; performanceFee: string }[]; total: number };
    };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ id: invoice, performanceFee: "30.00000001" });
    expect(body.data.total).toBe(1);
    const csv = await handleAdminConsoleExportGet(request("export", "&dataset=invoices"), deps());
    const contents = new TextDecoder().decode(csv.binaryBody as Uint8Array);
    expect(contents).toContain(`# financeRevision=${body.financeRevision}`);
    expect(contents).toContain("30.00000001");
    expect(contents).not.toContain(foreignInvoice);
    expect(contents).toContain(account);
    const foreign = await handleAdminConsoleInvoiceDetailGet(
      request(`invoices/${foreignInvoice}`),
      deps(),
      foreignInvoice,
    );
    expect(foreign.status).toBe(404);
    const detail = await handleAdminConsoleInvoiceDetailGet(
      request(`invoices/${invoice}`),
      deps(),
      invoice,
    );
    expect(detail.body).toMatchObject({ data: { chain: { ok: null, state: "unavailable" } } });
  });
  it("streams only matching order DTOs, without credential data or foreign IDs", async () => {
    const snapshot = await handleAdminConsoleOrdersGet(request("orders"), deps());
    const cursor = (snapshot.body as { cursor: string }).cursor;
    const added = randomUUID();
    const excluded = randomUUID();
    await insertOrder(added, org, credential);
    await insertOrder(excluded, otherOrg, foreignCredential);
    const poll = await handleAdminConsoleStreamPoll(
      request("stream", `&topics=orders&transport=poll&resume=${cursor}`),
      deps(),
    );
    const serialized = JSON.stringify(poll.body);
    expect(serialized).toContain(added);
    expect(serialized).not.toContain(excluded);
    expect(serialized).not.toContain("encrypted_payload");
    expect(poll.body).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "upsert",
          payload: expect.objectContaining({ id: added, symbol: "BTCUSDT", quantity: "2" }),
        }),
      ]),
    });
  });
});
