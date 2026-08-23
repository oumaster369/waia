import { expect, test } from "@playwright/test";

test.describe("public WAIA transparency pages", () => {
  test("keeps the budget page truthful and read-only before publication", async ({ page }) => {
    await page.goto("/budget");

    await expect(page.getByRole("heading", { level: 1, name: "WAIA Budget" })).toBeVisible();
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

  test("renders the allowlisted work-plan surface without an iframe or controls", async ({
    page,
  }) => {
    await page.goto("/work-plan");

    await expect(page.getByRole("heading", { level: 1, name: "WAIA Work Plan" })).toBeVisible();
    await expect(
      page
        .getByTestId("public-work-plan-unavailable")
        .or(page.getByTestId("public-work-plan-projects")),
    ).toBeVisible();
    await expect(page.locator("form, iframe")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
  });
});
