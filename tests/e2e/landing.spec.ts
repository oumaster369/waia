import path from "node:path";

import { expect, test } from "@playwright/test";

import { LEGCO_RESEARCH_URL } from "../../lib/landing/homepage-links";

test.describe("WAIA landing page", () => {
  test("renders DEE-605 narrative landmarks and English hero definition", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("landing-hero-definition-text")).toContainText(
      /human-centered AI environment/i,
    );
    await expect(page.getByTestId("landing-auth")).toBeVisible();
    await expect(page.getByTestId("landing-breath")).toBeVisible();
    await expect(page.getByTestId("landing-ai-twin")).toBeVisible();
    await expect(page.getByTestId("landing-living-legacy")).toBeVisible();
    await expect(page.getByTestId("landing-breath-interstitial")).toBeVisible();
    await expect(page.getByTestId("landing-society")).toBeVisible();
    await expect(page.getByTestId("landing-ai-trader")).toBeVisible();
    await expect(page.getByTestId("landing-epistemic")).toBeVisible();
    await expect(page.getByTestId("landing-how-built")).toBeVisible();
    await expect(page.getByTestId("landing-final-cta")).toBeVisible();
  });

  test("hero selects desktop heap composition on wide viewports", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    const currentSrc = await page
      .getByTestId("landing-hero-image")
      .evaluate((el: HTMLImageElement) => el.currentSrc);
    expect(currentSrc).toContain("/brand/heap_comp_1.webp");
  });

  test("hero selects mobile head artwork on narrow viewports", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const currentSrc = await page
      .getByTestId("landing-hero-image")
      .evaluate((el: HTMLImageElement) => el.currentSrc);
    expect(currentSrc).toContain("/brand/head_mobile_1.webp");
  });

  test("keeps pending Breath minimal and exposes public detail links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-breath-pending")).toHaveAttribute(
      "data-publication-status",
      "pending",
    );
    await expect(page.getByTestId("landing-breath-pending")).toContainText(
      /first public financial snapshot has not been published/i,
    );
    await expect(page.getByTestId("landing-breath-facts")).toHaveCount(0);
    await expect(page.getByTestId("landing-breath")).not.toContainText(/DEE-\d+/i);
    await expect(page.getByTestId("landing-breath")).not.toContainText(/Resource transparency/i);
    await expect(page.getByTestId("landing-breath-media")).toHaveCount(0);
    await expect(page.getByTestId("landing-breath-time-radar")).toBeVisible();
    await expect(page.getByTestId("landing-breath-time-radar-link")).toHaveAttribute(
      "href",
      "/patrons",
    );
    await expect(page.getByTestId("landing-breath-budget-link")).toHaveAttribute("href", "/budget");
    await expect(page.getByTestId("landing-breath-patrons-link")).toHaveAttribute(
      "href",
      "/patrons",
    );
    await expect(page.getByTestId("landing-breath-work-plan-link")).toHaveAttribute(
      "href",
      "/work-plan",
    );
    await expect(page.getByTestId("landing-how-built-legco-cta")).toHaveAttribute(
      "href",
      LEGCO_RESEARCH_URL,
    );
    await expect(page.getByTestId("landing-final-cta-register")).toHaveAttribute(
      "href",
      "#register",
    );
    await expect(page.getByTestId("landing-final-cta-breath")).toHaveAttribute(
      "href",
      "#breath-of-waia",
    );
    // Unified gold CTA family on button-like controls; prose links stay text.
    await expect(page.getByTestId("landing-final-cta-register")).toHaveClass(/rounded-xl/);
    await expect(page.getByTestId("landing-final-cta-research")).not.toHaveClass(/rounded-xl/);
  });

  test("moves the Breath time radar counterclockwise and respects reduced motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const sweep = page.getByTestId("landing-breath-radar-sweep");
    await expect(sweep).toHaveAttribute("data-rotation", "counterclockwise");
    const keyframes = await sweep.evaluate((element) => {
      const animation = element.getAnimations()[0];
      const effect = animation?.effect as KeyframeEffect | null;
      return effect?.getKeyframes().map((keyframe) => keyframe.transform) ?? [];
    });
    expect(keyframes.at(-1)).toBe("rotate(-360deg)");
    await expect(page.getByTestId("landing-breath-radar-contact-1")).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedAnimationName = await sweep.evaluate(
      (element) => window.getComputedStyle(element).animationName,
    );
    expect(reducedAnimationName).toBe("none");
  });

  test("desktop places equal Auth and Breath columns directly below the framed hero", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const definition = page.getByTestId("landing-hero-definition");
    const auth = page.getByTestId("landing-auth");
    const breath = page.getByTestId("landing-breath");
    await expect(definition).toBeVisible();
    await expect(auth).toBeVisible();
    await expect(breath).toBeVisible();

    const defBox = await definition.boundingBox();
    const authBox = await auth.boundingBox();
    const breathBox = await breath.boundingBox();
    expect(defBox && authBox && breathBox).toBeTruthy();
    if (!defBox || !authBox || !breathBox) return;

    expect(authBox.y).toBeGreaterThan(defBox.y + defBox.height);
    expect(Math.abs(authBox.y - breathBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(authBox.width - breathBox.width)).toBeLessThanOrEqual(1);
    expect(breathBox.x).toBeGreaterThan(authBox.x + authBox.width);
  });

  test("target viewports keep the readable definition inside the Hero composition", async ({
    page,
  }) => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 722, height: 987 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1728, height: 1117 },
      { width: 1920, height: 1080 },
      { width: 2200, height: 1200 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      const image = page.getByTestId("landing-hero-image");
      const definition = page.getByTestId("landing-hero-definition");
      const definitionText = page.getByTestId("landing-hero-definition-text");
      await expect(image).toBeVisible();
      await expect(definition).toBeVisible();
      await expect(definitionText).toBeVisible();
      const imageBox = await image.boundingBox();
      const defBox = await definition.boundingBox();
      const definitionTextBox = await definitionText.boundingBox();
      expect(
        imageBox && defBox && definitionTextBox,
        `boxes missing at ${viewport.width}`,
      ).toBeTruthy();
      if (!imageBox || !defBox || !definitionTextBox) continue;

      expect(definitionTextBox.y, `definition above image at ${viewport.width}`).toBeGreaterThan(
        imageBox.y,
      );
      expect(
        definitionTextBox.y + definitionTextBox.height,
        `definition below image at ${viewport.width}`,
      ).toBeLessThan(imageBox.y + imageBox.height);

      const bottomAir =
        imageBox.y + imageBox.height - (definitionTextBox.y + definitionTextBox.height);
      const expectedBottomAir =
        viewport.width < 640
          ? { min: 20, max: 80 }
          : viewport.width < 768
            ? { min: 120, max: 220 }
            : { min: 32, max: 100 };
      expect(bottomAir, `definition bottom air at ${viewport.width}`).toBeGreaterThanOrEqual(
        expectedBottomAir.min,
      );
      expect(bottomAir, `definition bottom air at ${viewport.width}`).toBeLessThanOrEqual(
        expectedBottomAir.max,
      );

      const fontSize = await definitionText.evaluate((element) =>
        Number.parseFloat(window.getComputedStyle(element).fontSize),
      );
      expect(fontSize, `definition font size at ${viewport.width}`).toBeGreaterThanOrEqual(18);

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width + 1,
      );
    }
  });

  test("mobile keeps definition visible without auth overlap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const definition = page.getByTestId("landing-hero-definition");
    const auth = page.getByTestId("landing-auth");
    const breath = page.getByTestId("landing-breath");
    const defBox = await definition.boundingBox();
    const authBox = await auth.boundingBox();
    const breathBox = await breath.boundingBox();
    expect(defBox).toBeTruthy();
    expect(authBox).toBeTruthy();
    expect(breathBox).toBeTruthy();
    if (!defBox || !authBox || !breathBox) return;
    expect(authBox.y).toBeGreaterThan(defBox.y + defBox.height);
    expect(breathBox.y).toBeGreaterThan(authBox.y + authBox.height);
    expect(Math.abs(authBox.width - breathBox.width)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390 + 1,
    );
  });

  test("renders qualitative readiness without fabricated percentages", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-ai-twin-readiness-scale")).toBeVisible();
    await expect(page.getByTestId("landing-ai-twin-progression")).toContainText(
      /Mirror → Model → Observer → Co-Researcher/,
    );
    await expect(page.getByTestId("landing-ai-trader-restraint")).toContainText(
      /not trading is the correct outcome/i,
    );
    await expect(page.getByTestId("landing-business-3p-provision")).toContainText(
      /Market research/i,
    );
    await expect(page.getByTestId("landing-ai-marketplace-meaning")).toContainText(/need exists/i);
    const bodyText = await page.locator("main").innerText();
    expect(bodyText).not.toMatch(/\d+%/);
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

  test("surfaces AI-TRADER on the public homepage per DEE-605", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-ai-trader")).toBeVisible();
    await expect(page.getByTestId("landing-ai-trader-boundary")).toContainText(
      /No promise of profit/i,
    );
    await expect(page.getByTestId("landing-ai-trader-restraint")).toContainText(
      /not trading is the correct outcome/i,
    );
  });

  test("remaining B1 diagrams and final-art-ready slots have no empty removed slots", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await expect(page.getByTestId("landing-breath-media")).toHaveCount(0);
    await expect(page.getByTestId("landing-society-media")).toHaveAttribute(
      "data-media-slot",
      "diagram",
    );
    await expect(page.getByTestId("landing-ai-trader-media")).toContainText(/NO TRADE/);
    await expect(page.getByTestId("landing-how-built-media")).toContainText(/LEGCO/);
    await expect(page.getByTestId("landing-ai-marketplace-diagram")).toBeVisible();
    await expect(page.getByTestId("landing-ai-twin-media")).toHaveAttribute(
      "data-media-slot",
      "final-art",
    );
    await expect(page.getByTestId("landing-ai-twin-media-image")).toHaveAttribute(
      "src",
      /\/landing\/visuals\/ai-twin\.webp/,
    );
    await expect(page.getByTestId("landing-living-legacy-media-image")).toHaveAttribute(
      "src",
      /\/landing\/visuals\/living-legacy\.webp/,
    );
    await expect(page.getByTestId("landing-ai-twin-media-image")).toHaveAttribute(
      "alt",
      /co-researcher/i,
    );
    await expect(page.getByTestId("landing-living-legacy-media-image")).toHaveAttribute(
      "alt",
      /continuity of meaning/i,
    );
    await expect(page.getByTestId("landing-human-bridge-media")).toHaveCount(0);
    await expect(page.getByTestId("landing-business-3p-media")).toHaveCount(0);
    await expect(page.getByTestId("landing-business-3p-pillars")).toBeVisible();
    await expect(page.locator('[data-media-slot="final-art-ready"]')).toHaveCount(0);

    // Society: text first in DOM reading order on mobile; visual-left on desktop via CSS order.
    const societyTitleBox = await page.getByTestId("landing-society-title").boundingBox();
    const societyMediaBox = await page.getByTestId("landing-society-media").boundingBox();
    expect(societyTitleBox).toBeTruthy();
    expect(societyMediaBox).toBeTruthy();
    if (societyTitleBox && societyMediaBox) {
      expect(societyMediaBox.x).toBeLessThan(societyTitleBox.x);
    }

    // Legacy desktop visual-left; Twin desktop visual-right.
    const twinBox = await page.getByTestId("landing-ai-twin-media").boundingBox();
    const twinTitleBox = await page.getByTestId("landing-ai-twin-title").boundingBox();
    const legacyBox = await page.getByTestId("landing-living-legacy-media").boundingBox();
    const legacyTitleBox = await page.getByTestId("landing-living-legacy-title").boundingBox();
    expect(twinBox && twinTitleBox && legacyBox && legacyTitleBox).toBeTruthy();
    if (twinBox && twinTitleBox && legacyBox && legacyTitleBox) {
      expect(twinBox.x).toBeGreaterThan(twinTitleBox.x);
      expect(legacyBox.x).toBeLessThan(legacyTitleBox.x);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280 + 1,
    );
  });

  test("mobile public visuals remain present without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("landing-breath-media")).toHaveCount(0);
    await expect(page.getByTestId("landing-ai-marketplace-diagram")).toBeVisible();
    await expect(page.getByTestId("landing-ai-trader-media")).toContainText(/NO TRADE/);
    await expect(page.getByTestId("landing-ai-twin-media-image")).toBeVisible();
    await expect(page.getByTestId("landing-living-legacy-media-image")).toBeVisible();
    // Mobile reading order: society title above media (order-1 text).
    const societyTitleBox = await page.getByTestId("landing-society-title").boundingBox();
    const societyMediaBox = await page.getByTestId("landing-society-media").boundingBox();
    expect(societyTitleBox).toBeTruthy();
    expect(societyMediaBox).toBeTruthy();
    if (societyTitleBox && societyMediaBox) {
      expect(societyTitleBox.y).toBeLessThan(societyMediaBox.y);
    }
    const twinTitleBox = await page.getByTestId("landing-ai-twin-title").boundingBox();
    const twinMediaBox = await page.getByTestId("landing-ai-twin-media").boundingBox();
    const legacyTitleBox = await page.getByTestId("landing-living-legacy-title").boundingBox();
    const legacyMediaBox = await page.getByTestId("landing-living-legacy-media").boundingBox();
    expect(twinTitleBox && twinMediaBox && legacyTitleBox && legacyMediaBox).toBeTruthy();
    if (twinTitleBox && twinMediaBox && legacyTitleBox && legacyMediaBox) {
      expect(twinTitleBox.y).toBeLessThan(twinMediaBox.y);
      expect(legacyTitleBox.y).toBeLessThan(legacyMediaBox.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390 + 1,
    );
  });

  test("surfaces oauth_error query as inline auth message", async ({ page }) => {
    await page.goto("/?oauth_error=OAUTH_DENIED");
    await expect(page.getByTestId("landing-auth-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("landing-auth-error")).toContainText(/cancelled|isn/i);
    await expect(page).not.toHaveURL(/\?oauth_error=/, { timeout: 15_000 });
  });
});
