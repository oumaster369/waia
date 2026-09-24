import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { mirrorPlatformAdminInPostgres } from "./helpers/admin-console-pg";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const url = process.env.DATABASE_URL_POSTGRES ?? "";

test("admin console postgres SLO stays inside 500 ms with no loss and no duplicate", async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(240_000);
  const sql = postgres(url, { max: 1 });
  const email = `console-slo-${crypto.randomUUID()}@waia.local`;
  const orgId = crypto.randomUUID();
  const run = crypto.randomUUID().slice(0, 8);
  const writtenIds: string[] = [];
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1") ?? "http://127.0.0.1:3000",
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
    grantTraderEntitlementByUserEmail(email);
    const { userId } = grantPlatformAdminByUserEmail(email);
    await mirrorPlatformAdminInPostgres(sql, userId, email);
    await sql`INSERT INTO organizations (id, owner_user_id, kind, name) VALUES (${orgId}, ${userId}, ${"personal"}, ${"slo"})`;
    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");
    await page.goto("/admin/orders");
    await page.waitForTimeout(1_500);
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      const batchStarted = Date.now();
      for (let index = 0; index < 100; index += 1) {
        const id = crypto.randomUUID();
        writtenIds.push(id);
        await sql`
          INSERT INTO trader_orders (
            id, organization_id, venue, execution_mode, symbol, side, type,
            quantity, state, client_order_id, idempotency_key, risk_decision_id
          ) VALUES (
            ${id}::uuid, ${orgId}::uuid, 'htx', 'live', ${`SLO${run}`}, 'buy', 'market',
            '1', 'CREATED', ${id}, ${id}, 'risk'
          )
        `;
      }
      const elapsed = Date.now() - batchStarted;
      if (elapsed < 1000) await page.waitForTimeout(1000 - elapsed);
    }
    await expect
      .poll(
        () =>
          page.evaluate((ids) => {
            const bucket =
              (
                window as Window & {
                  __waiaAdminDelivery?: { entityId: string }[];
                }
              ).__waiaAdminDelivery ?? [];
            const seen = new Set(
              bucket
                .map((entry) => entry.entityId.split(":").at(-1) ?? "")
                .filter((entityId) => ids.includes(entityId)),
            );
            return seen.size;
          }, writtenIds),
        { timeout: 120_000 },
      )
      .toBe(writtenIds.length);
    const rows = await page.evaluate((ids) => {
      const bucket =
        (
          window as Window & {
            __waiaAdminDelivery?: {
              eventId: string;
              entityId: string;
              acceptedAt: string;
              renderedAt: number;
            }[];
          }
        ).__waiaAdminDelivery ?? [];
      return bucket.filter((entry) => ids.includes(entry.entityId.split(":").at(-1) ?? ""));
    }, writtenIds);
    const eventIds = rows.map((row) => row.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    expect(rows.length).toBe(writtenIds.length);
    const delays = rows
      .map((row) => row.renderedAt - Date.parse(row.acceptedAt))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const p95 =
      delays[Math.min(delays.length - 1, Math.ceil(0.95 * delays.length) - 1)] ??
      Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThanOrEqual(500);
  } finally {
    await primary.close();
    await sql`DELETE FROM trader_orders WHERE organization_id = ${orgId}::uuid`;
    await sql`DELETE FROM trader_admin_change_log WHERE organization_id = ${orgId}::uuid`;
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
