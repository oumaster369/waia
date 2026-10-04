import { expect, test, type Page } from "@playwright/test";
import { parseAccountObservation } from "../../lib/trader/account-observation/validation";
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
}, testInfo) => {
  test.setTimeout(90_000);
  const email = `e2e-account-observation-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  let version = 1;
  let v5Enabled = false;
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
    const derivativeRow = (
      accountCode: string,
      collateralAsset: string,
      marginMode: "isolated" | "cross" | null,
      marginBalance: string,
      withdrawAvailable: string | null = null,
      marginAvailable: string | null = "0",
    ) => ({
      accountCode,
      collateralAsset,
      marginMode,
      marginBalance,
      marginAvailable,
      withdrawAvailable,
      marginPosition: null,
      marginFrozen: "0",
      marginStatic: null,
      realizedPnl: null,
      unrealizedPnl: "0",
      riskRate: null,
      liquidationPrice: null,
      leverage: null,
    });
    const families = [
      ["usdt_isolated_perpetual", [derivativeRow("BTC-USDT", "USDT", "isolated", "100.25")]],
      ["usdt_cross_shared", [derivativeRow("USDT", "USDT", "cross", "200.50", "180.25", null)]],
      ["coin_perpetual", [derivativeRow("BTC-USD", "BTC", null, "0.003")]],
      ["coin_delivery_futures", [derivativeRow("BTC", "BTC", null, "0.004")]],
    ] as const;
    const position = (
      symbol: string,
      contractCode: string,
      contractType: string | null,
      marginAsset: string,
      direction: "buy" | "sell",
      unrealizedPnl: string,
    ) => ({
      symbol,
      contractCode,
      contractType,
      direction,
      volume: "0.000000000000000013",
      available: "0.000000000000000011",
      frozen: "0.000000000000000002",
      costOpen: "100.000000000000000001",
      costHold: "99.000000000000000009",
      unrealizedPnl,
      profitRate: "-0.000000000000000003",
      positionMargin: "3.125000000000000001",
      marginAsset,
      leverage: "5",
      lastPrice: "101.000000000000000003",
      liquidationPrice: null,
    });
    const positionRows = [
      [
        "usdt_isolated_perpetual",
        [position("BTC", "BTC-USDT", null, "USDT", "buy", "-0.000000000000000007")],
      ],
      [
        "usdt_cross_shared",
        [position("BTC", "BTC-USDT-211217", "next_week", "USDT", "sell", "0.000000000000000009")],
      ],
      ["coin_perpetual", [position("BTC", "BTC-USD", null, "BTC", "buy", "-0.000000000000000011")]],
      [
        "coin_delivery_futures",
        [position("BTC", "BTC201225", "quarter", "BTC", "sell", "0.000000000000000013")],
      ],
    ] as const;
    const fill = (symbol: string, contractCode: string, id: string, feeAsset: string) => ({
      id,
      matchId: "918800256249405440",
      orderId: "918800256249405441",
      symbol,
      contractCode,
      contractType: "swap",
      direction: "sell" as const,
      offset: "close" as const,
      volume: "7",
      price: "3000.5",
      fee: "-0.010000000000000001",
      feeAsset,
      realizedPnl: "-1.25",
      offsetPnl: "0",
      executedAtMs: at - 1_000,
      orderSource: "api",
    });
    const executionRows = [
      [
        "usdt_isolated_perpetual",
        ["ETH-USDT"],
        [fill("ETH", "ETH-USDT", "fill-isolated-1", "USDT")],
      ],
      ["usdt_cross_shared", ["ETH-USDT"], [fill("ETH", "ETH-USDT", "fill-cross-1", "USDT")]],
      ["coin_perpetual", ["BTC-USD"], [fill("BTC", "BTC-USD", "fill-coin-1", "BTC")]],
      [
        "coin_delivery_futures",
        ["BTC201225"],
        [fill("BTC", "BTC201225", "fill-delivery-1", "BTC")],
      ],
    ] as const;
    const htxV5 = {
      schemaVersion: "htx-v5-observation/v1",
      htxUid: "9988776655",
      assetMode: {
        status: "COMPLETE",
        value: "1",
        readStartedAtMs: at,
        readCompletedAtMs: at,
        responseGeneratedAtMs: at,
        error: null,
      },
      balance: {
        status: "COMPLETE",
        readStartedAtMs: at,
        readCompletedAtMs: at,
        responseGeneratedAtMs: at,
        error: null,
        value: {
          state: "normal",
          account: {
            equityUsd: "1000.25",
            initialMarginUsd: "2",
            maintenanceMarginUsd: "1",
            maintenanceMarginRate: "0.001",
            profitUnrealUsd: "-0.25",
            availableMarginUsd: "997.25",
            voucherValue: "0",
            createdTimeMs: at,
            updatedTimeMs: at,
          },
          details: [],
        },
      },
      positions: {
        status: "COMPLETE",
        values: [
          {
            contractCode: "BTC-USDT",
            positionSide: "long",
            direction: "buy",
            marginMode: "cross",
            volume: "2",
            available: "2",
            openAveragePrice: "60000",
            liquidationPrice: null,
            initialMargin: "10",
            maintenanceMargin: "2",
            margin: "10",
            profitUnreal: "1.25",
            profitRate: "0.01",
            marginRate: "0.02",
            marginCurrency: "USDT",
            lastPrice: "61000",
            markPrice: "61000",
            contractType: "swap",
            createdTimeMs: at - 1000,
            updatedTimeMs: at,
          },
        ],
        readStartedAtMs: at,
        readCompletedAtMs: at,
        responseGeneratedAtMs: at,
        error: null,
        pageScope: null,
      },
      openOrders: {
        status: "PARTIAL",
        values: [],
        readStartedAtMs: at,
        readCompletedAtMs: at,
        responseGeneratedAtMs: at,
        error: null,
        pageScope: {
          pageSize: 20,
          maxPages: 2,
          pagesRead: 2,
          nextFrom: null,
          completeness: "UNKNOWN",
        },
      },
      algoOrders: {
        status: "PARTIAL",
        values: [
          {
            id: "101",
            algoId: "algo-stop-fixture",
            contractCode: "BTC-USDT",
            volume: "1",
            type: "sl",
            state: "active",
            positionSide: "long",
            side: "sell",
            marginMode: "cross",
            tpTriggerPrice: null,
            slTriggerPrice: "59000",
            reduceOnly: true,
            createdTimeMs: at - 900,
            updatedTimeMs: at,
          },
          {
            id: "102",
            algoId: "algo-target-fixture",
            contractCode: "BTC-USDT",
            volume: "1",
            type: "tp",
            state: "active",
            positionSide: "long",
            side: "sell",
            marginMode: "cross",
            tpTriggerPrice: "62000",
            slTriggerPrice: null,
            reduceOnly: true,
            createdTimeMs: at - 900,
            updatedTimeMs: at,
          },
        ],
        readStartedAtMs: at,
        readCompletedAtMs: at,
        responseGeneratedAtMs: at,
        error: null,
        pageScope: {
          pageSize: 20,
          maxPagesPerType: 2,
          queries: ["tp", "sl", "tpsl", "trigger", "trailing_stop"].map((type) => ({
            type,
            pagesRead: 1,
            nextFrom: null,
          })),
          completeness: "UNKNOWN",
        },
      },
      fills: {
        status: "NOT_CONFIGURED",
        coverage: "NOT_CONFIGURED",
        contracts: [],
        windowStartMs: null,
        windowEndMs: null,
        readStartedAtMs: null,
        readCompletedAtMs: null,
        responseGeneratedAtMs: null,
        error: null,
        pageScope: null,
        values: null,
      },
    };
    return parseAccountObservation({
      schemaVersion: v5Enabled ? "account-observation/v3" : "account-observation/v2",
      binding,
      observationId:
        version === 1
          ? "33333333-3333-4333-8333-333333333333"
          : "44444444-4444-4444-8444-444444444444",
      collectionStartedAtMs: at,
      collectionCompletedAtMs: at,
      status: v5Enabled ? "PARTIAL" : "COMPLETE",
      balances: empty,
      openOrders: empty,
      holdings: [],
      trades: [{ symbol: "BTCUSDT", component: empty }],
      derivatives: {
        schemaVersion: "htx-derivatives-observation/v1",
        families: families.map(([family, accounts]) => ({
          family,
          status: "COMPLETE",
          accounts,
          readStartedAtMs: at,
          readCompletedAtMs: at,
          responseGeneratedAtMs: at,
          error: null,
          positions: {
            status: "COMPLETE",
            values: positionRows.find(([positionFamily]) => positionFamily === family)?.[1] ?? [],
            readStartedAtMs: at,
            readCompletedAtMs: at,
            responseGeneratedAtMs: at,
            error: null,
          },
          executions: {
            status: "COMPLETE",
            coverage: "CONFIGURED_CONTRACTS",
            values:
              executionRows.find(([executionFamily]) => executionFamily === family)?.[2] ?? [],
            contracts:
              executionRows.find(([executionFamily]) => executionFamily === family)?.[1] ?? [],
            readStartedAtMs: at,
            readCompletedAtMs: at,
            responseGeneratedAtMs: at,
            windowStartMs: at - 60_000,
            windowEndMs: at,
            error: null,
          },
        })),
      },
      ...(v5Enabled ? { htxV5 } : {}),
    });
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
  const tenantCross = tenantPanel.getByRole("region", {
    name: "USDT cross · shared derivatives pool",
  });
  await expect(tenantCross.getByText("200.50", { exact: true })).toBeVisible();
  await expect(tenantCross.getByText("180.25", { exact: true })).toBeVisible();
  await expect(
    tenantCross.getByText(
      "Shared USDT pool for perpetual and delivery contracts. Account totals are shown once; contract details are not added again.",
    ),
  ).toBeVisible();
  const tenantIsolated = tenantPanel.getByRole("region", {
    name: "USDT perpetual · isolated accounts",
  });
  await expect(
    tenantPanel.getByText("Seeing this display does not permit futures trading."),
  ).toBeVisible();
  await expect(tenantIsolated.getByText("Open positions", { exact: true })).toBeVisible();
  await expect(tenantIsolated.getByText("Recent executions")).toBeVisible();
  await expect(tenantIsolated.getByText("BTC · BTC-USDT")).toBeVisible();
  await expect(tenantIsolated.getByText("Executed fill · ETH · ETH-USDT")).toBeVisible();
  await expect(
    tenantIsolated.getByText("Sell · Close · not an open position or a balance"),
  ).toBeVisible();
  await expect(
    tenantCross.getByText("These fills are not a second copy of the shared USDT pool."),
  ).toBeVisible();
  await expect(tenantIsolated.getByText("Long · Contract type unavailable")).toBeVisible();
  await expect(tenantIsolated.getByText("-0.000000000000000007", { exact: true })).toBeVisible();
  await expect(tenantCross.getByText("Short · next_week")).toBeVisible();
  await expect(tenantCross.getByText("0.000000000000000009", { exact: true })).toBeVisible();
  for (const family of [
    "USDT perpetual · isolated accounts",
    "Coin-margined perpetual accounts",
    "Coin-margined delivery futures accounts",
  ]) {
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
  const adminCross = adminPanel.getByRole("region", {
    name: "USDT cross · shared derivatives pool",
  });
  await expect(adminCross.getByText("200.50", { exact: true })).toBeVisible();
  await expect(adminCross.getByText("180.25", { exact: true })).toBeVisible();
  await expect(
    adminCross.getByText(
      "Shared USDT pool for perpetual and delivery contracts. Account totals are shown once; contract details are not added again.",
    ),
  ).toBeVisible();
  const adminIsolated = adminPanel.getByRole("region", {
    name: "USDT perpetual · isolated accounts",
  });
  await expect(
    adminPanel.getByText("Seeing this display does not permit futures trading."),
  ).toBeVisible();
  await expect(adminIsolated.getByText("Open positions", { exact: true })).toBeVisible();
  await expect(adminIsolated.getByText("Recent executions")).toBeVisible();
  await expect(adminIsolated.getByText("BTC · BTC-USDT")).toBeVisible();
  await expect(adminIsolated.getByText("Executed fill · ETH · ETH-USDT")).toBeVisible();
  await expect(
    adminIsolated.getByText("Sell · Close · not an open position or a balance"),
  ).toBeVisible();
  await expect(
    adminCross.getByText("These fills are not a second copy of the shared USDT pool."),
  ).toBeVisible();
  await expect(adminIsolated.getByText("Long · Contract type unavailable")).toBeVisible();
  await expect(adminIsolated.getByText("-0.000000000000000007", { exact: true })).toBeVisible();
  await expect(adminCross.getByText("Short · next_week")).toBeVisible();
  await expect(adminCross.getByText("0.000000000000000009", { exact: true })).toBeVisible();
  await expect(adminPanel.getByRole("button")).toHaveCount(0);
  await expect(tenantPanel.getByText("Reconnecting automatically.")).toBeVisible();
  await expect(adminPanel.getByText("Reconnecting automatically.")).toBeVisible();

  version = 2;
  v5Enabled = true;
  await expect(tenantPanel.getByText(observation().observationId)).toBeVisible({ timeout: 12_000 });
  await expect(adminPanel.getByText(observation().observationId)).toBeVisible({ timeout: 12_000 });
  for (const panel of [tenantPanel, adminPanel]) {
    const v5 = panel.getByRole("region", { name: "HTX futures snapshot" });
    await expect(v5.getByText("Снимок фьючерсного счёта HTX")).toBeVisible();
    await expect(v5.getByText("Капитал счёта (USD)")).toBeVisible();
    await expect(v5.getByText("В этой выборке могут отсутствовать некоторые записи.").first()).toBeVisible();
    await expect(panel.getByText("HTX · счёт account-a · UID 9988776655")).toBeVisible();
    await expect(panel.getByText(/Результат за день: недоступен/)).toBeVisible();
    await expect(v5.getByText("Стоп: цена 59000; объём 1 контр.")).toBeVisible();
    await expect(v5.getByText("Цель: цена 62000; объём 1 контр.")).toBeVisible();
    await expect(v5.getByText("Полнота покрытия позиции неизвестна; защита не подтверждена.")).toBeVisible();
    await expect(
      v5.getByText("История исполнений недоступна; число исполнений неизвестно."),
    ).toBeVisible();
    await expect(panel.getByText("BTC · BTC-USDT", { exact: true })).toBeVisible();
    await expect(v5.getByRole("alert")).toHaveCount(1);
    await expect(v5.getByRole("alert")).toHaveText("Наличие защиты открытой позиции не подтверждено этим снимком.");
    await expect(v5.getByRole("button")).toHaveCount(0);
  }
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
  await expect(tenantPanel.getByRole("region", { name: "HTX futures snapshot" })).toHaveCount(0);
  await expect(adminPanel.getByRole("region", { name: "HTX futures snapshot" })).toHaveCount(0);

  await expect(tenantPanel.getByText("HTX · счёт account-a · UID 9988776655")).toHaveCount(0);
  await expect(adminPanel.getByText("HTX · счёт account-a · UID 9988776655")).toHaveCount(0);

  // Restore the local fixture after the revocation case, then capture the mounted
  // Spot/Futures cabinet and Admin index at desktop and mobile widths.
  denied = false;
  streamFailed = false;
  await page.goto("/trader");
  const restoredTenantPanel = page.getByRole("region", {
    name: "Account observation",
    exact: true,
  });
  await expect(restoredTenantPanel.getByText(observation().observationId)).toBeVisible();
  await expect(restoredTenantPanel.getByRole("region", { name: "Спот" })).toBeVisible();
  await expect(restoredTenantPanel.getByRole("region", { name: "Фьючерсы" })).toBeVisible();
  await expect(restoredTenantPanel.getByText("Капитал счёта (USD)")).toBeVisible();
  await expect(restoredTenantPanel.getByText("Стоп: цена 59000; объём 1 контр.")).toBeVisible();
  await expect(restoredTenantPanel.getByText("Цель: цена 62000; объём 1 контр.")).toBeVisible();
  await restoredTenantPanel.getByRole("region", { name: "HTX futures snapshot" }).screenshot({
    path: testInfo.outputPath("htx-v5-desktop.png"),
  });
  await page.screenshot({
    path: testInfo.outputPath("account-observation-shared-view.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: "test-results/account-observation-cabinet-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await restoredTenantPanel
    .getByRole("heading", { name: "Фьючерсы · маржа, позиции и заявки", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/account-observation-cabinet-mobile.png",
  });

  let directoryDenied = false;
  await admin.route("**/api/trader/admin/connected-accounts", (route) =>
    directoryDenied ? route.fulfill({ status: 403, contentType: "text/plain", body: "Forbidden" }) : route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accounts: [
          {
            organizationId: binding.organizationId,
            accountName: "Local demo cabinet",
            credentialId: binding.credentialId,
            exchangeAccountId: binding.exchangeAccountId,
            venue: "htx",
            status: "active",
            updatedAt: new Date(started).toISOString(),
          },
        ],
      }),
    }),
  );
  await admin.clock.install();
  await admin.goto("/admin/account-observation");
  const adminIndex = admin.getByTestId("admin-connected-accounts");
  await expect(
    adminIndex.getByRole("columnheader", { name: "Спот USDT · доступно" }),
  ).toBeVisible();
  await expect(adminIndex.getByRole("columnheader", { name: "Фьючерсы · USD" })).toBeVisible();
  await expect(adminIndex.getByText("Капитал HTX: 1000.25 USD")).toBeVisible();
  await expect(adminIndex.getByText("Доступная маржа: 997.25 USD")).toBeVisible();
  await expect(adminIndex.getByText("Нереализованный результат HTX: -0.25 USD")).toBeVisible();
  await admin.screenshot({
    path: "test-results/account-observation-admin-desktop.png",
    fullPage: true,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  await adminIndex.scrollIntoViewIfNeeded();
  await adminIndex.evaluate((table) => {
    const scroller = table.parentElement;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await expect(adminIndex.getByText("Капитал HTX: 1000.25 USD")).toBeVisible();
  await admin.screenshot({
    path: "test-results/account-observation-admin-mobile.png",
  });
  await admin.goto("/admin/accounts");
  const accountsObservationLink = admin.getByRole("link", {
    name: "Спот и фьючерсы подключённых счетов",
  });
  await expect(accountsObservationLink).toBeVisible();
  await accountsObservationLink.click();
  await expect(admin.getByTestId("admin-connected-accounts")).toBeVisible();
  const adminNav = admin.getByRole("navigation", { name: "Консоль администратора AI-TRADER" });
  await expect(adminNav.getByRole("link", { name: "Счета", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(adminNav.getByRole("link", { name: "Обзор", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(admin.getByText("Капитал HTX: 1000.25 USD")).toBeVisible();
  directoryDenied = true;
  await admin.clock.fastForward(60_000);
  await expect(admin.getByText("Доступ отозван. Данные счетов очищены.")).toBeVisible();
  await expect(admin.getByTestId("admin-connected-accounts")).toHaveCount(0);
  await expect(admin.getByText("Local demo cabinet", { exact: true })).toHaveCount(0);
  await expect(admin.getByText("Капитал HTX: 1000.25 USD")).toHaveCount(0);
  directoryDenied = false;
  await admin.clock.fastForward(60_000);
  await expect(admin.getByTestId("admin-connected-accounts")).toBeVisible();
  await expect(admin.getByText("Капитал HTX: 1000.25 USD")).toBeVisible();
  await expect(admin.getByText("Доступ отозван. Данные счетов очищены.")).toHaveCount(0);
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
