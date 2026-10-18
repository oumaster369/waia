import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { signInOnLanding } from "./helpers/trader-host-auth";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const TRADER_PASSWORD = "password123!";
const SCREENS = [
  "/admin",
  "/admin/accounts",
  "/admin/orders",
  "/admin/clients",
  "/admin/strategies",
  "/admin/research",
  "/admin/errors",
  "/admin/system",
];

test("invoice confirmations belong to the selected invoice", async ({ page, baseURL, browser }) => {
  const email = `console-confirm-${crypto.randomUUID()}@waia.local`;
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
  const invoices = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ].map((id) => ({
    id,
    revision: id,
    organizationId: "33333333-3333-4333-8333-333333333333",
    performanceFee: "10",
    currency: "USDT",
    display: { status: "Черновик", payment: null },
  }));
  const envelope = (requestUrl: string, data: unknown) => {
    const query = new URL(requestUrl).searchParams;
    return {
      schemaVersion: "admin-console/v1",
      generatedAt: new Date().toISOString(),
      revision: "read-revision",
      scope: { kind: "fleet" },
      mode: query.get("mode") ?? "all",
      coverage: null,
      missingSources: [],
      data,
    };
  };
  await page.route(/\/api\/trader\/admin\/console\/invoices(?:\?|$)/, (route) =>
    route.fulfill({
      json: envelope(route.request().url(), {
        items: invoices.map((row) => ({
          ...row,
          status: "DRAFT",
          display: { ...row.display, flags: [] },
        })),
        aggregate: [{ currency: "USDT", amount: "20", count: 2 }],
        total: 2,
        truncated: false,
      }),
    }),
  );
  await page.route(/\/api\/trader\/admin\/console\/invoices\/[^/?]+(?:\?|$)/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const row = invoices.find((item) => item.id === id)!;
    return route.fulfill({
      json: envelope(route.request().url(), {
        ...row,
        status: "DRAFT",
        approvedAt: null,
        coolingOffUntil: null,
        issuedAt: null,
        paidAt: null,
        display: { ...row.display, flags: [] },
        stored: {
          billable: true,
          performanceFee: "10",
          periodProfit: "100",
          cumulative: "100",
          previousHwm: "0",
          newProfitAboveHwm: "100",
          feeRate: "0.3",
        },
        chain: { ok: null, reasons: ["PREVIOUS_PERIOD_EVIDENCE_MISSING"] },
      }),
    });
  });
  let commands = 0;
  page.on("request", (request) => {
    if (request.url().includes("/commands") && request.method() === "POST") commands++;
  });
  await signInOnLanding(page, email, TRADER_PASSWORD);
  await page.waitForURL("**/trader");
  await page.goto("/admin/clients?tab=invoices");
  await page.getByRole("button", { name: new RegExp(invoices[0]!.id) }).click();
  const approve = page.getByRole("button", { name: "Confirm issuance" });
  await expect(approve).toBeDisabled();
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await expect(approve).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(invoices[1]!.id) }).click();
  await expect(approve).toBeDisabled();
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
  expect(commands).toBe(0);
});

test("admin console main screens have no serious accessibility violations", async ({
  page,
  baseURL,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const email = `console-a11y-${crypto.randomUUID()}@waia.local`;
  const primary = await browser.newContext({
    baseURL: baseURL?.replace("trader.localhost", "127.0.0.1") ?? "http://127.0.0.1:3199",
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
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(
      page.getByRole("navigation", { name: "AI-TRADER admin console" }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious, path).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${path.replaceAll("/", "-")}-desktop.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Search console" }).click();
  await expect(page.getByRole("dialog", { name: "Go to section" })).toBeVisible();
  await page.getByPlaceholder("Section name…").fill("Research");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/research/);
  await expect(page.getByRole("dialog", { name: "Go to section" })).not.toBeVisible();
  await page.getByRole("tab", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/tab=runs/);
  await page.getByRole("tab", { name: "Hypotheses and knowledge", exact: true }).click();
  await expect(page).toHaveURL(/tab=knowledge/);
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Runs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("navigation", { name: "AI-TRADER admin console" })
    .getByRole("link", { name: "Accounts", exact: true })
    .click();
  await expect(page).toHaveURL(/mode=history/);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: testInfo.outputPath("admin-compact.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
