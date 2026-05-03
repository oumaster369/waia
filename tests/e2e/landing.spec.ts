import { expect, test } from "@playwright/test";

test.describe("WAIA landing page", () => {
  test("renders all five blocks and canonical anchors", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("landing-auth")).toBeVisible();
    await expect(page.getByTestId("landing-context")).toBeVisible();
    await expect(page.getByTestId("landing-modules")).toBeVisible();
    await expect(page.getByTestId("landing-closing")).toBeVisible();

    await expect(page.getByTestId("landing-hero-tagline")).toHaveText(
      "Между тобой. И тобой.",
    );
    await expect(page.getByTestId("landing-context-anchor")).toHaveText(
      "Вы здесь, в пространстве WAIA.",
    );
    await expect(page.getByTestId("landing-closing-anchor")).toHaveText("Всё согласовано.");
  });

  test("exposes all four entry actions in VisitorIdle", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-auth-submit")).toHaveText("Войти");
    await expect(page.getByTestId("landing-auth-divider")).toHaveText("или");
    await expect(page.getByTestId("landing-auth-provider-google")).toBeVisible();
    await expect(page.getByTestId("landing-auth-provider-apple")).toBeVisible();
    await expect(page.getByTestId("landing-auth-provider-telegram")).toBeVisible();
  });

  test("enters AuthFailure with the canonical state attribute on submit", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("landing-auth-identity").fill("e2e@example.com");
    await page.getByTestId("landing-auth-password").fill("secret");
    await page.getByTestId("landing-auth-submit").click();
    const auth = page.getByTestId("landing-auth");
    await expect(auth).toHaveAttribute("data-status", "AuthFailure", { timeout: 5_000 });
    await expect(page.getByTestId("landing-auth-error")).toBeVisible();
    await expect(page.getByTestId("landing-auth-password")).toHaveValue("");
    await expect(page.getByTestId("landing-auth-identity")).toHaveValue("e2e@example.com");
  });

  test("never surfaces an AI-Trader module card per DEE-8 §9.4", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/AI-Trader/i)).toHaveCount(0);
  });
});
