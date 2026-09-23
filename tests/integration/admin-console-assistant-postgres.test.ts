/**
 * Opt-in: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES.
 * Creates the assistant tables when this database has not applied migration 0214,
 * then drops them. The language-model path stays fake.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { handleAdminConsoleAssistantConversationsPost } from "@/lib/trader/admin-console/handlers/assistant-conversations";
import { handleAdminConsoleAssistantMessagesPost } from "@/lib/trader/admin-console/handlers/assistant-messages";
import { handleAdminConsoleAssistantTraceGet } from "@/lib/trader/admin-console/handlers/assistant-trace";
import { resetAdminConsoleSchemaProbeForTests } from "@/lib/trader/admin-console/schema-probe";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const describePostgres = describe.skipIf(!enabled || !url);
const ADMIN_ID = "10560000-0000-4000-8000-00000000c056";

const ASSISTANT_DDL = `
CREATE TABLE IF NOT EXISTS trader_admin_change_log (
  seq bigserial PRIMARY KEY,
  xid xid8 NOT NULL,
  changed_at timestamp with time zone NOT NULL,
  source_table text NOT NULL,
  op text NOT NULL,
  entity_id text NOT NULL,
  organization_id uuid,
  entity_version bigint
);
CREATE TABLE IF NOT EXISTS trader_admin_assistant_conversation (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  admin_user_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  archived_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS trader_admin_assistant_message (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES trader_admin_assistant_conversation(id) ON DELETE cascade,
  role text NOT NULL,
  content text NOT NULL,
  blocks_json jsonb,
  status text NOT NULL,
  scope_json jsonb,
  attachments_json jsonb,
  citations_json jsonb,
  data_revisions_json jsonb,
  cache_key text,
  provider text,
  model text,
  provider_lifecycle text,
  prompt_version text,
  tool_policy_version text,
  latency_ms integer,
  usage_json jsonb,
  error_code text,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT trader_admin_assistant_message_role_check CHECK (role IN ('user','assistant')),
  CONSTRAINT trader_admin_assistant_message_status_check CHECK (status IN ('pending','complete','failed','stopped','provider_unavailable'))
);
CREATE TABLE IF NOT EXISTS trader_admin_assistant_tool_call (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES trader_admin_assistant_message(id) ON DELETE cascade,
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  args_json jsonb NOT NULL,
  result_digest text,
  result_summary_json jsonb,
  status text NOT NULL,
  started_at timestamp with time zone NOT NULL,
  finished_at timestamp with time zone,
  error_code text
);
`;

describePostgres("admin assistant turns persist on postgres", () => {
  let sqlClient: postgres.Sql;
  let runtime: WaiaRuntimeDb;
  let createdSchema = false;
  const previous: Record<string, string | undefined> = {};

  function deps(): AdminRouteHandlerDeps {
    return {
      getUserId: async () => ADMIN_ID,
      getRuntimeDb: async () => runtime,
      disposeRuntimeDb: async () => undefined,
    };
  }

  beforeAll(async () => {
    sqlClient = postgres(url!, { max: 2, prepare: false });
    const db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
    runtime = { kind: "postgres", db, _sql: sqlClient };
    const existing = await sqlClient<{ conversation: string | null }[]>`
      SELECT to_regclass('public.trader_admin_assistant_conversation') AS conversation
    `;
    createdSchema = existing[0]?.conversation == null;
    if (createdSchema) await sqlClient.unsafe(ASSISTANT_DDL);
    await sqlClient.unsafe("INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT DO NOTHING", [
      ADMIN_ID,
    ]);
    await sqlClient`
      INSERT INTO users (id, identity_label, email)
      VALUES (${ADMIN_ID}::uuid, 'Console admin', 'dee-1056-admin@waia.invalid')
      ON CONFLICT (id) DO NOTHING
    `;
    await ensureUserCoreSeedPostgres(db, { userId: ADMIN_ID, displayName: "Console admin" });
    await sqlClient`
      UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${ADMIN_ID}::uuid
    `;
    resetAdminConsoleSchemaProbeForTests();
    for (const key of [
      "WAIA_ADMIN_ASSISTANT_ENABLED",
      "WAIA_AI_TRADER_GATEWAY_FOUNDATION",
      "WAIA_TRADER_SEE_AI_REASONING",
    ]) {
      previous[key] = process.env[key];
    }
    process.env.WAIA_ADMIN_ASSISTANT_ENABLED = "on";
    delete process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION;
    delete process.env.WAIA_TRADER_SEE_AI_REASONING;
  });

  afterAll(async () => {
    if (!sqlClient) return;
    await sqlClient`DELETE FROM trader_admin_assistant_tool_call WHERE message_id IN (
      SELECT m.id FROM trader_admin_assistant_message m
      JOIN trader_admin_assistant_conversation c ON c.id = m.conversation_id
      WHERE c.admin_user_id = ${ADMIN_ID}::uuid
    )`;
    await sqlClient`DELETE FROM trader_admin_assistant_message WHERE conversation_id IN (
      SELECT id FROM trader_admin_assistant_conversation WHERE admin_user_id = ${ADMIN_ID}::uuid
    )`;
    await sqlClient`DELETE FROM trader_admin_assistant_conversation WHERE admin_user_id = ${ADMIN_ID}::uuid`;
    await sqlClient`DELETE FROM organization_members WHERE user_id = ${ADMIN_ID}::uuid`;
    await sqlClient`DELETE FROM organization_entitlements WHERE organization_id = ${personalOrganizationIdFromUserId(ADMIN_ID)}::uuid`;
    await sqlClient`DELETE FROM organization_subscriptions WHERE organization_id = ${personalOrganizationIdFromUserId(ADMIN_ID)}::uuid`;
    await sqlClient`DELETE FROM organizations WHERE id = ${personalOrganizationIdFromUserId(ADMIN_ID)}::uuid`;
    await sqlClient`DELETE FROM user_platform_roles WHERE user_id = ${ADMIN_ID}::uuid`;
    await sqlClient`DELETE FROM profiles WHERE user_id = ${ADMIN_ID}::uuid`;
    await sqlClient`DELETE FROM users WHERE id = ${ADMIN_ID}::uuid`;
    await sqlClient`DELETE FROM auth.users WHERE id = ${ADMIN_ID}::uuid`;
    if (createdSchema) {
      await sqlClient.unsafe(`
        DROP TABLE IF EXISTS trader_admin_assistant_tool_call;
        DROP TABLE IF EXISTS trader_admin_assistant_message;
        DROP TABLE IF EXISTS trader_admin_assistant_conversation;
        DROP TABLE IF EXISTS trader_admin_change_log;
      `);
    }
    resetAdminConsoleSchemaProbeForTests();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await sqlClient.end();
  });

  it("stores a fake-provider turn and streams the error", async () => {
    const created = await handleAdminConsoleAssistantConversationsPost(
      new Request("http://localhost/api/trader/admin/console/assistant/conversations", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ title: "Проверка" }),
      }),
      deps(),
    );
    expect(created.status).toBe(200);
    const createdBody = created.body as {
      data?: { conversation?: { id?: string } };
    };
    const conversationId = createdBody.data?.conversation?.id;
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/i);

    const posted = await handleAdminConsoleAssistantMessagesPost(
      new Request("http://localhost/api/trader/admin/console/assistant/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ conversationId, content: "Какие ордера ещё работают?" }),
      }),
      deps(),
    );
    expect(posted.status).toBe(200);
    const streamed = new TextDecoder().decode(posted.binaryBody);
    expect(streamed).toContain("event: error");
    expect(streamed).toContain("PROVIDER_UNAVAILABLE");

    const rows = await sqlClient<{ role: string; status: string }[]>`
      SELECT role, status
      FROM trader_admin_assistant_message
      WHERE conversation_id = ${conversationId!}::uuid
      ORDER BY role
    `;
    expect(rows.map((row) => `${row.role}:${row.status}`).sort()).toEqual([
      "assistant:provider_unavailable",
      "user:complete",
    ]);

    const assistant = await sqlClient<{ id: string }[]>`
      SELECT id FROM trader_admin_assistant_message
      WHERE conversation_id = ${conversationId!}::uuid AND role = 'assistant'
    `;
    const trace = await handleAdminConsoleAssistantTraceGet(
      new Request("http://localhost/api/trader/admin/console/assistant/messages/trace"),
      deps(),
      assistant[0]!.id,
    );
    expect(trace.status).toBe(200);
    expect(JSON.stringify(trace.body)).toContain('"calls":[]');
  });

  it("streams tool stages and stores the tool rows for a stubbed answer", async () => {
    const created = await handleAdminConsoleAssistantConversationsPost(
      new Request("http://localhost/api/trader/admin/console/assistant/conversations", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ title: "Инструменты" }),
      }),
      deps(),
    );
    const conversationId = (created.body as { data?: { conversation?: { id?: string } } }).data
      ?.conversation?.id;
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/i);

    const posted = await handleAdminConsoleAssistantMessagesPost(
      new Request("http://localhost/api/trader/admin/console/assistant/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          accept: "text/event-stream",
        },
        body: JSON.stringify({ conversationId, content: "Что на счетах?" }),
      }),
      deps(),
      {
        complete: async () => ({
          text: JSON.stringify({ action: "answer", summary: "Готово", citations: [] }),
          usage: { totalTokens: 4 },
        }),
      },
    );
    expect(posted.status).toBe(200);
    const streamed = new TextDecoder().decode(posted.binaryBody);
    const stageAt = streamed.indexOf("event: stage");
    const readyAt = streamed.indexOf("event: tool_result_ready");
    const answerAt = streamed.indexOf("event: answer");
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(stageAt).toBeLessThan(readyAt);
    expect(readyAt).toBeLessThan(answerAt);
    expect(streamed).toContain("Получаю счета…");

    const assistant = await sqlClient<{ id: string; status: string }[]>`
      SELECT id, status FROM trader_admin_assistant_message
      WHERE conversation_id = ${conversationId!}::uuid AND role = 'assistant'
    `;
    expect(assistant[0]?.status).toBe("complete");
    const trace = await handleAdminConsoleAssistantTraceGet(
      new Request("http://localhost/api/trader/admin/console/assistant/messages/trace"),
      deps(),
      assistant[0]!.id,
    );
    expect(trace.status).toBe(200);
    const traceBody = JSON.stringify(trace.body);
    expect(traceBody).toContain("list_accounts");
    expect(traceBody).toContain("list_orders");
    expect(traceBody).toContain('"status":"complete"');
  });
});
