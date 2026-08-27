import { expect, test } from "@playwright/test";

test.describe("public WAIA transparency pages", () => {
  test("keeps the budget page truthful and read-only before publication", async ({ page }) => {
    await page.goto("/budget");

    await expect(
      page.getByRole("heading", { level: 1, name: "Transactions & budget" }),
    ).toBeVisible();
    await expect(page.getByTestId("public-budget-pending")).toContainText(
      /first complete public financial record is still awaiting publication/i,
    );
    await expect(page.getByRole("link", { name: /Breath of WAIA/i })).toHaveAttribute(
      "href",
      "/#breath-of-waia",
    );
    await expect(page.locator("form, iframe")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
  });

  test("renders the allowlisted work plan and public team application without an iframe", async ({
    page,
  }) => {
    await page.goto("/work-plan");

    await expect(page.getByRole("heading", { level: 1, name: "WAIA Work Plan" })).toBeVisible();
    await expect(
      page
        .getByTestId("public-work-plan-unavailable")
        .or(page.getByTestId("public-work-plan-projects")),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Join the work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send application" })).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("keeps the Patrons page truthful, read-only, and responsive", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/patrons");

    await expect(page.getByRole("heading", { level: 1, name: "Patrons" })).toBeVisible();
    await expect(page.getByText(/Thank you to everyone helping WAIA breathe\./)).toBeVisible();
    await expect(
      page
        .getByTestId("public-patrons-pending")
        .or(page.getByTestId("public-patrons-unavailable"))
        .or(page.getByTestId("public-patrons-record")),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Breath of WAIA/i })).toHaveAttribute(
      "href",
      "/#breath-of-waia",
    );
    await expect(page.locator("form, iframe")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  });
});
