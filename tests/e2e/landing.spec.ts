import path from "node:path";

import { expect, test } from "@playwright/test";

test.describe("WAIA landing page", () => {
  test("renders all five blocks and canonical anchors", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("landing-auth")).toBeVisible();
    await expect(page.getByTestId("landing-context")).toBeVisible();
    await expect(page.getByTestId("landing-modules")).toBeVisible();
    await expect(page.getByTestId("landing-closing")).toBeVisible();

    await expect(page.getByTestId("landing-context-anchor")).toHaveText("You're in the WAIA space.");
    await expect(page.getByTestId("landing-closing-anchor")).toHaveText("Stay aligned.");
  });

  test("hero selects desktop heap composition on wide viewports", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    const currentSrc = await page.getByTestId("landing-hero-image").evaluate((el: HTMLImageElement) => el.currentSrc);
    expect(currentSrc).toContain("/brand/heap_comp_1.webp");
  });

  test("hero selects mobile head artwork on narrow viewports", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const currentSrc = await page.getByTestId("landing-hero-image").evaluate((el: HTMLImageElement) => el.currentSrc);
    expect(currentSrc).toContain("/brand/head_mobile_1.webp");
  });

  test("shows Create Twin by default and OAuth availability settles", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-auth-submit")).toHaveText("Create your Twin");
    await expect(page.getByTestId("landing-auth-full-name")).toBeVisible();

    const divider = page.getByTestId("landing-auth-divider");
    const oauthUnavailable = page.getByTestId("landing-auth-oauth-unavailable");
    const oauthFetchErr = page.getByTestId("landing-auth-oauth-availability-error");

    await expect(divider.or(oauthUnavailable).or(oauthFetchErr)).toBeVisible({ timeout: 15_000 });

    if (await divider.isVisible()) {
      await expect(divider).toHaveText("Or continue with");
      await expect(page.getByTestId("landing-auth-provider-google")).toBeVisible();
      await expect(page.getByTestId("landing-auth-provider-apple")).toBeVisible();
      await expect(page.getByTestId("landing-auth-provider-telegram")).toBeVisible();
    }

    await expect(page.getByTestId("landing-auth-mode-sign-in")).toBeVisible();
  });

  test("captures landing hero screenshot for visual comparison with brand reference", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const hero = page.getByTestId("landing-hero");
    await expect(hero).toBeVisible();
    const outPath = path.join(testInfo.outputDir, "landing-hero-desktop.png");
    await hero.screenshot({ path: outPath });
  });

  test("captures mobile landing hero screenshot", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const hero = page.getByTestId("landing-hero");
    await expect(hero).toBeVisible();
    const outPath = path.join(testInfo.outputDir, "landing-hero-mobile.png");
    await hero.screenshot({ path: outPath });
  });

  test("enters AuthFailure on wrong password for an existing account in Sign-in mode", async ({
    page,
  }) => {
    const email = `e2e-failure-${Date.now()}@example.com`;
    const password = "correctpass123";

    await page.goto("/");
    await page.getByTestId("landing-auth-full-name").fill("Landing E2E User");
    await page.getByTestId("landing-auth-identity").fill(email);
    await page.getByTestId("landing-auth-password").fill(password);
    await page.getByTestId("landing-auth-submit").click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await page.getByTestId("dashboard-sidebar-sign-out").click();
    await page.waitForURL("**/", { timeout: 15_000 });

    await page.getByTestId("landing-auth-mode-sign-in").click();
    await expect(page.getByTestId("landing-auth-submit")).toHaveText("Sign in");

    await page.getByTestId("landing-auth-identity").fill(email);
    await page.getByTestId("landing-auth-password").fill("wrong-password-value");
    await page.getByTestId("landing-auth-submit").click();
    const auth = page.getByTestId("landing-auth");
    await expect(auth).toHaveAttribute("data-status", "AuthFailure", { timeout: 15_000 });
    await expect(page.getByTestId("landing-auth-error")).toBeVisible();
    await expect(page.getByTestId("landing-auth-password")).toHaveValue("");
    await expect(page.getByTestId("landing-auth-identity")).toHaveValue(email);
  });

  test("never surfaces an AI-Trader module card per DEE-8 §9.4", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/AI-Trader/i)).toHaveCount(0);
  });

  test("surfaces oauth_error query as inline auth message", async ({ page }) => {
    await page.goto("/?oauth_error=OAUTH_DENIED");
    await expect(page.getByTestId("landing-auth-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("landing-auth-error")).toContainText(/cancelled|isn/i);
    await expect(page).not.toHaveURL(/\?oauth_error=/, { timeout: 15_000 });
  });
});
