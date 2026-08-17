import { expect, test, type Page, type Route } from "@playwright/test";

import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { signUpAndOpenDashboard } from "./helpers/auth-dashboard";
import { grantPlatformAdminByUserEmail } from "./helpers/treasury-admin-sqlite";

const ORG_A = "11111111-1111-4111-a111-111111111111";
const ORG_B = "22222222-2222-4222-a222-222222222222";
const TX_REVIEW = "tx-needs-review";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

type FinanceCapture = {
  txListUrls: string[];
  txPosts: Array<Record<string, unknown>>;
};

async function installFinanceFixtures(page: Page): Promise<FinanceCapture> {
  let txStatus: "NEEDS_REVIEW" | "CLASSIFIED" | "VERIFIED" = "NEEDS_REVIEW";
  let publication: "PRIVATE" | "DETAIL_PUBLIC" = "PRIVATE";
  const capture: FinanceCapture = { txListUrls: [], txPosts: [] };

  await page.route("**/api/admin/treasury/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const pathname = url.pathname;
    let org = url.searchParams.get("organization_id");
    if (!org && (method === "POST" || method === "PATCH")) {
      const body = route.request().postDataJSON() as { organization_id?: string } | null;
      org = body?.organization_id ?? null;
    }

    if (pathname.endsWith("/organizations") && method === "GET") {
      await json(route, {
        organizations: [
          { id: ORG_A, name: "Treasury A", kind: "fund" },
          { id: ORG_B, name: "Treasury B", kind: "fund" },
        ],
      });
      return;
    }

    if (org === ORG_B) {
      await json(
        route,
        { error: { code: "FORBIDDEN", message: "Admin permission required." } },
        403,
      );
      return;
    }

    if (org !== ORG_A && !pathname.endsWith("/organizations")) {
      await json(
        route,
        {
          error: {
            code: "ORGANIZATION_ID_REQUIRED",
            message: "organization_id query param required.",
          },
        },
        400,
      );
      return;
    }

    if (pathname.endsWith("/breath-preview") && method === "GET") {
      await json(route, {
        preview: {
          status: "pending",
          lastUpdatedAt: null,
          stageLabel: null,
          work: null,
          methodologyNote: null,
          idealAnnualBudget: null,
          resources: {
            entered: "1000000",
            spent: "250000",
            remaining: "750000",
            allocated: "100000",
            neededNext: null,
          },
          currentFreeFunds: "650000",
          budget: {
            code: "OPS",
            title: "Operations",
            currency: "USD",
            planned: "5000000",
            funded: "1000000",
            committed: "100000",
            spent: "250000",
            remaining: "3750000",
            fillRatio: 0.2,
          },
          runway: { status: "pending" },
          recentActivity: [],
          pendingReasons: ["BREATH_DISABLED"],
          componentStatus: {
            breathEnabled: false,
            idealBudget: "missing",
            materialReconciliation: false,
            balanceReconciliation: "missing",
            budget: "ok",
            fundingNeed: "absent",
            verifiedFinancialComplete: true,
          },
          reconciliationGate: { latestId: null, status: null, createdAt: null },
          runwayStatus: { status: "pending", reason: "IDEAL_BUDGET_MISSING", snapshotId: null },
        },
      });
      return;
    }

    if (pathname.endsWith("/overview-counts") && method === "GET") {
      await json(route, { reviewRequiredCount: 1, publicationPendingCount: 1 });
      return;
    }

    if (pathname.endsWith("/settings") && method === "GET") {
      await json(route, {
        settings: {
          organizationId: ORG_A,
          breathEnabled: false,
          stageLabel: null,
          workSummary: null,
          methodologyNote: null,
          recentActivityLimit: 5,
          updatedAt: null,
        },
      });
      return;
    }

    if (pathname.endsWith("/transactions") && method === "GET" && !url.searchParams.get("id")) {
      capture.txListUrls.push(url.toString());
      await json(route, {
        transactions: [
          {
            id: TX_REVIEW,
            organizationId: ORG_A,
            status: txStatus,
            detailPublication: publication,
            provenance: "WATCHER",
            direction: "INFLOW",
            kind: "CONTRIBUTION",
            fundBucketCode: "UNASSIGNED",
            nativeAmountAtomic: "1000000",
            nativeDecimals: 6,
            nativeAsset: "USDT",
            accountingAmountMicros: "1000000",
            cashEffectMicros: "1000000",
            occurredAt: "2026-08-01T00:00:00.000Z",
            category: "grant",
            projectModule: "twin",
            canonicalNetwork: "TRC-20",
            canonicalTokenContract: "TUSDT",
            canonicalTxHash: "0xabc",
            txHash: "0xabc",
            publishCounterparty: false,
          },
        ],
      });
      return;
    }

    if (
      method === "GET" &&
      pathname.includes("/transactions/") &&
      !pathname.endsWith("/commands")
    ) {
      const id = pathname.split("/").pop() ?? TX_REVIEW;
      await json(route, {
        transaction: {
          id,
          organizationId: ORG_A,
          status: txStatus,
          detailPublication: publication,
          provenance: "WATCHER",
          direction: "INFLOW",
          kind: "CONTRIBUTION",
          fundBucketCode: "UNASSIGNED",
          nativeAmountAtomic: "1000000",
          nativeDecimals: 6,
          nativeAsset: "USDT",
          accountingAmountMicros: "1000000",
          cashEffectMicros: "1000000",
          occurredAt: "2026-08-01T00:00:00.000Z",
          canonicalNetwork: "TRC-20",
          canonicalTokenContract: "TUSDT",
          canonicalTxHash: "0xabc",
          canonicalTransferIndex: 0,
          publishCounterparty: false,
          publicDescription: null,
          counterpartyDisplay: null,
        },
        observations: [
          {
            id: "obs-1",
            organizationId: ORG_A,
            observationStatus: "CONFIRMED",
            confirmationsObserved: 20,
            confirmationsRequired: 19,
          },
        ],
        revisions: [
          {
            id: "rev-1",
            transactionId: TX_REVIEW,
            seq: 1,
            actorType: "admin",
            actorUserId: "user-a",
            reason: "classified",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        evidenceLinks: [],
        attributions: [],
      });
      return;
    }

    if (pathname.endsWith("/transactions/commands") && method === "POST") {
      const body = route.request().postDataJSON() as { command?: string };
      if (body.command === "classify") txStatus = "CLASSIFIED";
      if (body.command === "verify") txStatus = "VERIFIED";
      if (body.command === "set_detail_publication") publication = "DETAIL_PUBLIC";
      await json(route, {
        transaction: { id: TX_REVIEW, status: txStatus, detailPublication: publication },
      });
      return;
    }

    if (pathname.endsWith("/transactions") && method === "POST") {
      capture.txPosts.push(route.request().postDataJSON() as Record<string, unknown>);
      await json(route, {
        transaction: { id: "tx-manual", status: "MANUAL_DRAFT", detailPublication: "PRIVATE" },
      });
      return;
    }

    if (pathname.endsWith("/budgets") && method === "GET") {
      await json(route, {
        budgets: [
          {
            id: "b1",
            organizationId: ORG_A,
            code: "OPS",
            title: "Operations",
            periodStart: "2026-01-01",
            periodEnd: "2026-12-31",
            currency: "USD",
            plannedAmountMicros: "5000000",
            status: "ACTIVE",
            isPublic: false,
            funded: "1000000",
            committed: "100000",
            spent: "250000",
            remaining: "-1",
          },
        ],
      });
      return;
    }

    if (pathname.endsWith("/funding-needs") && method === "GET") {
      await json(route, {
        fundingNeeds: [
          {
            id: "n1",
            organizationId: ORG_A,
            title: "Stage one",
            targetStage: "MVP",
            requiredAmountMicros: "8000000",
            currency: "USD",
            status: "OPEN",
            isPublic: false,
            funded: "1000000",
            remaining: "7000000",
          },
        ],
      });
      return;
    }

    if (pathname.endsWith("/commitments") && method === "GET") {
      await json(route, {
        commitments: [
          {
            id: "c1",
            organizationId: ORG_A,
            status: "APPROVED",
            amountMicros: "100000",
            currency: "USD",
            purpose: "Vendor retain",
            detailPublication: "PRIVATE",
            publishCounterparty: false,
          },
        ],
      });
      return;
    }

    if (pathname.endsWith("/commitments/commands") && method === "POST") {
      await json(route, { commitment: { id: "c1", status: "RELEASED" } });
      return;
    }

    if (pathname.endsWith("/evidence") && method === "GET") {
      await json(route, {
        evidence: [
          {
            id: "ev1",
            organizationId: ORG_A,
            kind: "RECEIPT",
            visibility: "ADMIN_ONLY",
            mediaType: "application/pdf",
            byteSize: "12",
            sha256: "abc",
            source: "upload",
            storageBackend: null,
            uploadedByUserId: "user-a",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      });
      return;
    }

    if (pathname.includes("/evidence/") && pathname.endsWith("/content")) {
      await json(
        route,
        {
          error: {
            code: "EVIDENCE_STORAGE_NOT_CONFIGURED",
            message: "Evidence object storage is not configured",
          },
        },
        503,
      );
      return;
    }

    await json(route, { error: { code: "NOT_MOCKED", message: pathname } }, 500);
  });
  return capture;
}

test.describe("WAIA Admin Finance Console", () => {
  test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
    await page.goto("/finance");
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("landing-auth")).toBeVisible();
  });

  test("authenticated non-admin is fail-closed", async ({ page }) => {
    const email = `e2e-finance-deny-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    await page.goto("/finance");
    await expect(page.getByTestId("finance-forbidden")).toBeVisible();
  });

  test("platform admin sees sqlite backend unavailable truthfully", async ({ page }) => {
    const email = `e2e-finance-sqlite-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    const { userId } = grantPlatformAdminByUserEmail(email);
    await page.goto("/finance");
    await expect(page.getByTestId("finance-nav")).toBeVisible();
    await page
      .getByTestId("finance-org-select")
      .selectOption(personalOrganizationIdFromUserId(userId));
    await expect(page.getByTestId("finance-unavailable")).toBeVisible();
    await expect(page.getByTestId("finance-unavailable")).toContainText("Postgres");
  });

  test("complete Human workflow against DEE-615 contracts", async ({ page }) => {
    const email = `e2e-finance-flow-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    grantPlatformAdminByUserEmail(email);
    const capture = await installFinanceFixtures(page);

    await page.goto("/finance");
    await page.getByTestId("finance-org-select").selectOption(ORG_A);
    await expect(page.getByTestId("finance-overview")).toBeVisible();
    await expect(page.getByTestId("review-required-count")).toContainText("1");
    await expect(page.getByTestId("publication-pending-count")).toContainText("1");
    await expect(page.getByTestId("watcher-dark")).toBeVisible();

    await page.getByRole("link", { name: "Transactions" }).click();
    await expect(page.getByTestId("finance-transaction-table")).toBeVisible();
    await expect(page.getByTestId("add-manual-transaction")).toBeVisible();
    await expect(page.getByTestId("tx-filter-panel")).toContainText("Filter transactions");
    await expect(page.getByTestId("tx-filter-panel")).toContainText("existing ledger records");
    await expect(page.getByTestId("tx-filter-status")).toBeVisible();
    await expect(page.getByTestId("tx-filter-direction")).toBeHidden();
    await page.getByTestId("tx-filter-advanced").locator("summary").click();
    await page.getByTestId("tx-filter-direction").selectOption("INFLOW");
    await page.getByTestId("tx-filter-panel").getByRole("button", { name: "Apply" }).click();
    await expect
      .poll(() => capture.txListUrls.some((url) => url.includes("direction=INFLOW")))
      .toBe(true);
    await expect
      .poll(() => capture.txListUrls.some((url) => url.includes(`organization_id=${ORG_A}`)))
      .toBe(true);
    await page.getByRole("link", { name: /2026-08-01/ }).click();

    await expect(page.getByTestId("tx-next-action")).toBeVisible();
    await expect(page.getByTestId("zone-provenance")).toBeVisible();
    await expect(page.getByTestId("zone-accounting")).toBeVisible();
    await expect(page.getByTestId("detail-public-hidden")).toBeVisible();
    await expect(page.getByTestId("classify-purpose")).toBeVisible();
    await expect(page.getByTestId("classify-category")).toBeHidden();
    await page.getByTestId("classify-advanced").locator("summary").click();
    await page.getByTestId("classify-category").fill("grant-custom");
    await page.getByTestId("classify-purpose").fill("custom purpose");
    await page.getByTestId("tx-action-classify").click();
    await page.getByTestId("finance-confirm-reason").fill("Classify contribution");
    await page.getByTestId("finance-confirm-submit").click();

    await expect(page.getByTestId("tx-action-verify")).toBeVisible();
    await page.getByTestId("tx-action-verify").click();
    await page.getByTestId("finance-confirm-reason").fill("Verify after evidence");
    await page.getByTestId("finance-confirm-submit").click();

    await expect(page.getByTestId("detail-public-controls")).toBeVisible();
    await expect(page.getByTestId("verified-private-valid")).toBeVisible();
    await page.getByRole("button", { name: "Set publication" }).click();
    await page.getByTestId("finance-confirm-reason").fill("Publish public detail");
    await page.getByTestId("finance-confirm-submit").click();

    await page.getByRole("link", { name: "Publication preview" }).click();
    await expect(page.getByTestId("public-view")).toBeVisible();
    await expect(page.getByTestId("operator-diagnostics")).toBeVisible();

    await page.getByRole("link", { name: "Transactions" }).click();
    await page.getByTestId("add-manual-transaction").click();
    await expect(page.getByTestId("manual-transaction-form")).toContainText("MANUAL_DRAFT");
    await expect(page.getByTestId("manual-transaction-form")).toContainText("PRIVATE");
    await expect(page.getByTestId("manual-kind")).toHaveValue("");
    await page.getByTestId("manual-direction").selectOption("INFLOW");
    await page.getByTestId("manual-amount").fill("1");
    await page.getByTestId("manual-occurred-at").fill("2026-08-02T00:00");
    await page.getByTestId("manual-purpose").fill("Walkthrough purpose");
    await expect(page.getByTestId("manual-budget")).toBeHidden();
    await page.getByTestId("manual-more-details").locator("summary").click();
    await page.getByTestId("manual-budget").selectOption("b1");
    await page.getByTestId("manual-funding-need").selectOption("n1");
    await expect(page.getByTestId("transaction-ref-pagination-note")).toContainText("paginated");
    await page.getByTestId("manual-create-draft").click();
    await page.getByTestId("finance-confirm-reason").fill("Manual inflow");
    await page.getByTestId("finance-confirm-submit").click();
    await expect.poll(() => capture.txPosts.length).toBeGreaterThan(0);
    const created = capture.txPosts.at(-1);
    expect(created).toMatchObject({
      organization_id: ORG_A,
      direction: "INFLOW",
      kind: null,
      native_amount_atomic: "1000000",
      native_decimals: 6,
      native_asset: "USDT",
      purpose: "Walkthrough purpose",
      budget_id: "b1",
      funding_need_id: "n1",
    });
    expect(created).not.toHaveProperty("category");
    expect(String(created?.occurred_at ?? "")).toMatch(/Z$/);

    await page.getByRole("link", { name: "Budgets" }).click();
    await expect(page.getByTestId("money-negative")).toBeVisible();
    await page.getByRole("link", { name: "Funding needs" }).click();
    await expect(page.getByTestId("finance-funding-needs")).toBeVisible();
    await page.getByRole("link", { name: "Commitments" }).click();
    await expect(page.getByTestId("finance-commitments")).toContainText(
      "Reduces current free funds",
    );
    await page.getByRole("link", { name: "Evidence" }).click();
    await page.getByRole("button", { name: "Open private content" }).click();
    await expect(page.getByTestId("evidence-storage-unavailable")).toBeVisible();

    await page.getByTestId("finance-org-select").selectOption(ORG_B);
    await expect(page.getByTestId("finance-unavailable")).toContainText(
      "Admin permission required",
    );
  });
});
