import { test, expect } from "@playwright/test";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";
import {
  binding,
  historyPage,
  observation,
  cursor,
  now,
} from "../helpers/financial-history-ui-fixture";

// Mounted browser transport fixtures only: no backend/provider or deployment acceptance.
test("persisted history paging, selected account isolation, empty coverage and revocation in tenant/admin", async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  const email = `e2e-history-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email);
  grantTraderEntitlementByUserEmail(email);
  grantPlatformAdminByUserEmail(email);
  const writes: string[] = [];
  context.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (
      path.startsWith("/api/trader/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method()) &&
      path !== "/api/trader/admin/console/visit-marker"
    )
      writes.push(`${req.method()} ${path}`);
  });
  let denied = false;
  const periodGate: { release?: () => void } = {};
  const historyRequests: string[] = [];
  await context.route("**/api/trader/**account-observation**", async (route) => {
    const url = new URL(route.request().url());
    const exact = {
      ...binding,
      exchangeAccountId: url.searchParams.get("exchangeAccountId") ?? binding.exchangeAccountId,
    };
    if (url.pathname.endsWith("/financial-history")) {
      historyRequests.push(url.toString());
      if (denied) return route.fulfill({ status: 403 });
      const requestedStart = url.searchParams.get("windowStartMs");
      if (requestedStart !== null) {
        const start = Number(requestedStart);
        const isFirstPeriod = start === Date.parse("2026-03-08T00:00:00Z");
        if (!isFirstPeriod)
          await new Promise<void>((resolve) => {
            periodGate.release = resolve;
          });
        const more = url.searchParams.has("cursor");
        const filtered = historyPage(
          [isFirstPeriod ? (more ? "20002" : "20001") : "30001"],
          isFirstPeriod && !more ? cursor(2) : null,
          exact,
        );
        filtered.records[0].bill.createdTimeMs = start + 1000;
        filtered.records[0].bill.amount = isFirstPeriod ? (more ? "-0.01" : "4.01") : "8";
        Object.assign(filtered.coverage[0].provenance, {
          windowStartMs: start,
          windowEndMs: start + 86_400_000,
        });
        if (more) filtered.coverage = [];
        return route.fulfill({ json: filtered });
      }
      const pageData =
        exact.exchangeAccountId === "account-b"
          ? historyPage([], null, exact)
          : historyPage(
              url.searchParams.has("cursor") ? ["10002"] : ["10001"],
              url.searchParams.has("cursor") ? null : cursor(1),
              exact,
            );
      if (url.searchParams.has("cursor")) pageData.coverage = [];
      return route.fulfill({ json: pageData });
    }
    if (url.pathname.endsWith("/binding")) return route.fulfill({ json: exact });
    if (url.pathname.endsWith("/stream"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: `event: observation\ndata: ${JSON.stringify(observation(exact))}\n\n`,
      });
    return route.fulfill({ json: observation(exact) });
  });
  await page.route("**/api/trader/exchange-credentials", (route) =>
    route.fulfill({
      json: {
        credentials: ["account-a", "account-b"].map((exchangeAccountId) => ({
          id: binding.credentialId,
          venue: "htx",
          exchangeAccountId,
          apiKeyMasked: null,
          status: "active",
          permissionMetadata: null,
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          revokedAt: null,
        })),
      },
    }),
  );
  for (const path of ["balance-snapshots", "position-snapshots", "trade-history-snapshots"])
    await page.route(`**/api/trader/${path}?**`, (route) =>
      route.fulfill({ json: { snapshots: [] } }),
    );
  await page.goto("/trader");
  await page.getByLabel("Select an account").selectOption("account-a");
  const panel = page.getByRole("region", { name: "Persisted financial history" });
  await expect(panel.getByText("10001", { exact: true })).toBeVisible();
  await expect(panel.getByText("-0.750000000000000001 USDT", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Collection is currently not configured/)).toBeVisible();
  const totals = panel.getByRole("region", { name: "Loaded record totals" });
  await expect(totals.getByText(/Loaded records: 1/)).toBeVisible();
  await expect(
    panel
      .getByRole("region", { name: "Profit calculation availability" })
      .getByText("Unavailable", { exact: true }),
  ).toHaveCount(2);
  await panel.getByRole("button", { name: "Load more history" }).click();
  await expect(panel.getByText("10002", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("list", { name: "Persisted financial records" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(panel.getByRole("button", { name: "Load more history" })).toBeDisabled();
  await expect(
    totals.getByRole("cell", { name: "-1.500000000000000002", exact: true }),
  ).toBeVisible();
  await expect(totals.getByText(/completeness is unknown/)).toBeVisible();
  const startInput = panel.getByLabel("Start date (UTC)");
  const throughInput = panel.getByLabel("Through date (UTC)");
  const apply = panel.getByRole("button", { name: "Apply period" });
  await startInput.fill("2026-03-08");
  await throughInput.fill("2026-03-08");
  await apply.focus();
  await page.keyboard.press("Enter");
  await expect(apply).toBeFocused();
  await expect(panel.getByText("20001", { exact: true })).toBeVisible();
  await expect(panel.getByText("10001", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("10002", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Load more history" }).click();
  await expect(panel.getByText("20002", { exact: true })).toBeVisible();
  await expect(totals.getByRole("cell", { name: "4", exact: true })).toBeVisible();
  const filteredRequests = historyRequests
    .map((url) => new URL(url))
    .filter(
      (url) => url.searchParams.get("windowStartMs") === String(Date.parse("2026-03-08T00:00:00Z")),
    );
  expect(filteredRequests).toHaveLength(2);
  expect(
    filteredRequests.every(
      (url) => url.searchParams.get("windowEndMs") === String(Date.parse("2026-03-09T00:00:00Z")),
    ),
  ).toBe(true);
  expect(filteredRequests[0].searchParams.has("cursor")).toBe(false);
  expect(filteredRequests[1].searchParams.get("cursor")).toBe(cursor(2));
  // Native invalidity must not turn an incomplete optional date into an open bound.
  await startInput.evaluate((el: HTMLInputElement) => el.setCustomValidity("Complete the date"));
  const beforeInvalid = historyRequests.length;
  await apply.click();
  await expect(panel.getByRole("alert")).toHaveText(
    "Complete or clear invalid UTC dates before applying the period.",
  );
  expect(historyRequests).toHaveLength(beforeInvalid);
  await expect(panel.getByText("20001", { exact: true })).toBeVisible();
  await startInput.evaluate((el: HTMLInputElement) => el.setCustomValidity(""));
  await startInput.fill("2026-03-09");
  await throughInput.fill("2026-03-09");
  await apply.focus();
  await page.keyboard.press("Enter");
  await expect(apply).toBeFocused();
  await expect(panel.getByText("20001", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("20002", { exact: true })).toHaveCount(0);
  await expect(totals).toHaveCount(0);
  await expect.poll(() => periodGate.release !== undefined).toBe(true);
  periodGate.release!();
  await expect(panel.getByText("30001", { exact: true })).toBeVisible();
  await expect(apply).toBeFocused();
  expect(new URL(historyRequests.at(-1)!).searchParams.has("cursor")).toBe(false);
  await expect(panel.getByText(/completeness unknown/).first()).toBeVisible();
  await expect(
    panel
      .getByRole("region", { name: "Profit calculation availability" })
      .getByText("Unavailable", { exact: true }),
  ).toHaveCount(2);
  await panel.screenshot({ path: info.outputPath("history-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({ path: info.outputPath("history-mobile.png") });
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByLabel("Select an account").selectOption("account-b");
  await expect(panel.getByText(/No persisted records were returned/)).toBeVisible();
  await expect(totals.getByText(/Totals unavailable: no records loaded/)).toBeVisible();
  await expect(panel.getByText("10001", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/0 records in one page/)).toBeVisible();
  const admin = await context.newPage();
  await admin.goto(
    `/admin/account-observation?organization_id=${binding.organizationId}&credential_id=${binding.credentialId}&exchange_account_id=account-a`,
  );
  const adminPanel = admin.getByRole("region", { name: "Persisted financial history" });
  await expect(adminPanel.getByText("10001", { exact: true })).toBeVisible();
  await expect(
    admin.getByRole("region", { name: "HTX financial records", exact: true }),
  ).toBeVisible();
  denied = true;
  await adminPanel.getByRole("button", { name: "Refresh history" }).click();
  await expect(admin.getByText("Access revoked; account data cleared.")).toBeVisible();
  await expect(adminPanel).toHaveCount(0);
  await panel.getByRole("button", { name: "Refresh history" }).click();
  await expect(page.getByText("Access revoked; account data cleared.")).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(
    historyRequests.some(
      (url) =>
        url.includes("/admin/account-observation/financial-history") &&
        url.includes(`organizationId=${binding.organizationId}`),
    ),
  ).toBe(true);
  expect(
    historyRequests.every((url) => !/credentialRevision|configurationRevision|htxUid/.test(url)),
  ).toBe(true);
  expect(writes).toEqual([]);
  await info.attach("period-history-requests", {
    body: JSON.stringify({ historyRequests, writes }, null, 2),
    contentType: "application/json",
  });
  await admin.close();
});
