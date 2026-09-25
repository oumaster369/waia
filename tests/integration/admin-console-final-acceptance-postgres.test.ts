/** Disposable Postgres: canonical detail, owner context, mute CAS and virtual mode proofs. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { handleAdminConsoleClientsGet } from "@/lib/trader/admin-console/handlers/clients";
import { handleAdminConsoleIncidentsGet } from "@/lib/trader/admin-console/handlers/incidents";
import { handleAdminConsoleIncidentPost } from "@/lib/trader/admin-console/handlers/incident-commands";
import { handleAdminConsoleChangesGet } from "@/lib/trader/admin-console/handlers/changes";
import { handleAdminConsolePaperPortfoliosGet } from "@/lib/trader/admin-console/handlers/paper-portfolios";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";
import { consoleObservation } from "@/tests/helpers/admin-console-observation";
import { handleAdminConsoleAccountsGet } from "@/lib/trader/admin-console/handlers/accounts";
const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "final console acceptance on real Postgres",
  () => {
    let client: postgres.Sql, db: AdminPostgresDb;
    const admin = randomUUID(),
      other = randomUUID(),
      org = personalOrganizationIdFromUserId(admin),
      foreign = personalOrganizationIdFromUserId(other),
      credential = randomUUID(),
      account = randomUUID(),
      incident = randomUUID();
    const deps = (): AdminRouteHandlerDeps => ({
      getUserId: async () => admin,
      getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
      disposeRuntimeDb: async () => undefined,
    });
    const req = (query = "") =>
      new Request(`http://localhost/api/trader/admin/console/test?${query}`);
    beforeAll(async () => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
      client = postgres(url!, { max: 3, prepare: false });
      db = drizzle(client, { schema });
      for (const user of [admin, other]) {
        await client`INSERT INTO auth.users(id) VALUES (${user}::uuid)`;
        await client`INSERT INTO users(id,identity_label,email) VALUES (${user}::uuid,'Final acceptance',${`${user}@waia.invalid`})`;
        await ensureUserCoreSeedPostgres(db, { userId: user, displayName: "Final acceptance" });
      }
      await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${admin}::uuid`;
      await client`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${credential}::uuid,${org}::uuid,'htx',${account},'SECRET_NEVER_READ'),(${randomUUID()}::uuid,${foreign}::uuid,'htx',${randomUUID()},'SECRET_NEVER_READ')`;
      await client`UPDATE organizations SET created_at='2000-01-01' WHERE id=${org}::uuid`;
      await client`INSERT INTO trader_admin_incident(id,environment,service,fingerprint,title,severity,status,first_seen_at,last_seen_at) VALUES (${incident}::uuid,'local','final-test',${incident},'Final test incident','error','new',now(),now())`;
      await client`INSERT INTO trader_admin_diagnostic_event(id,occurred_at,received_at,environment,service,severity,error_class,message_redacted,fingerprint,organization_id,exchange_account_id) VALUES (${randomUUID()}::uuid,now(),now(),'local','final-test','error','Fixture','Test failure',${incident},${org}::uuid,${account})`;
    });
    afterAll(async () => {
      await client?.end();
    });
    it("opens a client beyond a capped list through exactly the same assistant reader, and rejects foreign scope", async () => {
      const list = await handleAdminConsoleClientsGet(req("limit=1"), deps());
      expect(
        (list.body as { data: { items: { id: string }[] } }).data.items.map((r) => r.id),
      ).not.toContain(org);
      const detail = await handleAdminConsoleClientsGet(req("limit=1"), deps(), org);
      expect(detail.body).toMatchObject({ data: { client: { id: org } } });
      const tool = await readAssistantTool("get_client", req(`limit=1&entity_id=${org}`), deps());
      expect((tool.body as { data: unknown }).data).toEqual(
        (detail.body as { data: unknown }).data,
      );
      expect(
        (await handleAdminConsoleClientsGet(req(`organization_id=${foreign}`), deps(), org)).status,
      ).toBe(404);
      expect(JSON.stringify(detail.body)).not.toContain("SECRET_NEVER_READ");
    });
    it("pages eligible clients without losing microsecond timestamps or duplicating a row", async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
      const timestamp = (
        await client`SELECT (greatest(max(created_at),'2099-01-01T00:00:00.123456Z'::timestamptz)+interval '1 second')::text AS value FROM organizations`
      )[0]!.value;
      for (const id of ids) {
        await client`INSERT INTO organizations(id,owner_user_id,kind,name,created_at) VALUES (${id}::uuid,${admin}::uuid,'personal','Pagination fixture',${timestamp}::timestamptz)`;
        await client`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${randomUUID()}::uuid,${id}::uuid,'htx',${id},'SECRET_NEVER_READ')`;
      }
      type Page = { items: { id: string }[]; nextCursor: string; aggregate: { total: number } };
      const first = (await handleAdminConsoleClientsGet(req("limit=2"), deps())).body as {
        data: Page;
      };
      expect(first.data.items.map((r) => r.id)).toEqual(ids.slice(0, 2));
      expect(first.data.aggregate.total).toBeGreaterThanOrEqual(3);
      const second = (
        await handleAdminConsoleClientsGet(
          req(`limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`),
          deps(),
        )
      ).body as { data: Page };
      expect(second.data.items[0]?.id).toBe(ids[2]);
      expect(second.data.aggregate.total).toBe(first.data.aggregate.total);
      expect(second.data.items.map((r) => r.id)).not.toContain(ids[0]);
      expect(second.data.items.map((r) => r.id)).not.toContain(ids[1]);
    });
    it("mutes without resolving, appends actor evidence, and rejects stale or foreign incident commands", async () => {
      const request = req(`organization_id=${org}`);
      const get = () => handleAdminConsoleIncidentsGet(request, deps(), incident);
      const initial = await get();
      const data = (initial.body as { data: { incident: { revision: string; status: string } } })
        .data;
      const command = {
        id: incident,
        expectedRevision: data.incident.revision,
        action: "mute",
        mutedUntil: new Date(Date.now() + 3600000).toISOString(),
        reason: "Temporary notification pause",
        evidence: "Local acceptance fixture",
      };
      const post = (q: string, body: unknown) =>
        handleAdminConsoleIncidentPost(
          new Request(`http://localhost/api/trader/admin/console/incidents?${q}`, {
            method: "POST",
            headers: { origin: "http://localhost", "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          deps(),
        );
      const saved = await post(`organization_id=${org}`, command);
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({
        data: { status: "new", mutedUntil: command.mutedUntil, stateVersion: 2 },
      });
      expect((await post(`organization_id=${org}`, command)).status).toBe(409);
      expect((await post(`organization_id=${foreign}`, command)).status).toBe(404);
      const detail = await get();
      expect(detail.body).toMatchObject({
        data: {
          incident: { status: "new" },
          history: [{ from: "new", to: "new", reason: "MUTE: Temporary notification pause" }],
          events: [{ message: "Test failure" }],
        },
      });
      const tool = await readAssistantTool(
        "get_incident",
        req(`organization_id=${org}&entity_id=${incident}`),
        deps(),
      );
      expect((tool.body as { data: unknown }).data).toEqual(
        (detail.body as { data: unknown }).data,
      );
    });
    it("returns retained changes and a full count, never another owner's visit marker", async () => {
      const missing = await handleAdminConsoleChangesGet(req(`organization_id=${org}`), deps());
      expect(missing.body).toMatchObject({
        data: { state: "unavailable", reasons: ["PREVIOUS_VISIT_NOT_RECORDED"] },
      });
      await client`INSERT INTO trader_admin_visit_marker(admin_user_id,organization_id,last_seen_at) VALUES (${admin}::uuid,${org}::uuid,now())`;
      expect(
        (await handleAdminConsoleChangesGet(req(`organization_id=${org}`), deps())).body,
      ).toMatchObject({
        data: { state: "unavailable", reasons: ["PREVIOUS_VISIT_NOT_RECORDED"] },
      });
      const query = `organization_id=${org}&since=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}&limit=1`;
      const read = await handleAdminConsoleChangesGet(req(query), deps());
      const data = (
        read.body as {
          data: { items: unknown[]; aggregate: { total: number }; truncated: boolean };
        }
      ).data;
      expect(data.items).toHaveLength(1);
      expect(data.aggregate.total).toBeGreaterThan(1);
      expect(data.truncated).toBe(true);
      expect(
        (await handleAdminConsoleChangesGet(req(`${query}&admin_user_id=${other}`), deps())).status,
      ).toBe(404);
      expect(
        (await handleAdminConsoleChangesGet(req(`${query}&exchange_account_id=${account}`), deps()))
          .body,
      ).toMatchObject({
        data: { state: "not_applicable", reasons: ["CHANGE_ACCOUNT_BINDING_NOT_PERSISTED"] },
      });
      const tool = await readAssistantTool("changes_since", req(query), deps());
      expect((tool.body as { data: unknown }).data).toEqual(data);
    });
    it("shows complete observed balances even when orders are partial, keeping the warning and exact aggregate", async () => {
      const at = Date.now();
      const full = consoleObservation(
        {
          organizationId: org,
          credentialId: credential,
          exchangeAccountId: account,
          credentialRevision: "1",
          configurationRevision: "proof",
        },
        "234.12345678",
        at,
      );
      const obs = {
        ...full,
        status: "PARTIAL",
        openOrders: { ...full.openOrders, status: "PARTIAL" },
      };
      await client`INSERT INTO trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols) VALUES (${org}::uuid,${credential}::uuid,${account},'proof','["BTCUSDT"]')`;
      await client`INSERT INTO trader_account_observations(organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at) VALUES (${org}::uuid,${credential}::uuid,${account},${obs.observationId}::uuid,1,'proof',${randomUUID()}::uuid,${JSON.stringify(obs)}::jsonb,now())`;
      await client`UPDATE trader_account_collection_state SET last_observation_id=${obs.observationId}::uuid WHERE credential_id=${credential}::uuid`;
      const read = await handleAdminConsoleAccountsGet(
        req(`organization_id=${org}&mode=live`),
        deps(),
      );
      expect(read.body).toMatchObject({
        data: {
          items: [
            {
              equity: "234.12345678",
              state: "partial",
              included: true,
              reasons: expect.arrayContaining(["OPEN_ORDERS_PARTIAL"]),
            },
          ],
          aggregate: {
            finance: { equity: { state: "partial", value: { amount: "234.12345678" } } },
          },
        },
      });
    });
    it("keeps a virtual paper portfolio separate and excludes mock/history/foreign organization", async () => {
      for (const [mode, organization, historical] of [
        ["paper", org, null],
        ["mock", org, null],
        ["mock", org, "console-history-proof"],
        ["paper", foreign, null],
      ] as const) {
        const id = randomUUID();
        await client`INSERT INTO trader_orders(id,organization_id,venue,execution_mode,symbol,side,type,price,quantity,filled_quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${id}::uuid,${organization}::uuid,'htx',${mode}::order_execution_mode,'BTCUSDT','buy','limit','100','1','0','CREATED',${id},${id},'test')`;
        if (historical)
          await client`UPDATE trader_orders SET historical_run_id=${historical}, historical_account_key='history-account' WHERE id=${id}::uuid`;
      }
      const query = `organization_id=${org}&mode=paper`;
      const read = await handleAdminConsolePaperPortfoliosGet(req(query), deps());
      expect(read.body).toMatchObject({
        data: {
          items: [
            {
              organizationId: org,
              portfolio: "paper",
              orderCount: 1,
              cash: null,
              equity: null,
              positions: null,
              reasons: expect.arrayContaining([
                "PAPER_INITIAL_CASH_NOT_PERSISTED",
                "PAPER_ACCOUNT_BINDING_NOT_PERSISTED",
              ]),
            },
          ],
        },
      });
      const tool = await readAssistantTool("list_accounts", req(query), deps());
      expect((tool.body as { data: unknown }).data).toEqual((read.body as { data: unknown }).data);
      expect(
        (
          await handleAdminConsolePaperPortfoliosGet(
            req(`organization_id=${org}&mode=live`),
            deps(),
          )
        ).body,
      ).toMatchObject({ data: { state: "not_applicable" } });
    });
    it("sums exact quantities only from lots bound exclusively to the virtual paper book", async () => {
      const book = `paper-${randomUUID()}`;
      for (const qty of ["0.12345678", "0.00000001"]) {
        const trade = randomUUID(),
          lot = randomUUID(),
          order = randomUUID(),
          fill = randomUUID();
        await client`INSERT INTO trader_trades(id,organization_id,symbol,venue,account_key,position_side,instrument_kind,strategy_signal_id,strategy_id,strategy_version,state,semantics_version,opened_at,risk_decision_id) VALUES (${trade}::uuid,${org}::uuid,'BTCUSDT','htx',${book},'LONG','SPOT',${trade},'fixture','1','OPEN','test',now(),'fixture')`;
        await client`INSERT INTO trader_position_lots(id,organization_id,symbol,venue,account_key,position_side,instrument_kind,strategy_signal_id,state,open_qty,remaining_qty,avg_cost,opened_at,trade_id) VALUES (${lot}::uuid,${org}::uuid,'BTCUSDT','htx',${book},'LONG','SPOT',${trade},'OPEN',${qty},${qty},'100',now(),${trade}::uuid)`;
        await client`INSERT INTO trader_orders(id,organization_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${order}::uuid,${org}::uuid,'htx','paper','BTCUSDT','buy','market',${qty},'FILLED',${order},${order},'fixture')`;
        await client`INSERT INTO trader_fills(id,organization_id,order_id,exchange_trade_id,price,quantity,fee,fee_asset,executed_at) VALUES (${fill}::uuid,${org}::uuid,${order}::uuid,${fill},'100',${qty},'0','USDT',now())`;
        await client`INSERT INTO trader_trade_legs(id,organization_id,trade_id,position_lot_id,kind,order_id,fill_id,quantity,price,fee,executed_at,leg_pnl) VALUES (${randomUUID()}::uuid,${org}::uuid,${trade}::uuid,${lot}::uuid,'OPEN_FILL',${order}::uuid,${fill}::uuid,${qty},'100','0',now(),'0')`;
      }
      const read = await handleAdminConsolePaperPortfoliosGet(
        req(`organization_id=${org}&mode=paper`),
        deps(),
      );
      expect(read.body).toMatchObject({
        data: {
          items: expect.arrayContaining([
            expect.objectContaining({
              accountKey: book,
              cash: null,
              positions: [{ symbol: "BTCUSDT", quantity: "0.12345679" }],
            }),
          ]),
        },
      });
    });
  },
);
