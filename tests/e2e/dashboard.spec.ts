import { expect, test } from "@playwright/test";

test.describe("/dashboard smoke", () => {
  test("renders sidebar, tabs, Twin selected, dialogue region after sign-up", async ({ page }) => {
    await page.goto("/");
    const email = `e2e-dashboard-${Date.now()}@example.com`;
    await page.getByTestId("landing-auth-identity").fill(email);
    await page.getByTestId("landing-auth-password").fill("password123!");
    await page.getByTestId("landing-auth-submit").click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

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
