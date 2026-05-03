import { expect, test } from "@playwright/test";

test.describe("/dashboard smoke", () => {
  test("renders sidebar, tabs, Twin selected, dialogue region", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-sidebar")).toBeVisible();
    await expect(page.getByTestId("dashboard-top-block")).toBeVisible();
    await expect(page.getByTestId("dashboard-mode-tabs")).toBeVisible();
    await expect(page.getByTestId("dashboard-dialogue-area")).toBeVisible();

    await expect(page.getByTestId("mode-tab-twin")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("mode-tab-diary")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-diary")).toHaveAttribute("data-state", "locked");
    await expect(page.getByTestId("mode-tab-society")).toBeDisabled();
    await expect(page.getByTestId("mode-tab-society")).toHaveAttribute("data-state", "locked");

    await expect(page.getByTestId("dashboard-sidebar-sign-out")).toHaveAttribute("href", "/");
  });
});
