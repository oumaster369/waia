import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { consumeFinanceAssistantConfirmation } from "@/lib/waia-core/finance-assistant/confirmation-store";
import type { FinanceAssistantConfirmationPayload } from "@/lib/waia-core/finance-assistant/types";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_ID = "70500000-0000-4000-8000-000000000101";
const ORG_ID = "70500000-0000-4000-8000-000000000201";
const NOW = new Date("2026-08-24T12:00:00.000Z");

const describePostgres = describe.skipIf(!enabled || !url);

describePostgres("DEE-705 Finance Assistant confirmation receipts", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let runtime: WaiaRuntimeDb;

  async function clearReceipts() {
    await sqlClient.unsafe(
      "ALTER TABLE treasury_finance_assistant_confirmations DISABLE TRIGGER treasury_finance_assistant_confirmation_block_delete",
    );
    try {
      await sqlClient`DELETE FROM treasury_finance_assistant_confirmations WHERE organization_id = ${ORG_ID}::uuid`;
    } finally {
      await sqlClient.unsafe(
        "ALTER TABLE treasury_finance_assistant_confirmations ENABLE TRIGGER treasury_finance_assistant_confirmation_block_delete",
      );
    }
  }

  beforeAll(async () => {
    sqlClient = postgres(url!, { max: 3, prepare: false });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
    runtime = { kind: "postgres", db, _sql: sqlClient };
    await sqlClient.unsafe("INSERT INTO auth.users (id) VALUES ($1::uuid) ON CONFLICT DO NOTHING", [
      USER_ID,
    ]);
    await db
      .insert(pgSchema.users)
      .values({
        id: USER_ID,
        identityLabel: "DEE-705 confirmation fixture",
        email: "dee-705-confirmation@waia.invalid",
      })
      .onConflictDoNothing();
    await db
      .insert(pgSchema.organizations)
      .values({
        id: ORG_ID,
        ownerUserId: USER_ID,
        kind: "fund",
        name: "DEE-705 confirmation fixture",
      })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    await sqlClient.unsafe("RESET ROLE");
    await clearReceipts();
  });

  afterAll(async () => {
    if (!sqlClient) return;
    await sqlClient.unsafe("RESET ROLE");
    await clearReceipts();
    await sqlClient`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
    await sqlClient`DELETE FROM users WHERE id = ${USER_ID}::uuid`;
    await sqlClient.unsafe("DELETE FROM auth.users WHERE id = $1::uuid", [USER_ID]);
    await sqlClient.end({ timeout: 5 });
  });

  function payload(): FinanceAssistantConfirmationPayload {
    return {
      version: 1,
      subjectUserId: USER_ID,
      organizationId: ORG_ID,
      intent: "CREATE_PROJECT",
      fields: { name: "Breath of WAIA" },
      issuedAt: Math.floor(NOW.getTime() / 1_000),
      expiresAt: Math.floor(NOW.getTime() / 1_000) + 600,
      nonce: "single-use-nonce",
    };
  }

  it("consumes one nonce exactly once", async () => {
    await consumeFinanceAssistantConfirmation(runtime, payload(), NOW);
    await expect(
      consumeFinanceAssistantConfirmation(runtime, payload(), NOW),
    ).rejects.toMatchObject({ code: "ASSISTANT_CONFIRMATION_ALREADY_USED" });
    const rows = await sqlClient<{ intent: string; nonce_digest: string; fields_digest: string }[]>`
      SELECT intent, nonce_digest, fields_digest
      FROM treasury_finance_assistant_confirmations
      WHERE organization_id = ${ORG_ID}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.intent).toBe("CREATE_PROJECT");
    expect(rows[0]?.nonce_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.fields_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is RLS-enabled, append-only, and unavailable to browser roles", async () => {
    await consumeFinanceAssistantConfirmation(runtime, payload(), NOW);
    const structure = await sqlClient<
      { relrowsecurity: boolean; policy_count: number; trigger_count: number }[]
    >`
      SELECT c.relrowsecurity,
        (SELECT count(*)::int FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count,
        (SELECT count(*)::int FROM pg_trigger t
          WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS trigger_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'treasury_finance_assistant_confirmations'
    `;
    expect(structure[0]).toEqual({ relrowsecurity: true, policy_count: 4, trigger_count: 2 });
    await expect(
      sqlClient.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        return tx`SELECT id FROM treasury_finance_assistant_confirmations`;
      }),
    ).rejects.toThrow();
    await expect(
      sqlClient`UPDATE treasury_finance_assistant_confirmations SET intent = 'CREATE_ACCOUNT' WHERE organization_id = ${ORG_ID}::uuid`,
    ).rejects.toThrow(/append-only/i);
  });
});
