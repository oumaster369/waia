import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const SCREENS = ["/admin", "/admin/orders", "/admin/errors", "/admin/system", "/admin/research"];

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
