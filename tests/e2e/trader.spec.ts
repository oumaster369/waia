import { expect, test } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";

test.describe("/trader route gate (AT-E1 S1)", () => {
  test("redirects unauthenticated visitors to /", async ({ page }) => {
    await page.goto("/trader");
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });

  test("redirects authenticated user without trader entitlement to /dashboard", async ({
    page,
  }) => {
    const email = `e2e-trader-deny-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    await page.goto("/trader");
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByTestId("dashboard-sidebar")).toBeVisible();
  });

  test("renders trader workspace shell when trader entitlement is present", async ({ page }) => {
    const email = `e2e-trader-allow-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    grantTraderEntitlementByUserEmail(email);

    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expect(page.getByTestId("trader-workspace")).toBeVisible();
    await expect(page.getByTestId("trader-workspace-title")).toHaveText("AI-TRADER");
    await expect(page.getByTestId("trader-placeholder-exchange")).toContainText(
      "No exchange connected",
    );
    await expect(page.getByTestId("trader-placeholder-portfolio")).toContainText(
      "Portfolio coming soon",
    );
    await expect(page.getByTestId("trader-placeholder-strategies")).toContainText(
      "Strategies coming soon",
    );
  });
});
