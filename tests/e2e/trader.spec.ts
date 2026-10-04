import { expect, test, type Page } from "@playwright/test";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";

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

test.describe("/trader static shell boundary (AT-E1 S1)", () => {
  test("renders an unauthenticated static shell while protected APIs remain fail-closed", async ({
    page,
  }) => {
    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expectStaticShellContainsNoProtectedData(page);
    await expectProtectedObserverApisFailClosed(page, 401);
  });

  test("renders a data-empty shell for a user without entitlement while APIs reject access", async ({
    page,
  }) => {
    const email = `e2e-trader-deny-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);

    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expectStaticShellContainsNoProtectedData(page);
    await expectProtectedObserverApisFailClosed(page, 403);
  });

  test("renders HTX connect workspace when trader entitlement is present and no exchange connected", async ({
    page,
  }) => {
    const email = `e2e-trader-allow-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    grantTraderEntitlementByUserEmail(email);

    await page.goto("/trader");
    await expect(page).toHaveURL("/trader");
    await expect(page.getByTestId("trader-workspace")).toBeVisible();
    await expect(page.getByTestId("trader-workspace-title")).toHaveText("AI-TRADER");
    await expect(page.getByTestId("trader-connect-section")).toBeVisible();
    await expect(page.getByTestId("trader-connect-form")).toBeVisible();
    await expect(page.getByTestId("trader-permission-explainer")).toBeVisible();
    await expect(page.getByTestId("trader-api-key")).toBeVisible();
    await expect(page.getByTestId("trader-api-secret")).toHaveAttribute("type", "password");
    await expect(page.getByTestId("trader-connect-submit")).toBeEnabled();
    await expect(
      page.getByText("This workspace cannot enable live trading or change capital authority."),
    ).toBeVisible();
  });

  test("lets an entitled user choose among accounts and inspect replacement/revoke confirmations", async ({
    page,
  }, testInfo) => {
    const email = `e2e-trader-lifecycle-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    grantTraderEntitlementByUserEmail(email);
    const fixtureCredential = (id: string, exchangeAccountId: string) => ({
      id,
      venue: "htx",
      exchangeAccountId,
      apiKeyMasked: "fixture…key",
      status: "active",
      permissionMetadata: null,
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
      revokedAt: null,
    });
    await page.route("**/api/trader/exchange-credentials", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ credentials: [fixtureCredential("fixture-a", "account-a"), fixtureCredential("fixture-b", "account-b")] }),
      }),
    );
    await page.route("**/api/trader/account-observation/**", (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trader");
    const selector = page.getByTestId("trader-account-select");
    await expect(selector).toHaveValue("");
    await selector.selectOption("account-a");
    await expect(selector).toHaveValue("account-a");
    await page.getByTestId("trader-replace-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("trader-connect-section")).toContainText("Это заменит подключение в WAIA");
    await page.getByRole("button", { name: "Отмена" }).focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("trader-disconnect-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Подтвердить отключение" })).toContainText(
      "Сам ключ HTX и внешний исполнитель не изменятся",
    );
    await expect(page.getByTestId("trader-disconnect-confirm")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("account-lifecycle-mobile.png") });
    await page.getByRole("button", { name: "Отмена" }).focus();
    await page.keyboard.press("Enter");
  });
});
