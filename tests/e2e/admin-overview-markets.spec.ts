import { expect, test } from "@playwright/test";
import { parseAccountObservation } from "../../lib/trader/account-observation/validation";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

// Mounted UI fixtures only: no actual HTX, DB projection, TLS or production proof.
test("main Overview separates Spot/Futures, scopes all accounts and clears revoked observations", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `e2e-overview-markets-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantPlatformAdminByUserEmail(email);
  const at = Date.now() - 2_000;
  const accounts = [1, 2, 3].map((id) => ({
    organizationId: `${id}${"1".repeat(7)}-1111-4111-8111-111111111111`,
    credentialId: `${id}${"2".repeat(7)}-2222-4222-8222-222222222222`,
    exchangeAccountId: `fixture-${id}`,
    accountName: `Тестовый счёт ${id}`,
    venue: "htx",
    status: "active",
    updatedAt: new Date(at).toISOString(),
  }));
  let denied = false;
  let missing = false;
  let canonicalUnavailable = false;
  const observationRequests: string[] = [];
  let directoryRequests = 0;
  const binding = (index: number) => ({
    organizationId: accounts[index]!.organizationId,
    credentialId: accounts[index]!.credentialId,
    exchangeAccountId: accounts[index]!.exchangeAccountId,
    credentialRevision: "1",
    configurationRevision: "1",
  });
  const snapshot = (index: number) => {
    const empty = {
      status: "COMPLETE",
      values: [],
      sourceAsOfMs: at,
      readStartedAtMs: at,
      readCompletedAtMs: at,
      error: null,
    };
    const times = { readStartedAtMs: at, readCompletedAtMs: at, responseGeneratedAtMs: at };
    return parseAccountObservation({
      schemaVersion: "account-observation/v3",
      binding: binding(index),
      observationId: `${index + 1}${"3".repeat(7)}-3333-4333-8333-333333333333`,
      collectionStartedAtMs: at,
      collectionCompletedAtMs: at,
      status: "PARTIAL",
      balances: {
        ...empty,
        values: [
          {
            asset: "USDT",
            free: index ? "5000" : "390.03",
            locked: "0",
            total: index ? "5000" : "390.03",
          },
        ],
      },
      openOrders: empty,
      trades: [{ symbol: "BTCUSDT", component: empty }],
      holdings: [
        {
          asset: "USDT",
          free: index ? "5000" : "390.03",
          locked: "0",
          total: index ? "5000" : "390.03",
        },
      ],
      htxV5: {
        schemaVersion: "htx-v5-observation/v1",
        htxUid: String(10001 + index),
        assetMode: { ...times, status: "COMPLETE", value: "1", error: null },
        balance: {
          ...times,
          status: missing ? "ERROR" : "COMPLETE",
          error: missing ? "READ_FAILED" : null,
          value: missing
            ? null
            : {
                state: "normal",
                account: {
                  equityUsd: ["207.480000000001", "5000", "0.000000000009"][index],
                  availableMarginUsd: "0",
                  profitUnrealUsd: "-0.000000000001",
                  initialMarginUsd: "0",
                  maintenanceMarginUsd: "0",
                  maintenanceMarginRate: "0",
                  voucherValue: "0",
                  createdTimeMs: at,
                  updatedTimeMs: at,
                },
                details: [],
              },
        },
        positions: { ...times, status: "COMPLETE", values: [], error: null, pageScope: null },
        openOrders: {
          ...times,
          status: "PARTIAL",
          values: [],
          error: null,
          pageScope: {
            pageSize: 20,
            maxPages: 2,
            pagesRead: 1,
            nextFrom: null,
            completeness: "UNKNOWN",
          },
        },
        algoOrders: {
          ...times,
          status: "PARTIAL",
          values: [],
          error: null,
          pageScope: {
            pageSize: 20,
            maxPagesPerType: 2,
            completeness: "UNKNOWN",
            queries: ["tp", "sl", "tpsl", "trigger", "trailing_stop"].map((type) => ({
              type,
              pagesRead: 1,
              nextFrom: null,
            })),
          },
        },
        fills: {
          status: "NOT_CONFIGURED",
          values: null,
          error: null,
          readStartedAtMs: null,
          readCompletedAtMs: null,
          responseGeneratedAtMs: null,
          coverage: "NOT_CONFIGURED",
          contracts: [],
          windowStartMs: null,
          windowEndMs: null,
          pageScope: null,
        },
      },
    });
  };
  // Validate fixtures before route callbacks so malformed DTOs fail explicitly.
  accounts.forEach((_, index) => snapshot(index));
  await page.route("**/api/trader/admin/connected-accounts", (route) => {
    directoryRequests += 1;
    return route.fulfill(denied ? { status: 403, body: "" } : { json: { accounts } });
  });
  await page.route("**/api/trader/admin/account-observation**", (route) => {
    const url = new URL(route.request().url());
    const index = accounts.findIndex(
      (account) => account.credentialId === url.searchParams.get("credentialId"),
    );
    observationRequests.push(accounts[index]?.exchangeAccountId ?? "unknown");
    return route.fulfill(
      index < 0
        ? { status: 403, body: "" }
        : {
            json: url.pathname.endsWith("/binding") ? binding(index) : snapshot(index),
          },
    );
  });
  await page.route("**/api/trader/admin/console/**", (route) => {
    const url = new URL(route.request().url());
    const organizationId = url.searchParams.get("organization_id");
    const exchangeAccountId = url.searchParams.get("exchange_account_id");
    const scope = exchangeAccountId
      ? { kind: "account", organizationId, exchangeAccountId }
      : organizationId
        ? { kind: "organization", organizationId }
        : { kind: "fleet" };
    const fact = (amount: string | null) => ({
      value: amount === null ? null : { amount, currency: "USDT" },
      state: amount === null ? "unavailable" : "ok",
      reasons: [],
      times: { observedAt: new Date(at).toISOString() },
    });
    return route.fulfill({
      json: {
        schemaVersion: "admin-console/v1",
        scope,
        mode: url.searchParams.get("mode") ?? "live",
        generatedAt: new Date(at).toISOString(),
        financeRevision: "fixture-revision",
        coverage: { included: 3, total: 3, excluded: [] },
        data: url.pathname.endsWith("/overview")
          ? canonicalUnavailable
            ? { state: "unavailable", reasons: ["POSTGRES_REQUIRED"] }
            : {
                finance: {
                  equity: fact("10390.03"),
                  free: fact("10390.03"),
                  holdings: fact("0"),
                  reserved: fact("0"),
                  pnl: fact(null),
                },
                coverageLabel: "По 3 актуальным счетам из 3",
                accounts: [],
                period: null,
              }
          : { items: [] },
      },
    });
  });

  await page.goto("/admin?currency=USDT");
  await expect(page.getByTestId("overview-Капитал спота")).toContainText(/10\s390,03/);
  await expect(page.getByText("Капитал фьючерсов", { exact: true })).toBeVisible();
  const futures = page.getByRole("region", { name: "Фьючерсы", exact: true });
  await expect(futures.getByText("Снимки учтены: 3 из 3")).toBeVisible();
  await expect(futures).toContainText(/5\s207,48000000001/);
  await expect(futures).toContainText("USD");
  await expect(page.getByTestId("admin-connected-accounts").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByText("Общий капитал", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("overview-spot-futures-fixture.png"),
    fullPage: true,
  });

  observationRequests.length = 0;
  await page.goto(
    `/admin?organization_id=${accounts[0]!.organizationId}&exchange_account_id=fixture-1`,
  );
  await expect(page.getByText("Снимки учтены: 1 из 1")).toBeVisible();
  await expect(page.getByTestId("admin-connected-accounts").locator("tbody tr")).toHaveCount(1);
  expect(new Set(observationRequests)).toEqual(new Set(["fixture-1"]));

  canonicalUnavailable = true;
  await page.goto("/admin?currency=USD");
  await expect(page.getByText("Снимки учтены: 3 из 3")).toBeVisible();
  await expect(page.getByText("Капитал фьючерсов", { exact: true })).toBeVisible();

  for (const query of [
    "mode=paper",
    "mode=history",
    "organization_id=invalid",
    "exchange_account_id=fixture-1",
  ]) {
    observationRequests.length = 0;
    const before = directoryRequests;
    await page.goto(`/admin?${query}`);
    await expect(page.getByText("Капитал фьючерсов", { exact: true })).toBeVisible();
    await expect(page.getByTestId("admin-connected-accounts")).toHaveCount(0);
    expect(directoryRequests).toBe(before);
    expect(observationRequests).toEqual([]);
  }

  // Install the clock before mounting the component that owns polling timers.
  await page.clock.install();
  missing = true;
  await page.goto("/admin?mode=live");
  await expect(page.getByText("Снимки учтены: 0 из 3")).toBeVisible();
  await expect(
    page.getByText("Нет полного актуального снимка по счетам в выбранном охвате."),
  ).toBeVisible();
  await expect(futures.getByText("0 USD", { exact: true })).toHaveCount(0);
  denied = true;
  await page.clock.fastForward(60_001);
  await expect(page.getByText("Доступ отозван. Данные счетов очищены.")).toBeVisible();
  await expect(page.getByTestId("admin-connected-accounts")).toHaveCount(0);
  await expect(page.getByText("Тестовый счёт 1", { exact: true })).toHaveCount(0);
});
