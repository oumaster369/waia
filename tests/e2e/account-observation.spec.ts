import { expect, test, type Page } from "@playwright/test";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const binding = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "account-a",
  credentialRevision: "1",
  configurationRevision: "1",
};

// Browser transport fixtures only. This does not establish backend authorization,
// a running collector, PostgreSQL parity or real HTX evidence.
test("mounted Admin and tenant update the same observation automatically and clear revoked access", async ({
  page,
  context,
}) => {
  const email = `e2e-account-observation-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  let version = 1;
  let denied = false;
  const started = Date.now();
  const observation = () => {
    const at = started + version;
    const empty = {
      status: "COMPLETE",
      values: [],
      sourceAsOfMs: at,
      readStartedAtMs: at,
      readCompletedAtMs: at,
      error: null,
    };
    return {
      schemaVersion: "account-observation/v1",
      binding,
      observationId:
        version === 1
          ? "33333333-3333-4333-8333-333333333333"
          : "44444444-4444-4444-8444-444444444444",
      collectionStartedAtMs: at,
      collectionCompletedAtMs: at,
      status: "COMPLETE",
      balances: empty,
      openOrders: empty,
      holdings: [],
      trades: [{ symbol: "BTCUSDT", component: empty }],
    };
  };
  const wire = async (target: Page, admin: boolean) => {
    await target.route(`**/api/trader/${admin ? "admin/" : ""}account-observation**`, (route) => {
      const isBinding = new URL(route.request().url()).pathname.endsWith("/binding");
      return route.fulfill(
        denied
          ? { status: 403, body: "" }
          : {
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(isBinding ? binding : observation()),
            },
      );
    });
  };
  await wire(page, false);
  for (const path of ["balance-snapshots", "position-snapshots", "trade-history-snapshots"]) {
    await page.route(`**/api/trader/${path}?**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [] }),
      }),
    );
  }
  await page.route("**/api/trader/exchange-credentials", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        credentials: [
          {
            id: binding.credentialId,
            venue: "htx",
            exchangeAccountId: binding.exchangeAccountId,
            apiKeyMasked: null,
            status: "active",
            permissionMetadata: null,
            createdAt: new Date(started).toISOString(),
            updatedAt: new Date(started).toISOString(),
            revokedAt: null,
          },
        ],
      }),
    }),
  );
  await page.goto("/trader");
  const tenantPanel = page.getByRole("region", { name: "Account observation", exact: true });
  await expect(tenantPanel.getByText(observation().observationId)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Manually collected diagnostic snapshots" }),
  ).toBeVisible();
  await expect(tenantPanel.getByRole("button")).toHaveCount(0);

  const admin = await context.newPage();
  await wire(admin, true);
  await admin.route("**/api/trader/admin/organizations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        organizations: [
          { id: binding.organizationId, name: "Test organization", kind: "personal" },
        ],
      }),
    }),
  );
  await admin.goto(
    `/admin/account-observation?organization_id=${binding.organizationId}&credential_id=${binding.credentialId}&exchange_account_id=${binding.exchangeAccountId}`,
  );
  const adminPanel = admin.getByRole("region", { name: "Account observation", exact: true });
  await expect(adminPanel.getByText(observation().observationId)).toBeVisible();
  await expect(adminPanel.getByRole("button")).toHaveCount(0);

  version = 2;
  await expect(tenantPanel.getByText(observation().observationId)).toBeVisible({ timeout: 12_000 });
  await expect(adminPanel.getByText(observation().observationId)).toBeVisible({ timeout: 12_000 });
  denied = true;
  await expect(tenantPanel.getByText("Access revoked; account data cleared.")).toBeVisible({
    timeout: 12_000,
  });
  await expect(adminPanel.getByText("Access revoked; account data cleared.")).toBeVisible({
    timeout: 12_000,
  });
  await expect(tenantPanel.getByText(observation().observationId)).toHaveCount(0);
  await expect(adminPanel.getByText(observation().observationId)).toHaveCount(0);
  await admin.close();
});

test("account observation admin page does not expose the form anonymously", async ({ page }) => {
  await page.goto("/admin/account-observation");
  await expect(page.getByRole("heading", { name: "Account observation operations" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Credential record ID (not an API key)")).toHaveCount(0);
});

test("historical workspace never mounts exchange account observation", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/trader\/(?:exchange-credentials|account-observation)/.test(request.url()))
      calls.push(request.url());
  });
  await page.goto("/trader?campaign_run_id=e2e-observation-isolation");
  await expect(page.getByText("Account identity required", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account observation", exact: true })).toHaveCount(
    0,
  );
  expect(calls).toEqual([]);
});
