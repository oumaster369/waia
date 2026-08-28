import { expect, test } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";

test.describe("/dashboard smoke", () => {
  test("redirects unauthenticated visitors to /", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });

  test("renders sidebar, tabs, Twin selected, dialogue region after sign-up", async ({ page }) => {
    const email = `e2e-dashboard-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    await expect(page.getByTestId("dashboard-sidebar")).toBeVisible();
    await expect(page.getByTestId("dashboard-top-block")).toBeVisible();
    await expect(page.getByTestId("dashboard-mode-tabs")).toBeVisible();
    await expect(page.getByTestId("dashboard-dialogue-area")).toBeVisible();

    await expect(page.getByTestId("mode-tab-twin")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("mode-tab-diary")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-diary")).toHaveAttribute("data-state", "locked");
    await expect(page.getByTestId("mode-tab-predictions")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-predictions")).toHaveAttribute("data-state", "locked");
    await expect(page.getByTestId("mode-tab-personality_insights")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-personality_insights")).toHaveAttribute(
      "data-state",
      "locked",
    );
    await expect(page.getByTestId("mode-tab-society")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-society")).toHaveAttribute("data-state", "locked");

    await expect(page.getByTestId("dashboard-sidebar-sign-out")).toBeVisible();
  });

  test("hides AI-TRADER sidebar entry for users without trader entitlement", async ({ page }) => {
    const email = `e2e-dashboard-no-trader-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    await expect(page.getByTestId("dashboard-sidebar-trader-link")).toHaveCount(0);
  });

  test("opens the protected Breath of WAIA workspace from the gold sidebar entry", async ({
    page,
  }) => {
    const email = `e2e-dashboard-breath-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    const breathLink = page.getByTestId("dashboard-sidebar-breath-link");
    await expect(breathLink).toBeVisible();
    await expect(breathLink).toHaveText("BREATH OF WAIA");
    await breathLink.click();

    await expect(page).toHaveURL(/\/dashboard\/breath$/);
    await expect(page.getByTestId("dashboard-breath-workspace")).toBeVisible();
    await expect(page.getByTestId("dashboard-breath-anonymous")).toBeVisible();
    await expect(page.getByTestId("dashboard-breath-anonymous-address")).toHaveText(
      "TE1BrKebw9AAYGUpztgn7xG9hMujTePkzD",
    );
    await expect(page.getByTestId("dashboard-breath-named")).toBeVisible();
    await expect(page.getByTestId("contribution-intent-form")).toBeVisible();
    await expect(page.getByLabel(/Contribution amount.*USDT/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare exact payment" })).toBeVisible();
    await expect(page.getByTestId("dashboard-breath-history")).toBeVisible();
  });

  test("shows AI-TRADER sidebar entry with trader host href when entitled", async ({ page }) => {
    const email = `e2e-dashboard-trader-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    await expect(page.getByTestId("dashboard-sidebar-trader-link")).toHaveCount(0);

    grantTraderEntitlementByUserEmail(email);
    await page.reload();

    const traderLink = page.getByTestId("dashboard-sidebar-trader-link");
    await expect(traderLink).toBeVisible();
    await expect(traderLink).toHaveText("AI-TRADER");
    const href = await traderLink.getAttribute("href");
    expect(href).toContain("trader.localhost");
    expect(href).toMatch(/\/trader$/);
  });
});
