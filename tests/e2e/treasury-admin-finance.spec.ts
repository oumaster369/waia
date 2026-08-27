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
  categoryPosts: Array<Record<string, unknown>>;
  catalogListUrls: string[];
  assistantPlanPosts: Array<Record<string, unknown>>;
  assistantExecutePosts: Array<Record<string, unknown>>;
  watchedAddressPosts: Array<Record<string, unknown>>;
};

async function installFinanceFixtures(page: Page): Promise<FinanceCapture> {
  let txStatus: "NEEDS_REVIEW" | "CLASSIFIED" | "VERIFIED" = "NEEDS_REVIEW";
  let publication: "PRIVATE" | "DETAIL_PUBLIC" = "PRIVATE";
  const capture: FinanceCapture = {
    txListUrls: [],
    txPosts: [],
    categoryPosts: [],
    catalogListUrls: [],
    assistantPlanPosts: [],
    assistantExecutePosts: [],
    watchedAddressPosts: [],
  };

  await page.route("**/api/health/treasury-watcher", async (route) => {
    await json(route, {
      ok: true,
      state: "READY_DARK",
      enabled: false,
      organizationIdPresent: true,
      databasePresent: true,
      primaryKeyPresent: true,
      secondaryConfigured: true,
      ready: true,
      checkpoint: null,
    });
  });

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

    if (pathname.endsWith("/fund-allocation") && method === "GET") {
      await json(route, {
        allocation: {
          status: "available",
          currency: "USD",
          canonicalFreeFundsMicros: "25000000",
          protectedAnnualBudgetMicros: "12000000",
          operatingAllocationMicros: "12000000",
          developmentAllocationMicros: "13000000",
          policyCode: "ANNUAL_BUDGET_THEN_DEVELOPMENT",
          policyVersion: 1,
          accountingAsOf: "2026-08-24T12:00:00.000Z",
        },
      });
      return;
    }

    if (pathname.endsWith("/assistant/plan") && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      capture.assistantPlanPosts.push(body);
      if (String(body.message).toLowerCase().includes("project")) {
        await json(route, {
          mode: "write_preview",
          summary: "Create project Breath of WAIA.",
          intent: "CREATE_PROJECT",
          fields: { name: "Breath of WAIA" },
          confirmationAvailable: true,
          confirmationToken: "e2e-confirmation-token",
          notice: "Nothing has been created yet.",
        });
      } else {
        await json(route, {
          mode: "report",
          summary: "Current Finance overview.",
          report: {
            kind: "overview",
            title: "Finance overview",
            generatedAt: "2026-08-24T12:00:00.000Z",
            data: { availableAmountMicros: "25000000", reviewRequiredCount: 1 },
          },
        });
      }
      return;
    }

    if (pathname.endsWith("/assistant/execute") && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      capture.assistantExecutePosts.push(body);
      await json(route, {
        mode: "write_result",
        intent: "CREATE_PROJECT",
        entityType: "project",
        entity: { id: "project-assistant", name: "Breath of WAIA" },
        notice: "The confirmed record was created.",
      });
      return;
    }

    if (pathname.endsWith("/watched-addresses") && method === "GET") {
      await json(route, {
        watchedAddresses: [
          {
            id: "wallet-1",
            organizationId: ORG_A,
            network: "TRC-20",
            address: "TXyz4NxVbubnKoh6vzPddVhJx1jWeF8A4D",
            tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            assetCode: "USDT",
            directionScope: "BOTH",
            includeInBalanceRecon: true,
            label: "WAIA USDT wallet",
            isActive: true,
            createdAt: "2026-08-24T12:00:00.000Z",
            updatedAt: "2026-08-24T12:00:00.000Z",
          },
        ],
      });
      return;
    }

    if (pathname.endsWith("/watched-addresses") && method === "POST") {
      capture.watchedAddressPosts.push(route.request().postDataJSON() as Record<string, unknown>);
      await json(route, { watchedAddress: { id: "wallet-new" } });
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

    if (pathname.endsWith("/counterparties") && method === "GET") {
      capture.catalogListUrls.push(url.toString());
      if (url.searchParams.get("id")) {
        await json(route, {
          counterparty: {
            id: "cp-1",
            organizationId: ORG_A,
            displayName: "WAIA Patron",
            waiaUserId: null,
            waiaUsername: "patron",
            websiteUrl: "https://example.com",
            email: "patron@example.com",
            phone: "+1 555 0100",
            paymentInstructions: "USDT TRC-20",
            isActive: true,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
        });
        return;
      }
      await json(route, {
        counterparties: [
          { id: "cp-1", displayName: "WAIA Patron", waiaUsername: "patron", isActive: true },
        ],
        next: null,
      });
      return;
    }

    if (pathname.endsWith("/accounts") && method === "GET") {
      capture.catalogListUrls.push(url.toString());
      if (url.searchParams.get("id")) {
        await json(route, {
          account: {
            id: "account-1",
            organizationId: ORG_A,
            displayName: "USDT TRC-20",
            kind: "CRYPTO_WALLET",
            currency: "USDT",
            network: "TRC-20",
            address: "TWalkthrough",
            maskedRequisites: null,
            watchedAddressId: null,
            isActive: true,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
        });
        return;
      }
      await json(route, {
        accounts: [
          {
            id: "account-1",
            displayName: "USDT TRC-20",
            kind: "CRYPTO_WALLET",
            currency: "USDT",
            network: "TRC-20",
            isActive: true,
          },
          {
            id: "account-2",
            displayName: "Visa debit",
            kind: "BANK_CARD",
            currency: "USD",
            network: null,
            isActive: true,
          },
        ],
        next: null,
      });
      return;
    }

    if (pathname.endsWith("/categories") && method === "GET") {
      await json(route, {
        categories: [
          {
            id: "category-1",
            organizationId: ORG_A,
            code: "OPS",
            name: "Operations",
            groupName: "Office",
            description: null,
            monthlyBudgetMicros: "5000000",
            currency: "USD",
            isActive: true,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        next: null,
      });
      return;
    }

    if (pathname.endsWith("/projects") && method === "GET") {
      capture.catalogListUrls.push(url.toString());
      const project = {
        id: "project-1",
        organizationId: ORG_A,
        name: "WAIA Core",
        description: "Core module",
        startsOn: "2026-01-01",
        endsOn: null,
        isActive: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      };
      if (url.searchParams.get("id")) {
        await json(route, { project });
        return;
      }
      await json(route, {
        projects: [project],
        next: null,
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
            signedAmountMicros: "1000000",
            counterpartyId: "cp-1",
            accountId: "account-1",
            categoryId: "category-1",
            projectId: "project-1",
            occurredAt: "2026-08-01T00:00:00.000Z",
            category: "grant",
            projectModule: "twin",
            canonicalNetwork: "TRC-20",
            canonicalTokenContract: "TUSDT",
            canonicalTxHash: "a".repeat(64),
            txHash: "a".repeat(64),
            publishCounterparty: false,
            internalNotes: "Patron transfer",
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
          signedAmountMicros: "1000000",
          counterpartyId: "cp-1",
          accountId: "account-1",
          categoryId: "category-1",
          projectId: "project-1",
          occurredAt: "2026-08-01T00:00:00.000Z",
          canonicalNetwork: "TRC-20",
          canonicalTokenContract: "TUSDT",
          canonicalTxHash: "a".repeat(64),
          canonicalTransferIndex: 0,
          publishCounterparty: false,
          publicDescription: null,
          counterpartyDisplay: null,
          internalNotes: "Patron transfer",
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

    if (pathname.endsWith("/category-budgets") && method === "GET") {
      const month = {
        month: "2026-08",
        categories: [
          {
            categoryId: "category-1",
            code: "OPS",
            name: "Operations",
            groupName: "Office",
            currency: "USD",
            budgetMicros: "5000000",
            spentMicros: "6000000",
            remainingMicros: "-1000000",
            isActive: true,
          },
        ],
        groups: [
          {
            groupName: "Office",
            currency: "USD",
            budgetMicros: "5000000",
            spentMicros: "6000000",
            remainingMicros: "-1000000",
          },
        ],
        totals: [
          {
            currency: "USD",
            budgetMicros: "5000000",
            spentMicros: "6000000",
            remainingMicros: "-1000000",
          },
        ],
      };
      if (url.searchParams.get("year")) {
        await json(route, {
          annual: {
            year: Number(url.searchParams.get("year")),
            totals: month.totals,
            months: [month],
          },
        });
      } else {
        await json(route, { month });
      }
      return;
    }

    if (pathname.endsWith("/categories") && method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      capture.categoryPosts.push(body);
      await json(route, {
        category: {
          id: "category-new",
          organizationId: ORG_A,
          code: "DEVELOPMENT",
          name: body.name,
          groupName: body.group_name,
          description: body.description,
          monthlyBudgetMicros: body.monthly_budget_micros,
          currency: body.currency,
          isActive: true,
          createdAt: "2026-08-22T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
        },
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

    if (
      ["/counterparties", "/accounts", "/projects"].some((suffix) => pathname.endsWith(suffix)) &&
      (method === "POST" || method === "PATCH")
    ) {
      const singular = pathname.split("/").pop()!.replace(/ies$/, "y").replace(/s$/, "");
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await json(route, {
        [singular]: { id: String(body.id ?? `${singular}-new`), ...body, isActive: true },
      });
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

  test("complete Human workflow against DEE-672 Finance contracts", async ({ page }) => {
    const email = `e2e-finance-flow-${Date.now()}@example.com`;
    await signUpAndOpenDashboard(page, email);
    grantPlatformAdminByUserEmail(email);
    const capture = await installFinanceFixtures(page);

    await page.goto("/waia-admin");
    await expect(page.getByTestId("waia-admin-finance-module")).toBeVisible();
    await page.getByRole("link", { name: "Open Finance" }).click();
    await page.getByTestId("finance-org-select").selectOption(ORG_A);
    await expect(page.getByTestId("finance-overview")).toBeVisible();
    await expect(page.getByTestId("review-required-count")).toContainText("1 transaction");
    await expect(page.getByTestId("finance-overview")).toContainText("Available now");
    await expect(page.getByTestId("finance-overview")).toContainText("Runway");
    await expect(page.getByTestId("finance-overview")).toContainText("Annual budget");
    await page.getByTestId("overview-operational-details").locator("summary").click();
    await expect(page.getByTestId("watcher-dark")).toBeVisible();

    const financeNav = page.getByTestId("finance-nav");
    await expect(financeNav.getByRole("link")).toHaveCount(7);
    await expect(financeNav.locator('[data-nav-level="primary"]')).toHaveCount(3);
    await expect(financeNav.locator('[data-nav-level="secondary"]')).toHaveCount(4);
    await expect(financeNav).toContainText("Overview");
    await expect(financeNav).toContainText("Transactions");
    await expect(financeNav).toContainText("Budget");
    await expect(financeNav).toContainText("Counterparties");
    await expect(financeNav).toContainText("Accounts");
    await expect(financeNav).toContainText("Projects");
    await expect(financeNav).toContainText("Wallet");
    await expect(page.getByRole("link", { name: "Admin home" })).toHaveAttribute(
      "href",
      "/waia-admin",
    );

    await page.getByRole("button", { name: "Ask Finance" }).click();
    await page.getByLabel("Request").fill("Show the current overview");
    await page
      .getByTestId("finance-assistant")
      .getByRole("button", { name: "Ask Finance" })
      .click();
    await expect(page.getByTestId("finance-assistant")).toContainText("Finance overview");
    await expect(page.getByTestId("finance-assistant")).toContainText("25");
    await page.getByLabel("Request").fill("Create project Breath of WAIA");
    await page
      .getByTestId("finance-assistant")
      .getByRole("button", { name: "Ask Finance" })
      .click();
    await expect(page.getByRole("button", { name: "Confirm and create" })).toBeVisible();
    await expect(page.getByTestId("finance-assistant")).not.toContainText("e2e-confirmation-token");
    await page.getByRole("button", { name: "Confirm and create" }).click();
    await expect(page.getByTestId("finance-assistant")).toContainText("Created Project");
    await expect.poll(() => capture.assistantPlanPosts.length).toBe(2);
    await expect.poll(() => capture.assistantExecutePosts.length).toBe(1);
    await page.getByRole("button", { name: "Close Finance Assistant" }).click();

    await page.getByRole("link", { name: "Wallet", exact: true }).click();
    await expect(page.getByTestId("finance-wallet-observer")).toContainText("READY DARK");
    await expect(page.getByTestId("finance-wallet-observer")).toContainText("Primary ready");
    await expect(page.getByRole("link", { name: "Open in TronScan" })).toHaveAttribute(
      "href",
      "https://tronscan.org/#/address/TXyz4NxVbubnKoh6vzPddVhJx1jWeF8A4D",
    );
    await expect(page.getByTestId("finance-wallet-observer")).toContainText(
      "never starts observation",
    );

    await page.getByRole("link", { name: "Transactions", exact: true }).click();
    await expect(page.getByTestId("finance-transaction-table")).toBeVisible();
    await expect(page.getByTestId("add-manual-transaction")).toBeVisible();
    await expect(page.getByTestId("tx-filter-status")).toBeVisible();
    await expect(page.getByText("Direction", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("finance-transaction-table").locator("thead th")).toHaveText([
      "Counterparty",
      "Category",
      "Amount",
      "Status",
      "Date & time",
      "Project",
      "Notes",
      "Review",
    ]);
    await expect(page.getByRole("columnheader", { name: "Account" })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: /WAIA Patron/ })).toBeVisible();
    await page.getByTestId("tx-filter-advanced").locator("summary").click();
    await page.getByTestId("tx-filter-status").selectOption("NEEDS_REVIEW");
    await page.getByTestId("tx-filter-panel").getByRole("button", { name: "Apply" }).click();
    await expect
      .poll(() => capture.txListUrls.some((url) => url.includes("status=NEEDS_REVIEW")))
      .toBe(true);
    await expect
      .poll(() => capture.txListUrls.some((url) => url.includes(`organization_id=${ORG_A}`)))
      .toBe(true);
    await page.getByRole("link", { name: "Review" }).click();

    await expect(page.getByTestId("tx-next-action")).toBeVisible();
    await expect(page.getByTestId("zone-provenance")).toBeVisible();
    await expect(page.getByTestId("zone-accounting")).toBeVisible();
    await expect(page.getByTestId("detail-public-hidden")).toBeVisible();
    await page.getByText("Technical identifiers").click();
    await expect(page.getByRole("link", { name: "Open in TronScan" })).toHaveAttribute(
      "href",
      `https://tronscan.org/#/transaction/${"a".repeat(64)}`,
    );
    await expect(page.getByTestId("classify-purpose")).toBeHidden();
    await expect(page.getByTestId("classify-category")).toBeHidden();
    await page.getByTestId("classify-advanced").locator("summary").click();
    await expect(page.getByTestId("classify-purpose")).toBeVisible();
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

    await page.goto(`/finance/preview?organization_id=${ORG_A}`);
    await expect(page.getByTestId("public-view")).toBeVisible();
    await expect(page.getByTestId("operator-diagnostics")).toBeVisible();

    await page.getByRole("link", { name: "Transactions", exact: true }).click();
    await page.getByTestId("add-manual-transaction").click();
    await expect(page.getByTestId("manual-transaction-form")).toContainText("minus sign");
    await expect(page.getByTestId("manual-occurred-at")).not.toHaveValue("");
    await expect(page.getByText("Direction", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("manual-status")).toHaveValue("NEEDS_REVIEW");
    await page.getByTestId("manual-amount").fill("-1");
    await page.getByTestId("manual-occurred-at").fill("2026-08-02T00:00");
    await page.getByTestId("manual-counterparty").selectOption("cp-1");
    await page.getByTestId("manual-account").selectOption("account-1");
    await page.getByTestId("manual-category").selectOption("category-1");
    await page.getByTestId("manual-project").selectOption("project-1");
    await page.getByTestId("manual-notes").fill("Walkthrough note");
    await page.getByTestId("manual-create-draft").click();
    await page.getByTestId("finance-confirm-reason").fill("Manual outflow");
    await page.getByTestId("finance-confirm-submit").click();
    await expect.poll(() => capture.txPosts.length).toBeGreaterThan(0);
    const created = capture.txPosts.at(-1);
    expect(created).toMatchObject({
      organization_id: ORG_A,
      status: "NEEDS_REVIEW",
      signed_amount_micros: "-1000000",
      native_amount_atomic: "1000000",
      native_decimals: 6,
      native_asset: "USDT",
      counterparty_id: "cp-1",
      account_id: "account-1",
      category_id: "category-1",
      project_id: "project-1",
      notes: "Walkthrough note",
    });
    expect(created).not.toHaveProperty("direction");
    expect(String(created?.occurred_at ?? "")).toMatch(/Z$/);

    await page.getByRole("link", { name: "Budget", exact: true }).click();
    await expect(page.getByTestId("finance-category-budgets")).toContainText("Operations");
    await expect(page.getByTestId("budget-groups")).toContainText("Office");
    await expect(page.getByTestId("finance-category-budgets")).toContainText("Remaining");
    await expect(
      page.getByTestId("finance-category-budgets").getByTestId("money-negative").first(),
    ).toBeVisible();
    await expect(page.getByLabel("Category code")).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).last().fill("Development");
    await page.getByLabel("Group", { exact: true }).last().fill("Development");
    await page.getByLabel("Monthly limit", { exact: true }).last().fill("25");
    await page.getByRole("button", { name: "Add category" }).click();
    await page.getByTestId("finance-confirm-reason").fill("Add development budget");
    await page.getByTestId("finance-confirm-submit").click();
    await expect.poll(() => capture.categoryPosts.length).toBe(1);
    expect(capture.categoryPosts[0]).toMatchObject({
      organization_id: ORG_A,
      name: "Development",
      group_name: "Development",
      monthly_budget_micros: "25000000",
      currency: "USD",
    });
    expect(capture.categoryPosts[0]).not.toHaveProperty("code");
    await page.getByRole("tab", { name: "Annual budget" }).click();
    await expect(page.getByTestId("annual-budget-history")).toContainText("2026-08");
    await expect(
      page.getByTestId("annual-budget-history").getByTestId("money-negative"),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Funding needs" })).toHaveCount(0);
    await expect(page.getByText("Create planned budget")).toHaveCount(0);
    await page.getByText("Advanced operational tools").click();
    await expect(page.getByTestId("finance-commitments")).toContainText(
      "Reduces current free funds",
    );
    await page.getByRole("link", { name: "Evidence library" }).click();
    await page.getByRole("button", { name: "Open private content" }).click();
    await expect(page.getByTestId("evidence-storage-unavailable")).toBeVisible();

    await page.getByRole("link", { name: "Counterparties", exact: true }).click();
    await expect(page.getByTestId("finance-counterparties")).toBeVisible();
    await page.getByLabel("Search counterparties").fill("Patron");
    await expect
      .poll(() => capture.catalogListUrls.some((value) => value.includes("q=Patron")))
      .toBe(true);
    await page.getByRole("button", { name: /WAIA Patron/ }).click();
    await expect(page.getByTestId("catalog-editor-counterparties")).toContainText(
      "Payment details",
    );

    await page.getByRole("link", { name: "Accounts", exact: true }).click();
    await expect(page.getByTestId("finance-accounts")).toBeVisible();
    await page.getByRole("button", { name: /USDT TRC-20/ }).click();
    await expect(page.getByTestId("catalog-editor-accounts")).toContainText(
      "Never enter private keys",
    );

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(page.getByTestId("finance-projects")).toBeVisible();
    await page.getByRole("button", { name: /WAIA Core/ }).click();
    await expect(page.getByTestId("catalog-editor-projects")).toContainText("Core module");

    await page.getByTestId("finance-org-select").selectOption(ORG_B);
    await expect(page.getByTestId("finance-unavailable").first()).toContainText(
      "Admin permission required",
    );
  });
});
