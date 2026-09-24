import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const SCREENS = ["/admin", "/admin/orders", "/admin/errors", "/admin/system", "/admin/research"];

test("invoice confirmations belong to the selected invoice", async ({ page, baseURL, browser }) => {
  const email = `console-confirm-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1"),
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
  } finally {
    await primary.close();
  }
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  const invoices = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ].map((id) => ({
    id,
    revision: id,
    organizationId: "33333333-3333-4333-8333-333333333333",
    performanceFee: "10",
    currency: "USDT",
    display: { status: "Черновик", payment: null },
  }));
  await page.route("**/api/trader/admin/console/invoices", (route) =>
    route.fulfill({ json: { data: { items: invoices } } }),
  );
  await page.route("**/api/trader/admin/console/disputes", (route) =>
    route.fulfill({ json: { data: { items: [] } } }),
  );
  let commands = 0;
  page.on("request", (request) => {
    if (request.url().includes("/commands") && request.method() === "POST") commands++;
  });
  await signInOnLanding(page, email, TRADER_PASSWORD);
  await page.waitForURL("**/trader");
  await page.goto("/admin/clients?tab=invoices");
  await page.getByRole("button", { name: new RegExp(invoices[0]!.id) }).click();
  const approve = page.getByRole("button", { name: "Подтвердить выпуск" });
  await expect(approve).toBeDisabled();
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await expect(approve).toBeEnabled();
  await page.getByRole("button", { name: new RegExp(invoices[1]!.id) }).click();
  await expect(approve).toBeDisabled();
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  expect(commands).toBe(0);
});

test("admin console main screens have no serious accessibility violations", async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = `console-a11y-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1") ?? "http://127.0.0.1:3199",
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
  } finally {
    await primary.close();
  }
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  await signInOnLanding(page, email, TRADER_PASSWORD);
  await page.waitForURL("**/trader");
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(
      page.getByRole("navigation", { name: "Консоль администратора AI-TRADER" }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious, path).toEqual([]);
  }
});
