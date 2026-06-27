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

  test("renders HTX connect workspace when trader entitlement is present and no exchange connected", async ({
    page,
  }) => {
    const email = `e2e-trader-allow-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    grantTraderEntitlementByUserEmail(email);

    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expect(page.getByTestId("trader-workspace")).toBeVisible();
    await expect(page.getByTestId("trader-workspace-title")).toHaveText("AI-TRADER");
    await expect(page.getByTestId("trader-connect-section")).toBeVisible();
    await expect(page.getByTestId("trader-connect-form")).toBeVisible();
    await expect(page.getByTestId("trader-permission-explainer")).toBeVisible();
    await expect(page.getByTestId("trader-api-key")).toBeVisible();
    await expect(page.getByTestId("trader-api-secret")).toHaveAttribute("type", "password");
    await expect(page.getByTestId("trader-connect-submit")).toBeEnabled();
  });
});
