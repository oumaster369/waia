/** Disposable local/CI Postgres; synthetic records only and injected provider, no network. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { consoleObservation } from "@/tests/helpers/admin-console-observation";
import { handleAdminConsoleAssistantQuickAnswersGet } from "@/lib/trader/admin-console/handlers/assistant-quick-answers";
import {
  handleAdminConsoleAssistantConversationsPost,
  handleAdminConsoleAssistantConversationGet,
} from "@/lib/trader/admin-console/handlers/assistant-conversations";
import { handleAdminConsoleAssistantMessagesPost } from "@/lib/trader/admin-console/handlers/assistant-messages";
import { handleAdminConsoleAssistantTraceGet } from "@/lib/trader/admin-console/handlers/assistant-trace";
import { handleAdminConsoleAggregateGet } from "@/lib/trader/admin-console/handlers/aggregate";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";
import type { AssistantFact } from "@/lib/trader/admin-console/assistant/facts";
const url = process.env.DATABASE_URL_POSTGRES,
  enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
describe.skipIf(!enabled)("assistant grounded facts and contextual ownership on Postgres", () => {
  let client: postgres.Sql, db: AdminPostgresDb;
  const admin = randomUUID(),
    foreignAdmin = randomUUID(),
    org = personalOrganizationIdFromUserId(admin),
    otherOrg = personalOrganizationIdFromUserId(foreignAdmin);
  const account = randomUUID(),
    foreignAccount = randomUUID();
  let conversationId: string, messageId: string;
  const previous = process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
  const deps = (user = admin): AdminRouteHandlerDeps => ({
    getUserId: async () => user,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  const req = (path: string, body?: unknown, foreign = false) =>
    new Request(
      `http://localhost/api/trader/admin/console/${path}${path.includes("?") ? "&" : "?"}organization_id=${foreign ? otherOrg : org}&exchange_account_id=${foreign ? foreignAccount : account}&mode=live&currency=USDT&period=7d`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://localhost" },
            body: JSON.stringify(body),
          },
    );
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 3, prepare: false });
    db = drizzle(client, { schema });
    for (const [user, exchangeId, amount] of [
      [admin, account, "1234567890.12345678"],
      [foreignAdmin, foreignAccount, "987.65"],
    ]) {
      await client`INSERT INTO auth.users(id) VALUES (${user}::uuid)`;
      await client`INSERT INTO users(id,identity_label,email) VALUES (${user}::uuid,'Assistant fixture',${`${user}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: user, displayName: "Assistant fixture" });
      await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${user}::uuid`;
      const binding = {
        organizationId: personalOrganizationIdFromUserId(user),
        credentialId: randomUUID(),
        exchangeAccountId: exchangeId,
        credentialRevision: "1",
        configurationRevision: "test",
      };
      await client`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${binding.credentialId}::uuid,${binding.organizationId}::uuid,'htx',${exchangeId},'SECRET_EXCHANGE_CREDENTIAL')`;
      await client`INSERT INTO trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols) VALUES (${binding.organizationId}::uuid,${binding.credentialId}::uuid,${exchangeId},'test','["BTCUSDT"]')`;
      const observation = consoleObservation(binding, amount, Date.now());
      await client`INSERT INTO trader_account_observations(organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at) VALUES (${binding.organizationId}::uuid,${binding.credentialId}::uuid,${exchangeId},${observation.observationId}::uuid,1,'test',${randomUUID()}::uuid,${JSON.stringify(observation)}::jsonb,now())`;
      await client`UPDATE trader_account_collection_state SET last_observation_id=${observation.observationId}::uuid WHERE credential_id=${binding.credentialId}::uuid`;
    }
    for (let index = 0; index < 52; index++) {
      const id = randomUUID();
      await client`INSERT INTO trader_invoices(id,organization_id,exchange_account_id,reporting_period_id,fee_artifact_digest,status,currency,period_realized_strategy_profit,cumulative_realized_strategy_profit,previous_high_water_mark,new_profit_above_hwm,fee_rate,performance_fee,proposed_new_high_water_mark,billable,realized_fill_finality,starting_equity,ending_equity,net_deposits,net_withdrawals,period_start,period_end,valuation_source,fee_computed_at,schema_version,record_content_digest) VALUES (${id}::uuid,${org}::uuid,${account},${randomUUID()},'synthetic','DRAFT','USDT','100','100','0','100','0.3','1.00000001','100',true,false,'1000','1100','0','0',now()-interval '1 day',now(),'synthetic',now(),'test',${id})`;
    }
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
    else process.env.WAIA_ADMIN_ASSISTANT_ENABLED = previous;
    await client?.end();
  });
  it("keeps actual failed-job evidence and the complete catalog in a model-free system answer", async () => {
    const id = randomUUID();
    const observedAt = new Date(Date.now() - 1000).toISOString();
    await client`INSERT INTO trader_admin_job_run(id,job_key,started_at,finished_at,status,processed,blocked,error_class,details_json)
      VALUES (${id}::uuid,'payment_watcher',${observedAt}::timestamptz,${observedAt}::timestamptz,'failed',0,0,'SYNTHETIC_FAILURE','{}'::jsonb)`;
    try {
      const answer = await handleAdminConsoleAssistantQuickAnswersGet(
        req("assistant/quick-answers?id=system"),
        deps(),
      );
      expect(answer.status).toBe(200);
      const facts = (answer.body as { data: { facts: AssistantFact[] } }).data.facts;
      const failed = facts.find((fact) => fact.entityId === "payment_watcher")!;
      expect(failed).toMatchObject({
        label: "Наблюдение платежей · последний запуск",
        value: "Ошибка",
        state: "ok",
        href: expect.stringContaining("tab=jobs"),
      });
      expect(Date.parse(failed.observedAt!)).toBe(Date.parse(observedAt));
      expect(facts.find((fact) => fact.entityId === "invoice_issue")).toMatchObject({
        label: "Ручной выпуск счетов · последний запуск",
        value: null,
        state: "unavailable",
        reasons: ["MANUAL_OPERATION_NOT_SCHEDULED"],
      });
      expect(facts.find((fact) => fact.field === "jobs.coverage")).toMatchObject({
        value: "13",
        coverage: { included: 13, total: 13 },
      });
      expect(facts.find((fact) => fact.field === "release.sha")?.href).toContain("tab=releases");
    } finally {
      await client`DELETE FROM trader_admin_job_run WHERE id=${id}::uuid`;
    }
  });
  it("serves disabled-model quick answers with exact scoped money, source links and complete aggregates", async () => {
    delete process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
    const quick = await handleAdminConsoleAssistantQuickAnswersGet(
      req("assistant/quick-answers?id=overview"),
      deps(),
    );
    expect(quick.body).toMatchObject({
      scope: { kind: "account", organizationId: org, exchangeAccountId: account },
      data: {
        withoutModel: true,
        facts: expect.arrayContaining([
          expect.objectContaining({
            field: "finance.equity",
            value: "1234567890.12345678",
            currency: "USDT",
            coverage: { included: 1, total: 1 },
          }),
        ]),
      },
    });
    expect(JSON.stringify(quick.body)).not.toContain("SECRET_EXCHANGE_CREDENTIAL");
    const invoices = await handleAdminConsoleAssistantQuickAnswersGet(
      req("assistant/quick-answers?id=invoices&limit=1"),
      deps(),
    );
    expect(invoices.body).toMatchObject({
      data: {
        facts: expect.arrayContaining([
          expect.objectContaining({
            field: "aggregate.0.amount",
            value: "52.00000052",
            coverage: { included: 52, total: 52 },
          }),
          expect.objectContaining({
            field: "list.coverage",
            value: "1",
            coverage: { included: 1, total: 52 },
          }),
        ]),
      },
    });
    const direct = await handleAdminConsoleAggregateGet(
      req("aggregate?dataset=invoices&limit=1"),
      deps(),
    );
    const tool = await readAssistantTool(
      "aggregate",
      req("aggregate?dataset=invoices&limit=1"),
      deps(),
    );
    expect((direct.body as { data: unknown }).data).toEqual((tool.body as { data: unknown }).data);
  });
  it("searches only within the selected account and generates existing console links", async () => {
    const own = await readAssistantTool("search", req(`search?q=${account}`), deps());
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      data: {
        results: {
          accounts: [
            expect.objectContaining({
              id: `htx:${account}`,
              href: expect.stringContaining("/admin/accounts?"),
            }),
          ],
        },
      },
    });
    const foreign = await readAssistantTool("search", req(`search?q=${foreignAccount}`), deps());
    expect(foreign.status).toBe(200);
    expect(foreign.body).toMatchObject({
      data: {
        results: {
          accounts: [],
          organizations: [],
          owners: [],
          invoices: [],
          payments: [],
          orders: [],
        },
      },
    });
    expect(JSON.stringify(foreign.body)).not.toContain(foreignAccount);
  });
  it("persists only server-rendered facts and matching context, not the model's arbitrary financial prose", async () => {
    process.env.WAIA_ADMIN_ASSISTANT_ENABLED = "on";
    const created = await handleAdminConsoleAssistantConversationsPost(
      req("assistant/conversations", { title: "Scope proof" }),
      deps(),
    );
    conversationId = (created.body as { data: { conversation: { id: string } } }).data.conversation
      .id;
    const result = await handleAdminConsoleAssistantMessagesPost(
      req("assistant/messages", { conversationId, content: "Покажи капитал; secret=DO_NOT_LEAK" }),
      deps(),
      {
        complete: async (prompt) => {
          expect(prompt).not.toContain("DO_NOT_LEAK");
          expect(prompt).not.toContain("SECRET_EXCHANGE_CREDENTIAL");
          const facts = JSON.parse(
            prompt.split("Каталог фактов: ")[1].split("\nВопрос оператора:")[0],
          ) as AssistantFact[];
          const equity = facts.find(
            (f) => f.tool === "get_overview" && f.field === "finance.equity",
          )!;
          return {
            text: JSON.stringify({
              action: "answer",
              factIds: [equity.id],
              summary: "Модель утверждает капитал 999 USD",
            }),
            usage: { totalTokens: 3 },
          };
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        unverified: true,
        facts: [expect.objectContaining({ value: "1234567890.12345678", currency: "USDT" })],
        context: {
          scope: { organizationId: org, exchangeAccountId: account },
          currency: "USDT",
          mode: "live",
          period: "7d",
        },
      },
    });
    const body = result.body as { data: { messageId: string; content: string } };
    messageId = body.data.messageId;
    expect(body.data.content).not.toContain("999 USD");
    const stored =
      await client`SELECT content,blocks_json,scope_json,data_revisions_json FROM trader_admin_assistant_message WHERE id=${messageId}::uuid`;
    expect(JSON.stringify(stored)).not.toContain("DO_NOT_LEAK");
    expect(stored[0].scope_json.currency).toBe("USDT");
  });
  it("filters history by client/account/currency and rejects another admin's conversation or trace, even when disabled", async () => {
    const history = await handleAdminConsoleAssistantConversationGet(
      req(`assistant/conversations/${conversationId}`),
      deps(),
      conversationId,
    );
    expect(history.body).toMatchObject({
      data: {
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: messageId,
            blocks: expect.objectContaining({
              facts: [expect.objectContaining({ value: "1234567890.12345678" })],
            }),
          }),
        ]),
      },
    });
    const other = await handleAdminConsoleAssistantConversationGet(
      req(`assistant/conversations/${conversationId}`, undefined, true),
      deps(),
      conversationId,
    );
    expect(other.body).toMatchObject({ data: { messages: [] } });
    expect(JSON.stringify(other.body)).not.toContain("1234567890");
    const usdReq = new Request(
      req(`assistant/conversations/${conversationId}`).url.replace("currency=USDT", "currency=USD"),
    );
    expect(
      (await handleAdminConsoleAssistantConversationGet(usdReq, deps(), conversationId)).body,
    ).toMatchObject({ data: { messages: [] } });
    expect(
      (
        await handleAdminConsoleAssistantConversationGet(
          req(`assistant/conversations/${conversationId}`),
          deps(foreignAdmin),
          conversationId,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleAdminConsoleAssistantTraceGet(
          req("assistant/trace"),
          deps(foreignAdmin),
          messageId,
        )
      ).status,
    ).toBe(404);
    delete process.env.WAIA_ADMIN_ASSISTANT_ENABLED;
    expect(
      (
        await handleAdminConsoleAssistantMessagesPost(
          req("assistant/messages", { conversationId, content: "Чужой разговор" }),
          deps(foreignAdmin),
        )
      ).status,
    ).toBe(404);
  });
  it("isolates provider failure and keeps exact quick answers available", async () => {
    process.env.WAIA_ADMIN_ASSISTANT_ENABLED = "on";
    const result = await handleAdminConsoleAssistantMessagesPost(
      req("assistant/messages", { conversationId, content: "Покажи капитал" }),
      deps(),
      {
        complete: async () => {
          throw new Error("provider down");
        },
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: { state: "unavailable", reasons: ["PROVIDER_UNAVAILABLE"] },
    });
    const quick = await handleAdminConsoleAssistantQuickAnswersGet(
      req("assistant/quick-answers?id=overview"),
      deps(),
    );
    expect(JSON.stringify(quick.body)).toContain("1234567890.12345678");
  });
});
