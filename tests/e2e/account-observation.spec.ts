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
  test.setTimeout(90_000);
  const email = `e2e-account-observation-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  let version = 1;
  let denied = false;
  let streamFailed = false;
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
    const derivativeRow = (accountCode: string, collateralAsset: string,
      marginMode: "isolated" | "cross" | null, marginBalance: string,
      withdrawAvailable: string | null = null, marginAvailable: string | null = "0") => ({
      accountCode, collateralAsset, marginMode,
      marginBalance, marginAvailable, withdrawAvailable, marginPosition: null, marginFrozen: "0",
      marginStatic: null, realizedPnl: null, unrealizedPnl: "0", riskRate: null,
      liquidationPrice: null, leverage: null,
    });
    const families = [
      ["usdt_isolated_perpetual", [derivativeRow("BTC-USDT", "USDT", "isolated", "100.25")]],
      ["usdt_cross_shared", [derivativeRow("USDT", "USDT", "cross", "200.50", "180.25", null)]],
      ["coin_perpetual", [derivativeRow("BTC-USD", "BTC", null, "0.003")]],
      ["coin_delivery_futures", [derivativeRow("BTC", "BTC", null, "0.004")]],
    ] as const;
    const position = (symbol: string, contractCode: string, contractType: string | null, marginAsset: string,
      direction: "buy" | "sell", unrealizedPnl: string) => ({
      symbol, contractCode, contractType, direction,
      volume: "0.000000000000000013", available: "0.000000000000000011",
      frozen: "0.000000000000000002", costOpen: "100.000000000000000001",
      costHold: "99.000000000000000009", unrealizedPnl,
      profitRate: "-0.000000000000000003", positionMargin: "3.125000000000000001",
      marginAsset, leverage: "5", lastPrice: "101.000000000000000003",
      liquidationPrice: null,
    });
    const positionRows = [
      ["usdt_isolated_perpetual", [position("BTC", "BTC-USDT", null, "USDT", "buy", "-0.000000000000000007")]],
      ["usdt_cross_shared", [position("BTC", "BTC-USDT-211217", "next_week", "USDT", "sell", "0.000000000000000009")]],
      ["coin_perpetual", [position("BTC", "BTC-USD", null, "BTC", "buy", "-0.000000000000000011")]],
      ["coin_delivery_futures", [position("BTC", "BTC201225", "quarter", "BTC", "sell", "0.000000000000000013")]],
    ] as const;
    return {
      schemaVersion: "account-observation/v2",
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
      derivatives: {
        schemaVersion: "htx-derivatives-observation/v1",
        families: families.map(([family, accounts]) => ({
          family, status: "COMPLETE", accounts, readStartedAtMs: at,
          readCompletedAtMs: at, responseGeneratedAtMs: at, error: null,
          positions: {
            status: "COMPLETE",
            values: positionRows.find(([positionFamily]) => positionFamily === family)?.[1] ?? [],
            readStartedAtMs: at, readCompletedAtMs: at, responseGeneratedAtMs: at, error: null,
          },
        })),
      },
    };
  };
  const wire = async (target: Page, admin: boolean) => {
    await target.route(`**/api/trader/${admin ? "admin/" : ""}account-observation**`, (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const isBinding = pathname.endsWith("/binding");
      const isStream = pathname.endsWith("/stream");
      if (streamFailed && isStream && !denied) return route.fulfill({ status: 503, body: "" });
      return route.fulfill(
        denied
          ? { status: 403, body: "" }
          : {
              status: 200,
              contentType: isStream ? "text/event-stream" : "application/json",
              body: isStream
                ? `event: observation\ndata: ${JSON.stringify(observation())}\n\n`
                : JSON.stringify(isBinding ? binding : observation()),
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
  const tenantCross = tenantPanel.getByRole("region", { name: "USDT cross · shared derivatives pool" });
  await expect(tenantCross.getByText("200.50", { exact: true })).toBeVisible();
  await expect(tenantCross.getByText("180.25", { exact: true })).toBeVisible();
  await expect(tenantCross.getByText("Shared USDT pool for perpetual and delivery contracts. Account totals are shown once; contract details are not added again.")).toBeVisible();
  const tenantIsolated = tenantPanel.getByRole("region", { name: "USDT perpetual · isolated accounts" });
  await expect(tenantIsolated.getByText("Open positions")).toBeVisible();
  await expect(tenantIsolated.getByText("BTC · BTC-USDT")).toBeVisible();
  await expect(tenantIsolated.getByText("Long · Contract type unavailable")).toBeVisible();
  await expect(tenantIsolated.getByText("-0.000000000000000007", { exact: true })).toBeVisible();
  await expect(tenantCross.getByText("Short · next_week")).toBeVisible();
  await expect(tenantCross.getByText("0.000000000000000009", { exact: true })).toBeVisible();
  for (const family of ["USDT perpetual · isolated accounts", "Coin-margined perpetual accounts", "Coin-margined delivery futures accounts"]) {
    await expect(tenantPanel.getByRole("region", { name: family })).toBeVisible();
  }
  await expect(page.getByTestId("trader-unpublished-note")).toBeVisible();
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
  const adminCross = adminPanel.getByRole("region", { name: "USDT cross · shared derivatives pool" });
  await expect(adminCross.getByText("200.50", { exact: true })).toBeVisible();
  await expect(adminCross.getByText("180.25", { exact: true })).toBeVisible();
  await expect(adminCross.getByText("Shared USDT pool for perpetual and delivery contracts. Account totals are shown once; contract details are not added again.")).toBeVisible();
  const adminIsolated = adminPanel.getByRole("region", { name: "USDT perpetual · isolated accounts" });
  await expect(adminIsolated.getByText("Open positions")).toBeVisible();
  await expect(adminIsolated.getByText("BTC · BTC-USDT")).toBeVisible();
  await expect(adminIsolated.getByText("Long · Contract type unavailable")).toBeVisible();
  await expect(adminIsolated.getByText("-0.000000000000000007", { exact: true })).toBeVisible();
  await expect(adminCross.getByText("Short · next_week")).toBeVisible();
  await expect(adminCross.getByText("0.000000000000000009", { exact: true })).toBeVisible();
  await expect(adminPanel.getByRole("button")).toHaveCount(0);
  await expect(tenantPanel.getByText("Reconnecting automatically.")).toBeVisible();
  await expect(adminPanel.getByText("Reconnecting automatically.")).toBeVisible();

  version = 2;
  await expect(tenantPanel.getByText(observation().observationId)).toBeVisible({ timeout: 12_000 });
  await expect(adminPanel.getByText(observation().observationId)).toBeVisible({ timeout: 12_000 });
  streamFailed = true;
  await expect(
    tenantPanel.getByText("Automatic polling fallback; stream retry scheduled."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPanel.getByText("Automatic polling fallback; stream retry scheduled."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(tenantPanel.getByText(observation().observationId)).toBeVisible();
  denied = true;
  await expect(tenantPanel.getByText("Access revoked; account data cleared.")).toBeVisible({
    timeout: 12_000,
  });
  await expect(adminPanel.getByText("Access revoked; account data cleared.")).toBeVisible({
    timeout: 12_000,
  });
  await expect(tenantPanel.getByText(observation().observationId)).toHaveCount(0);
  await expect(adminPanel.getByText(observation().observationId)).toHaveCount(0);
  await expect(tenantPanel.getByText("200.50", { exact: true })).toHaveCount(0);
  await expect(adminPanel.getByText("200.50", { exact: true })).toHaveCount(0);
  await expect(tenantPanel.getByText("BTC · BTC-USDT", { exact: true })).toHaveCount(0);
  await expect(adminPanel.getByText("BTC · BTC-USDT", { exact: true })).toHaveCount(0);
  await admin.close();
});

test("account observation admin page does not expose the form anonymously", async ({ page }) => {
  await page.goto("/admin/account-observation");
  await expect(page.getByRole("heading", { name: "Live HTX account" })).toHaveCount(0);
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
