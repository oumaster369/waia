import { expect, test } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";

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
    await expect(page.getByTestId("mode-tab-personality_insights")).toHaveAttribute("data-state", "locked");
    await expect(page.getByTestId("mode-tab-society")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-society")).toHaveAttribute("data-state", "locked");

    await expect(page.getByTestId("dashboard-sidebar-sign-out")).toBeVisible();
  });
});
