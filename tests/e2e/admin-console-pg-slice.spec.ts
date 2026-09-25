import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { mirrorPlatformAdminInPostgres } from "./helpers/admin-console-pg";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";
import { consoleObservation } from "../helpers/admin-console-observation";

const TRADER_PASSWORD = "password123!";
const url = process.env.DATABASE_URL_POSTGRES ?? "";

test("financial slice refreshes a saved account balance and a fill without reloading the page", async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(120000);
  const sql = postgres(url, { max: 2, prepare: false });
  const email = `console-finance-slice-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1"),
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
    grantTraderEntitlementByUserEmail(email);
    const { userId } = grantPlatformAdminByUserEmail(email);
    await mirrorPlatformAdminInPostgres(sql, userId, email);
    const binding = {
      organizationId: crypto.randomUUID(),
      credentialId: crypto.randomUUID(),
      exchangeAccountId: `financial-slice-${crypto.randomUUID()}`,
      credentialRevision: "1",
      configurationRevision: "fixture",
    };
    await sql`INSERT INTO organizations(id,owner_user_id,kind,name) VALUES (${binding.organizationId}::uuid,${userId}::uuid,'personal','Финансовый срез')`;
    await sql`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${binding.credentialId}::uuid,${binding.organizationId}::uuid,'htx',${binding.exchangeAccountId},'synthetic-not-a-key')`;
    await sql`INSERT INTO trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols) VALUES (${binding.organizationId}::uuid,${binding.credentialId}::uuid,${binding.exchangeAccountId},'fixture','["BTCUSDT"]')`;
    const observe = async (amount: string) => {
      const observation = consoleObservation(binding, amount, Date.now());
      await sql`INSERT INTO trader_account_observations(organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at) VALUES (${binding.organizationId}::uuid,${binding.credentialId}::uuid,${binding.exchangeAccountId},${observation.observationId}::uuid,1,'fixture',${crypto.randomUUID()}::uuid,${sql.json(JSON.parse(JSON.stringify(observation)))}::jsonb,now())`;
      await sql`UPDATE trader_account_collection_state SET last_observation_id=${observation.observationId}::uuid WHERE credential_id=${binding.credentialId}::uuid`;
    };
    await observe("271.12345678");
    const order = crypto.randomUUID(),
      fill = crypto.randomUUID();
    await sql`INSERT INTO trader_orders(id,organization_id,credential_id,venue,execution_mode,symbol,side,type,quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${order}::uuid,${binding.organizationId}::uuid,${binding.credentialId}::uuid,'htx','live','SLICEBTCUSDT','buy','market','0.12345678','ACCEPTED',${order},${order},'fixture')`;
    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");
    const query = `organization_id=${binding.organizationId}&exchange_account_id=${binding.exchangeAccountId}&mode=live`;
    await page.goto(`/admin/accounts?${query}`);
    await expect(page.locator("main")).toContainText("271,12345678");
    await observe("281.12345679");
    await expect(page.locator("main")).toContainText("281,12345679", { timeout: 25000 });
    await expect(page.locator("main")).not.toContainText("271,12345678");
    await page.goto(`/admin/orders?${query}&tab=fills`);
    await expect(page.locator("main")).toContainText("Записей пока нет");
    await sql`INSERT INTO trader_fills(id,organization_id,order_id,exchange_trade_id,price,quantity,fee,fee_asset,executed_at) VALUES (${fill}::uuid,${binding.organizationId}::uuid,${order}::uuid,${fill},'99.12345678','0.12345678','0.00000001','USDT',now())`;
    await expect(page.getByRole("table", { name: "Исполнения ордеров" })).toContainText(
      "SLICEBTCUSDT",
      { timeout: 25000 },
    );
    await expect(page.getByRole("table", { name: "Исполнения ордеров" })).toContainText(
      "99.12345678",
    );
    await expect(
      page.getByRole("table", { name: "Исполнения ордеров" }).getByRole("row"),
    ).toHaveCount(2);
  } finally {
    // Retain this isolated fixture's append-only observations as acceptance evidence.
    await primary.close();
    await sql.end({ timeout: 5 });
  }
});

test("slice gate shows a live order transition and an incident", async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(180_000);
  const sql = postgres(url, { max: 1 });
  const email = `console-slice-${crypto.randomUUID()}@waia.local`;
  const orgId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const incidentId = crypto.randomUUID();
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1") ?? "http://127.0.0.1:3000",
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
    grantTraderEntitlementByUserEmail(email);
    const { userId } = grantPlatformAdminByUserEmail(email);
    await mirrorPlatformAdminInPostgres(sql, userId, email);
    await sql`INSERT INTO organizations (id, owner_user_id, kind, name) VALUES (${orgId}, ${userId}, ${"personal"}, ${"slice"})`;
    await sql`
      INSERT INTO trader_orders (
        id, organization_id, venue, execution_mode, symbol, side, type,
        quantity, state, client_order_id, idempotency_key, risk_decision_id
      ) VALUES (
        ${orderId}::uuid, ${orgId}::uuid, 'htx', 'live', 'SLICEBTC', 'buy', 'market',
        '1', 'CREATED', ${orderId}, ${orderId}, 'risk'
      )
    `;
    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");
    await page.goto("/admin/orders");
    await expect(page.getByText("SLICEBTC")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-order-id="${orderId}"]`).getByText("Создан")).toBeVisible();
    await sql`UPDATE trader_orders SET state = 'RISK_APPROVED', state_version = 2 WHERE id = ${orderId}::uuid`;
    await expect(
      page.locator(`[data-order-id="${orderId}"]`).getByText("Риск одобрил"),
    ).toBeVisible({ timeout: 20_000 });
    await sql`
      INSERT INTO trader_admin_incident (
        id, environment, service, fingerprint, title, severity, status,
        first_seen_at, last_seen_at, occurrences
      ) VALUES (
        ${incidentId}::uuid, 'test', 'test', ${incidentId}, 'SLICE-INCIDENT', 'error', 'new',
        now(), now(), 1
      )
    `;
    await page.goto("/admin/errors");
    await expect(page.getByText("SLICE-INCIDENT")).toBeVisible({ timeout: 20_000 });
  } finally {
    await primary.close();
    await sql`DELETE FROM trader_admin_incident WHERE id = ${incidentId}::uuid`;
    await sql`DELETE FROM trader_orders WHERE id = ${orderId}::uuid`;
    await sql`DELETE FROM trader_admin_change_log WHERE entity_id IN (${orderId}, ${incidentId})`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`;
    const mirrored = await sql<{ id: string }[]>`
      SELECT id::text AS id FROM users WHERE email = ${email}
    `;
    await sql`DELETE FROM user_platform_roles WHERE user_id IN (SELECT id FROM users WHERE email = ${email})`;
    await sql`DELETE FROM users WHERE email = ${email}`;
    for (const row of mirrored) {
      await sql`DELETE FROM auth.users WHERE id = ${row.id}::uuid`;
    }
    await sql.end({ timeout: 5 });
  }
});
