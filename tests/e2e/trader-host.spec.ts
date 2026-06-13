import { expect, test, type Page } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";

const TRADER_PASSWORD = "password123!";

function primaryBaseUrl(traderBaseUrl: string | undefined): string {
  return traderBaseUrl?.replace("trader.localhost", "127.0.0.1") ?? "http://127.0.0.1:3199";
}

function primaryLandingUrlPattern(traderBaseUrl: string | undefined): RegExp {
  const escaped = primaryBaseUrl(traderBaseUrl).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}/?$`);
}

/** Cross-host middleware/layout redirects abort navigation with ERR_ABORTED in Playwright. */
async function gotoExpectingCrossHostRedirect(
  page: Page,
  path: string,
  expectedUrl: RegExp | string,
): Promise<void> {
  await Promise.all([
    page.waitForURL(expectedUrl),
    page.goto(path).catch((error: Error) => {
      if (!error.message.includes("ERR_ABORTED")) {
        throw error;
      }
    }),
  ]);
}

test.describe("trader host routing (AT-E1 S2)", () => {
  test("renders landing on trader host root when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });

  test("redirects unauthenticated /trader to landing on trader host", async ({ page }) => {
    await page.goto("/trader");
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });

  test("redirects entitled user from trader host root to /trader", async ({
    page,
    baseURL,
    browser,
  }) => {
    const email = `e2e-trader-host-allow-${Date.now()}@example.com`;
    const primaryContext = await browser.newContext({
      baseURL: primaryBaseUrl(baseURL),
    });
    const primaryPage = await primaryContext.newPage();
    await signUpAndOpenDashboard(primaryPage, email);
    await primaryContext.close();

    grantTraderEntitlementByUserEmail(email);

    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");

    await page.goto("/");
    await expect(page).toHaveURL("/trader");
    await expect(page.getByTestId("trader-workspace")).toBeVisible();
  });

  test("redirects user without entitlement from trader host to primary dashboard", async ({
    page,
    baseURL,
    browser,
  }) => {
    const email = `e2e-trader-host-deny-${Date.now()}@example.com`;
    const primaryContext = await browser.newContext({
      baseURL: primaryBaseUrl(baseURL),
    });
    const primaryPage = await primaryContext.newPage();
    await signUpAndOpenDashboard(primaryPage, email);
    await primaryContext.close();

    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL(primaryLandingUrlPattern(baseURL));

    await gotoExpectingCrossHostRedirect(page, "/trader", primaryLandingUrlPattern(baseURL));
    await expect(page.getByTestId("trader-workspace")).not.toBeVisible();
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });

  test("redirects trader host /dashboard to primary landing", async ({ page, baseURL }) => {
    await gotoExpectingCrossHostRedirect(page, "/dashboard", primaryLandingUrlPattern(baseURL));
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });
});
