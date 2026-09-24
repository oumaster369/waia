import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { mirrorPlatformAdminInPostgres } from "./helpers/admin-console-pg";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const url = process.env.DATABASE_URL_POSTGRES ?? "";

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
