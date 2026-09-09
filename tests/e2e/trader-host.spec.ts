import { expect, test, type Page } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const STATIC_SHELL_RUN_ID = "e2e-static-shell";
const FOREIGN_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000999";

async function expectProtectedObserverApisFailClosed(page: Page, expectedStatus: 401 | 403) {
  const requestFromPage = (path: string) =>
    page.evaluate(async (requestPath) => {
      const response = await fetch(requestPath, { credentials: "include" });
      return { status: response.status, body: await response.text() };
    }, path);
  const tenantResponse = await requestFromPage(
    `/api/trader/research/stream?campaign_run_id=${STATIC_SHELL_RUN_ID}`,
  );
  expect(tenantResponse.status).toBe(expectedStatus);
  expect(tenantResponse.body).not.toMatch(
    /"(?:organizationId|accountId|balances|positions|trades)"\s*:/i,
  );

  const adminResponse = await requestFromPage(
    `/api/trader/admin/fhv-operations/status?organization_id=${FOREIGN_ORGANIZATION_ID}` +
      `&campaign_run_id=${STATIC_SHELL_RUN_ID}`,
  );
  expect(adminResponse.status).toBe(expectedStatus);
  expect(adminResponse.body).not.toMatch(
    /"(?:organizationId|accountId|balances|positions|trades)"\s*:/i,
  );
}

async function expectStaticShellContainsNoProtectedData(page: Page) {
  await expect(page.getByTestId("trader-workspace")).toBeVisible();
  await expect(page.getByTestId("trader-credential-account-id")).toHaveCount(0);
  await expect(page.getByTestId("trader-balance-list")).toHaveCount(0);
  await expect(page.getByTestId("trader-position-list")).toHaveCount(0);
  await expect(page.getByTestId("trader-trade-list")).toHaveCount(0);
}

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
  test("offers sign-out in exchange and historical workspaces and retains failures", async ({ page }) => {
    for (const path of ["/trader", "/trader?campaign_run_id=e2e-sign-out"]) {
      await page.goto(path);
      const signOut = page.getByRole("button", { name: "Sign out", exact: true });
      await expect(signOut).toBeVisible();
      await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 503, json: { ok: false } }));
      await signOut.click();
      await expect(page.getByRole("alert").filter({ hasText: "Sign out could not be confirmed" })).toBeVisible();
      await expect(signOut).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe("/trader");
      await page.unroute("**/api/auth/sign-out");
      await signOut.click();
      await expect(page).toHaveURL("/");
    }
  });

  test("signs out an entitled SQLite session and denies subsequent protected reads", async ({ page, baseURL, browser }) => {
    const email = `e2e-trader-sign-out-${Date.now()}@example.com`;
    const primaryContext = await browser.newContext({ baseURL: primaryBaseUrl(baseURL) });
    try {
      await signUpAndOpenDashboard(await primaryContext.newPage(), email);
    } finally { await primaryContext.close(); }
    grantTraderEntitlementByUserEmail(email);
    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expectProtectedObserverApisFailClosed(page, 401);
    await page.goto("/trader");
    await expectStaticShellContainsNoProtectedData(page);
    await expectProtectedObserverApisFailClosed(page, 401);
    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByTestId("trader-connect-form")).toBeVisible();
    const restoredAccess = await page.request.get("/api/trader/exchange-credentials");
    expect(restoredAccess.status()).toBe(200);
  });

  test("signs out from the admin console and removes protected access", async ({ page, baseURL, browser }) => {
    const email = `e2e-trader-admin-sign-out-${Date.now()}@example.com`;
    const primaryContext = await browser.newContext({ baseURL: primaryBaseUrl(baseURL) });
    try { await signUpAndOpenDashboard(await primaryContext.newPage(), email); }
    finally { await primaryContext.close(); }
    grantTraderEntitlementByUserEmail(email);
    grantPlatformAdminByUserEmail(email);
    await signInOnLanding(page, email, TRADER_PASSWORD);
    await page.waitForURL("**/trader");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Operator admin" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expectProtectedObserverApisFailClosed(page, 401);
  });

  test("renders landing on trader host root when unauthenticated", async ({ page, baseURL }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("trader-landing")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("See clearly");
    await expect(page).toHaveTitle(/AI-TRADER/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`^${baseURL?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`),
    );
    await expect(page.getByTestId("landing-auth")).toBeVisible();
    await expect(page.getByTestId("landing-auth")).toHaveAttribute("data-mode", "signIn");
    await expect(page.getByTestId("landing-auth-full-name")).toHaveCount(0);
    await expect(page.getByTestId("landing-auth-submit")).toHaveText("Sign in");
  });

  test("renders an unauthenticated static shell while protected APIs remain fail-closed", async ({
    page,
  }) => {
    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expectStaticShellContainsNoProtectedData(page);
    await expectProtectedObserverApisFailClosed(page, 401);
  });

  test("keeps the sign-in hero usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("landing-auth-identity")).toBeVisible();
    await expect(page.getByTestId("landing-auth-password")).toBeVisible();
    await expect(page.getByTestId("landing-auth-submit")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });

  test("keeps Trader registration and login free of Twin wording on desktop and mobile", async ({ page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const auth = page.getByTestId("landing-auth");
      await expect(auth).not.toContainText(/twin/i);
      await page.getByTestId("landing-auth-mode-create").click();
      await expect(auth.getByRole("heading")).toHaveText("Register for AI-TRADER");
      await expect(auth).not.toContainText(/twin|partner preview/i);
      await expect(page.getByTestId("landing-auth-full-name")).toBeVisible();
      await expect(page.getByTestId("landing-auth-submit")).toHaveText("Register");
      await page.getByTestId("landing-auth-submit").click();
      await expect(page.getByTestId("landing-auth-error")).toHaveText("Enter your name.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await auth.screenshot({ path: `test-results/trader-registration-${width}.png` });
      await page.getByTestId("landing-auth-mode-sign-in").click();
      await expect(auth.getByRole("heading")).toHaveText("Sign in to AI-TRADER");
      await expect(page.getByTestId("landing-auth-full-name")).toHaveCount(0);
      await expect(auth).not.toContainText(/twin/i);
    }
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

  test("keeps a non-entitled user in a data-empty shell while APIs reject access", async ({
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

    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expectStaticShellContainsNoProtectedData(page);
    await expectProtectedObserverApisFailClosed(page, 403);
  });

  test("redirects trader host /dashboard to primary landing", async ({ page, baseURL }) => {
    await gotoExpectingCrossHostRedirect(page, "/dashboard", primaryLandingUrlPattern(baseURL));
    await expect(page.getByTestId("trader-landing")).not.toBeVisible();
    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });
});
