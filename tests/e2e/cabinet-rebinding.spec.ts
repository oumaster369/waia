import { expect, test } from "@playwright/test";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantTraderEntitlementByUserEmail } from "./helpers/trader-sqlite";
import { binding, observation, historyPage } from "../helpers/financial-history-ui-fixture";

test("mounted cabinet clears invalidated data and rediscovers only the current binding", async ({ page }, testInfo) => {
  const forbidden: string[] = [];
  const events: string[] = [];
  let lookups = 0, oldStreams = 0, freshObservations = 0;
  let naturalReady = false;
  const next = { ...binding, configurationRevision: "browser-next-3" };
  const oldId = "33333333-3333-4333-8333-333333333333";
  const newId = "55555555-5555-4555-8555-555555555555";
  const credential = {
    id: binding.credentialId, venue: "htx", exchangeAccountId: binding.exchangeAccountId,
    apiKeyMasked: "synthetic…fixture", status: "active", permissionMetadata: null,
    createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", revokedAt: null,
  };
  const json = (value: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "trader.localhost"].includes(url.hostname)) {
      forbidden.push(request.url()); await route.abort(); return;
    }
    const path = url.pathname;
    if (/^\/api\/trader\/(?:exchange-credentials\/(?:connect|replace|revoke)|orders?|trades?|live-enable)(?:\/|$)/i.test(path)) {
      forbidden.push(path); await route.abort(); return;
    }
    if (path === "/api/trader/exchange-credentials") { await route.fulfill(json({ credentials: [credential] })); return; }
    if (path === "/api/trader/account-observation/binding") {
      lookups++; events.push(`binding:${lookups}`);
      await route.fulfill(lookups === 2 ? { status: 204 } : json(lookups === 1 ? binding : next)); return;
    }
    if (path === "/api/trader/account-observation/financial-history") {
      events.push("history");
      await route.fulfill(json(historyPage(["10001"], null, naturalReady ? next : binding))); return;
    }
    if (path === "/api/trader/account-observation/stream") {
      if (url.searchParams.get("configurationRevision") === binding.configurationRevision) {
        oldStreams++;
        if (oldStreams > 1) {
          events.push("typed409");
          await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "ACCOUNT_OBSERVATION_BINDING_CHANGED" }) }); return;
        }
        events.push("old-observation");
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: observation\ndata: ${JSON.stringify(observation())}\n\n` }); return;
      }
      expect(url.searchParams.get("configurationRevision")).toBe(next.configurationRevision);
      if (!naturalReady) {
        events.push("new-missing");
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: "event: missing\ndata: null\n\n" }); return;
      }
      freshObservations++; events.push("new-natural-observation");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: observation\ndata: ${JSON.stringify({ ...observation(next), observationId: newId })}\n\n` }); return;
    }
    if (path.startsWith("/api/trader/account-observation")) { forbidden.push(path); await route.abort(); return; }
    await route.continue();
  });
  const email = `e2e-rebinding-${Date.now()}@example.com`;
  await signUpAndOpenDashboard(page, email, 30000);
  grantTraderEntitlementByUserEmail(email);
  await page.goto("/trader");
  await expect(page.getByTestId("trader-account-select")).toBeVisible();
  await page.getByTestId("trader-account-select").selectOption(binding.exchangeAccountId);
  await expect(page.getByText(oldId, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("-0.750000000000000001 USDT", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-old-observation-history.png"), fullPage: true });
  // Advance only browser time after the real mounted page has rendered its old evidence.
  await page.clock.install();
  await page.clock.runFor(5100);
  await expect.poll(() => events.includes("typed409")).toBe(true);
  await expect.poll(() => lookups).toBe(2);
  await expect(page.getByText(oldId, { exact: true })).toHaveCount(0);
  await expect(page.getByText("-0.750000000000000001 USDT", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("02-cleared-binding-204.png"), fullPage: true });
  await page.clock.runFor(5100);
  await expect.poll(() => lookups).toBe(3);
  await expect.poll(() => events.includes("new-missing")).toBe(true);
  await expect(page.getByText(oldId, { exact: true })).toHaveCount(0);
  await expect(page.getByText(newId, { exact: true })).toHaveCount(0);
  await expect(page.getByText("-0.750000000000000001 USDT", { exact: true })).toHaveCount(0);
  naturalReady = true;
  await page.clock.runFor(5100);
  await expect(page.getByText(newId, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("-0.750000000000000001 USDT", { exact: true })).toBeVisible();
  await expect(page.getByText(oldId, { exact: true })).toHaveCount(0);
  expect(lookups).toBe(3);
  expect(freshObservations).toBeGreaterThan(0);
  expect(forbidden).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("03-fresh-current-observation.png"), fullPage: true });
  await testInfo.attach("synthetic-boundary-proof", {
    contentType: "application/json", body: JSON.stringify({ events, lookups, oldStreams, freshObservations, forbidden, endpoints: "loopback only; observation/history/credential fixtures intercepted", providerCalls: 0, connectOrTradeCalls: 0 }, null, 2),
  });
});
