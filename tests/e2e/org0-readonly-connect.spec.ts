import { expect, test, type Browser, type Page } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const port = process.env.PLAYWRIGHT_PORT ?? "3199";
const traderBaseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`);
traderBaseUrl.hostname = "trader.localhost";
test.use({ baseURL: traderBaseUrl.origin });

async function signInAdmin(page: Page, browser: Browser, baseURL: string | undefined) {
  const email = `admin-console-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1"),
  });
  try {
    await signUpAndOpenDashboard(await primary.newPage(), email);
  } finally {
    await primary.close();
  }
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  await signInOnLanding(page, email, TRADER_PASSWORD);
  await page.waitForURL("**/trader");
}

function watchForOrg0CredentialRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/trader/admin/org0-readonly-connect") {
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return requests;
}

test("admin navigation keeps Accounts and removes the Org0 connection step", async ({ page, baseURL, browser }) => {
  await signInAdmin(page, browser, baseURL);
  const credentialRequests = watchForOrg0CredentialRequests(page);

  await page.goto("/admin");
  const navigation = page.getByRole("navigation", { name: "AI-TRADER admin console" }).first();
  await expect(navigation.getByRole("link", { name: "Accounts" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: /Подключение Org0/ })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: /Org0 connection|Connect.*Org0/i })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/\/admin\/accounts(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Access Key|Secret Key/i })).toHaveCount(0);
  expect(credentialRequests).toEqual([]);
});

test("the legacy Org0 URL redirects to Accounts without loading a credential form or endpoint", async ({
  page,
  baseURL,
  browser,
}) => {
  await signInAdmin(page, browser, baseURL);
  const credentialRequests = watchForOrg0CredentialRequests(page);

  await page.goto("/admin/org0-connect");
  await expect(page).toHaveURL(/\/admin\/accounts(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Подключение HTX к Org0/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Connect HTX to Org0|Org0 connection/i })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /Access Key|Secret Key/i })).toHaveCount(0);
  expect(credentialRequests).toEqual([]);
});
