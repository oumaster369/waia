import { expect, test, type Page } from "@playwright/test";
import type { HistoricalObservableCycleV2, HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

// Browser presentation fixtures only. These do not qualify the trading graph,
// production authority, tenant RLS or economic/scientific performance.
const runId = "e2e-observation-only";
const accountId = "modeled-account";
const organizationId = "selected-org";
function projection(count: number): HistoricalObservableProjectionV2 {
  const history: HistoricalObservableCycleV2[] = Array.from({ length: count }, (_, i) => ({
    accountId, cycleSequence: i, cycleId: `cycle-${i}`, symbol: "BTCUSDT", partition: "DEVELOPMENT",
    replayBarClosedAtUtc: `2024-01-01T00:0${i}:00.000Z`, cash: "50", equity: String(100 + i * 5),
    netPnl: String(i * 5), grossRealizedPnl: "0", netRealizedPnl: "0", netUnrealizedPnl: String(i * 5),
    buyAndHoldGrossEquity: "100", strategyMinusBuyAndHoldGross: String(i * 5),
    buyAndHoldConvention: "GROSS_MARK_TO_MARKET_NO_FEES", openPositionsCount: 1,
    decisionsCount: 1, riskVetoCount: 0, ordersCount: 1, fillsCount: 1,
    lastForecast: { reasonCodes: [`FORECAST_CYCLE_${i}`] }, lastDecision: { action: "HOLD" },
    lastPortfolio: { reasonCodes: ["PORTFOLIO_MODELED"] }, lastRisk: { verdict: "ALLOW_MODELED" },
    lastExecution: { status: "MODELED" }, lastAccounting: { cash: "50", equity: String(100 + i * 5), positions: { BTCUSDT: { quantity: "0.001" } } },
    lastGuardian: { verdict: "OBSERVATION_ONLY" }, lastLearning: { reasonCodes: ["EVIDENCE_ONLY"] },
    observedExecutionEffects: [{ reasonCodes: ["MODELED_FILL"] }], modeledRealityArtifacts: [], knowledgeArtifacts: [],
    stages: [], snapshots: [], checkpoint: null, ledgerHeadContentDigestHex: "a".repeat(64),
  }));
  return { schemaVersion: "waia.trader.historical_observable_read_model.v2", mode: "HISTORICAL_SIMULATION",
    capitalEligible: false, organizationId, runId, eventId: String(count), observedAt: "2026-09-05T23:00:00.000Z",
    lifecycle: { phase: "RUNNING", qualifiedTotalCycles: 3, committedCycles: count, remainingCycles: 3-count,
      progressBps: Math.floor(count/3*10_000), nextCycleSequence: count, latestCommittedCycleId: `cycle-${count-1}`,
      observedAt: "2026-09-05T23:00:00.000Z", errorCode: null, contentDigestHex: "b".repeat(64) },
    accounts: [{ ...history[count-1], history }],
    aggregate: { accountCount: 1, cash: "50", equity: String(100+(count-1)*5), netPnl: String((count-1)*5),
      buyAndHoldGrossEquity: "100", strategyMinusBuyAndHoldGross: String((count-1)*5), cycles: count,
      decisions: count, riskVetoes: 0, orders: count, fills: count, processedRecords: count,
      latestCycleSequence: count-1, qualifiedTotalCycles: 3, committedCycles: count, progressBps: Math.floor(count/3*10_000), runPhase: "RUNNING" } };
}
async function installPresentationTransport(page: Page) {
  await page.addInitScript(() => {
    class PresentationEventSource extends EventTarget {
      onerror: (() => void) | null = null;
      listener = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail.kind === "error") this.onerror?.();
        else this.dispatchEvent(new MessageEvent(detail.kind, { data: JSON.stringify(detail.body) }));
      };
      constructor(public url: string) { super(); window.addEventListener("e2e-observation", this.listener); }
      close() { window.removeEventListener("e2e-observation", this.listener); }
    }
    Object.defineProperty(window, "EventSource", { value: PresentationEventSource });
  });
  await page.route("**/api/trader/admin/organizations", route => route.fulfill({ json: { organizations: [
    { id: "other-org", name: "Other fixture", kind: "personal" },
    { id: organizationId, name: "Selected fixture", kind: "personal" },
  ] } }));
}
async function emit(page: Page, kind: string, body: unknown = {}) {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent("e2e-observation", { detail })), { kind, body });
}

test("paired admin and tenant render updates, scoped links and polling recovery", async ({ page, context, baseURL }) => {
  const origin = baseURL!.replace("127.0.0.1", "trader.localhost");
  const tenant = await context.newPage();
  for (const surface of [page, tenant]) await installPresentationTransport(surface);
  await page.goto(`${origin}/admin/fhv-operations?campaign_run_id=${runId}&organization_id=${organizationId}`);
  await expect(page.getByTestId("admin-org-select")).toHaveValue(organizationId);
  await expect(page.getByText("Connecting to Historical V2…")).toBeVisible();
  await tenant.goto(`${origin}/trader?campaign_run_id=${runId}&account_id=${accountId}`);
  await expect(tenant.getByText("Connecting to Historical V2…")).toBeVisible();
  for (const surface of [page, tenant]) {
    await emit(surface, "historical.snapshot", projection(2));
    await expect(surface.getByRole("img", { name: "Equity committed history", exact: true })).toBeVisible();
    await expect(surface.getByRole("img", { name: "Net P&L committed history", exact: true })).toBeVisible();
    await expect(surface.getByRole("img", { name: "Observed-history drawdown committed history", exact: true })).toBeVisible();
    await expect(surface.getByText("BTCUSDT: qty 0.001", { exact: true })).toBeVisible();
    await expect(surface.getByText("Qualified progress · 2 / 3 cycles")).toBeVisible();
    await expect(surface.getByText(/Transport: SSE/)).toBeVisible();
    await emit(surface, "historical.snapshot", projection(3));
    await expect(surface.getByText("Qualified progress · 3 / 3 cycles")).toBeVisible();
    await expect(surface.getByText("Complete reason journal · 3 committed cycles")).toBeVisible();
    await expect(surface.getByRole("img", { name: "Equity committed history", exact: true }).locator(":scope > title")).toHaveText(/3 committed observations, 100 to 110/);
    await emit(surface, "historical.snapshot", projection(3));
    await expect(surface.getByText("Complete reason journal · 3 committed cycles")).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Open account-scoped user observation" })).toHaveAttribute("href", `/trader?campaign_run_id=${runId}&account_id=${accountId}`);
  await expect(tenant.getByRole("link", { name: "Open account-scoped user observation" })).toHaveCount(0);
  for (const surface of [page, tenant]) {
    await surface.route("**/api/trader/**/historical-v2/stream?**", route => route.fulfill({ status: 503, json: { error: "offline" } }));
    // Tenant path has no admin segment.
    await surface.route("**/api/trader/historical-v2/stream?**", route => route.fulfill({ status: 503, json: { error: "offline" } }));
    await emit(surface, "error");
    await expect(surface.getByText("Reconnecting…", { exact: true })).toBeVisible();
    await expect(surface.getByText(/Transport: polling/)).toBeVisible();
    await expect(surface.getByText("Qualified progress · 3 / 3 cycles")).toBeVisible();
    await surface.route("**/api/trader/**historical-v2/stream?**", route => route.fulfill({ json: projection(3) }));
    await expect(surface.getByText("RUNNING · observed", { exact: true })).toBeVisible({ timeout: 10_000 });
  }
  await page.screenshot({ path: "test-results/historical-v2-admin.png", fullPage: true });
  await tenant.setViewportSize({ width: 390, height: 844 });
  expect(await tenant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tenant.screenshot({ path: "test-results/historical-v2-tenant-mobile.png", fullPage: true });
});

test("unknown requested organization cannot silently observe the first org", async ({ page, baseURL }) => {
  await installPresentationTransport(page);
  await page.goto(`${baseURL!.replace("127.0.0.1", "trader.localhost")}/admin/fhv-operations?campaign_run_id=${runId}&organization_id=not-authorized`);
  await expect(page.getByText("Requested organization is not available. Select an authorized organization.")).toBeVisible();
  await expect(page.getByTestId("historical-v2-streaming-dashboard")).toHaveCount(0);
  await expect(page.getByText("Connecting to Historical V2…")).toHaveCount(0);
  await expect(page.getByTestId("historical-ratification-ceremony-v2")).toHaveCount(0);
});
