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
});
