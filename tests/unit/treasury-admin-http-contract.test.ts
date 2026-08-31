import { describe, expect, it } from "vitest";

import {
  parseSemanticPatch,
  parseTreasuryTransactionListQuery,
} from "@/lib/waia-core/treasury/admin/parse";
import {
  serializeCommitment,
  serializeTransaction,
} from "@/lib/waia-core/treasury/admin/serialize";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  handleTreasuryBudgetsGet,
  handleTreasuryCommitmentsGet,
  handleTreasuryFundingNeedsGet,
  handleTreasuryOrganizationsGet,
  handleTreasuryOverviewGet,
  handleTreasuryOverviewCountsGet,
  handleTreasuryTransactionCommandsPost,
  handleTreasuryTransactionsGet,
} from "@/lib/waia-core/treasury/admin/handlers";
import { countTreasuryOverview } from "@/lib/waia-core/treasury/transaction-list-query";
import {
  HUGE_MICROS,
  ORG_A,
  ORG_B,
  createWp4Bundle,
  createWp4Deps,
  errorCode,
  getRequest,
  jsonRequest,
} from "@/tests/unit/helpers/treasury-wp4";
import {
  BUDGET_A,
  COMMIT_A,
  NEED_A,
  seedBudget,
  seedCommitment,
  seedNeed,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";
import { ctxA } from "@/tests/unit/helpers/treasury-wp2";

const ORGS = [
  { id: ORG_A, name: "Org A", kind: "business" },
  { id: ORG_B, name: "Org B", kind: "business" },
];

function command(body: Record<string, unknown>) {
  return jsonRequest("/api/admin/treasury/transactions/commands", body);
}

describe("DEE-615 WP-1 serializers and classify parse", () => {
  it("serializes existing transaction review fields and keeps money as decimal strings", async () => {
    const { services } = createWp4Bundle();
    await seedTx(services, {
      id: "tx-serial",
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      fundBucketCode: "CORE",
      category: "ops",
      counterpartyDisplay: "Alice",
      publishCounterparty: true,
      projectModule: "twin",
      milestoneStage: "v1",
      description: "seed description",
      detailSupersededById: "super-1",
      verifiedByUserId: null,
      accountingAmountMicros: 9_007_199_254_740_993n,
      cashEffectMicros: 9_007_199_254_740_993n,
    });
    const listed = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      createWp4Deps({ services }),
    );
    const tx = (listed.body as { transactions: Record<string, unknown>[] }).transactions[0];
    expect(tx.fundBucketCode).toBe("CORE");
    expect(tx.category).toBe("ops");
    expect(tx.counterpartyDisplay).toBe("Alice");
    expect(tx.publishCounterparty).toBe(true);
    expect(tx.projectModule).toBe("twin");
    expect(tx.milestoneStage).toBe("v1");
    expect(tx.description).toBe("seed description");
    expect(tx.detailSupersededById).toBe("super-1");
    expect(tx.accountingAmountMicros).toBe(HUGE_MICROS);
    expect(typeof tx.accountingAmountMicros).toBe("string");
    expect(tx.verifiedByUserId).toBeNull();
    const raw = await services.domain.repository.getTransaction(ctxA, "tx-serial");
    expect(raw).not.toBeNull();
    expect(JSON.stringify(serializeTransaction(raw!))).not.toMatch(/9007199254740993[^"]/);
  });

  it("serializes funding-need targetStage and commitment lifecycle audit fields", async () => {
    const { services } = createWp4Bundle();
    await seedNeed(services, { id: NEED_A, targetStage: "beta" });
    await seedCommitment(services, {
      id: COMMIT_A,
      status: "APPROVED",
      counterpartyDisplay: "Vendor",
      publishCounterparty: true,
      expectedAt: "2026-09-01",
      evidenceObjectId: "ev-1",
      approvedByUserId: "user-1",
      approvedAt: new Date("2026-08-02T00:00:00.000Z"),
      fulfillsTransactionId: null,
    });
    const needs = await handleTreasuryFundingNeedsGet(
      getRequest(`/api/admin/treasury/funding-needs?organization_id=${ORG_A}`),
      createWp4Deps({ services }),
    );
    expect(
      (needs.body as { fundingNeeds: { targetStage: string }[] }).fundingNeeds[0].targetStage,
    ).toBe("beta");
    const listed = await handleTreasuryCommitmentsGet(
      getRequest(`/api/admin/treasury/commitments?organization_id=${ORG_A}`),
      createWp4Deps({ services }),
    );
    const row = (listed.body as { commitments: Record<string, unknown>[] }).commitments[0];
    expect(row.counterpartyDisplay).toBe("Vendor");
    expect(row.publishCounterparty).toBe(true);
    expect(row.expectedAt).toBe("2026-09-01");
    expect(row.evidenceObjectId).toBe("ev-1");
    expect(row.approvedByUserId).toBe("user-1");
    expect(row.approvedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(row.amountMicros).toBe("1000000");
    const stored = await services.domain.repository.getCommitment(ctxA, COMMIT_A);
    expect(JSON.stringify(serializeCommitment(stored!))).toContain('"amountMicros":"1000000"');
  });

  it("parseSemanticPatch accepts projectModule, milestoneStage, and description", () => {
    const patch = parseSemanticPatch({
      project_module: "twin",
      milestoneStage: "v1",
      description: "note",
    });
    expect(patch).toEqual({
      projectModule: "twin",
      milestoneStage: "v1",
      description: "note",
    });
  });

  it("parseSemanticPatch rejects invalid types and ignores unapproved writable fields", () => {
    expect(() => parseSemanticPatch({ projectModule: 1 })).toThrow(TreasuryValidationError);
    expect(() => parseSemanticPatch({ milestoneStage: true })).toThrow(TreasuryValidationError);
    expect(() => parseSemanticPatch({ description: 3 })).toThrow(TreasuryValidationError);
    const ignored = parseSemanticPatch({
      status: "VERIFIED",
      cashEffectMicros: "1",
      detailPublication: "DETAIL_PUBLIC",
      kind: "CONTRIBUTION",
    });
    expect(ignored).not.toHaveProperty("status");
    expect(ignored).not.toHaveProperty("cashEffectMicros");
    expect(ignored).not.toHaveProperty("detailPublication");
    expect(ignored.kind).toBe("CONTRIBUTION");
  });

  it("classify HTTP persists the new semantic fields", async () => {
    const { services } = createWp4Bundle();
    await seedTx(services, {
      id: "tx-class",
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      accountingAmountMicros: 1_000_000n,
    });
    const result = await handleTreasuryTransactionCommandsPost(
      command({
        organization_id: ORG_A,
        command: "classify",
        transaction_id: "tx-class",
        reason: "classify",
        patch: {
          kind: "CONTRIBUTION",
          direction: "INFLOW",
          accounting_amount_micros: "1000000",
          project_module: "twin",
          milestone_stage: "v1",
          description: "classified",
        },
      }),
      createWp4Deps({ services }),
    );
    expect(result.status).toBe(200);
    const tx = (result.body as { transaction: Record<string, unknown> }).transaction;
    expect(tx.projectModule).toBe("twin");
    expect(tx.milestoneStage).toBe("v1");
    expect(tx.description).toBe("classified");
  });
});

describe("DEE-615 WP-2 authoritative filters and overview counts", () => {
  it("filters by canonical network/token, not nativeContract, and aliases reconciliation", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    await seedTx(services, {
      id: "canon",
      status: "RECONCILIATION_REQUIRED",
      direction: "INFLOW",
      provenance: "WATCHER",
      canonicalNetwork: "TRC-20",
      canonicalTokenContract: "TUSDT",
      nativeContract: "OTHER",
      nativeAsset: "USDT",
      projectModule: "twin",
      category: "ops",
      budgetId: BUDGET_A,
      occurredAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    await seedTx(services, {
      id: "manual-null",
      status: "CLASSIFIED",
      direction: "OUTFLOW",
      provenance: "MANUAL",
      canonicalNetwork: null,
      canonicalTokenContract: null,
      nativeContract: "TUSDT",
      nativeAsset: "USDC",
      occurredAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const byNetwork = await handleTreasuryTransactionsGet(
      getRequest(
        `/api/admin/treasury/transactions?organization_id=${ORG_A}&network=TRC-20&token_contract=TUSDT`,
      ),
      deps,
    );
    const networkRows = (byNetwork.body as { transactions: { id: string }[] }).transactions;
    expect(networkRows.map((row) => row.id)).toEqual(["canon"]);
    const recon = await handleTreasuryTransactionsGet(
      getRequest(
        `/api/admin/treasury/transactions?organization_id=${ORG_A}&needs_reconciliation=true`,
      ),
      deps,
    );
    expect(
      (recon.body as { transactions: { id: string }[] }).transactions.map((row) => row.id),
    ).toEqual(["canon"]);
    const conflict = await handleTreasuryTransactionsGet(
      getRequest(
        `/api/admin/treasury/transactions?organization_id=${ORG_A}&status=VERIFIED&needs_reconciliation=true`,
      ),
      deps,
    );
    expect(conflict.status).toBe(400);
    const byAsset = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}&asset=USDC`),
      deps,
    );
    expect(
      (byAsset.body as { transactions: { id: string }[] }).transactions.map((row) => row.id),
    ).toEqual(["manual-null"]);
    const byDirection = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}&direction=OUTFLOW`),
      deps,
    );
    expect(
      (byDirection.body as { transactions: { id: string }[] }).transactions.map((row) => row.id),
    ).toEqual(["manual-null"]);
  });

  it("applies filters before pagination and does not treat a page as the complete set", async () => {
    const { services } = createWp4Bundle();
    for (let i = 0; i < 3; i += 1) {
      await seedTx(services, {
        id: `exp-${i}`,
        status: "CLASSIFIED",
        direction: "OUTFLOW",
        kind: "EXPENSE",
        occurredAt: new Date(`2026-08-0${i + 1}T00:00:00.000Z`),
      });
    }
    await seedTx(services, {
      id: "contrib",
      status: "CLASSIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      occurredAt: new Date("2026-08-10T00:00:00.000Z"),
    });
    const page = await handleTreasuryTransactionsGet(
      getRequest(
        `/api/admin/treasury/transactions?organization_id=${ORG_A}&kind=EXPENSE&limit=1&offset=0`,
      ),
      createWp4Deps({ services }),
    );
    const rows = (page.body as { transactions: { id: string; kind: string }[] }).transactions;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("EXPENSE");
    const allExpense = await services.domain.repository.listTransactions(ctxA, {
      kind: "EXPENSE",
      limit: 100,
      offset: 0,
    });
    expect(allExpense).toHaveLength(3);
  });

  it("counts review-required and publication-pending over the complete org-scoped set", async () => {
    const { services } = createWp4Bundle();
    const included = ["DETECTED", "NEEDS_REVIEW", "CLASSIFIED", "RECONCILIATION_REQUIRED"] as const;
    for (const status of included) {
      await seedTx(services, {
        id: `in-${status}`,
        status,
        direction: "INFLOW",
      });
    }
    await seedTx(services, { id: "ex-verified-private", status: "VERIFIED", direction: "INFLOW" });
    await seedTx(services, {
      id: "ex-verified-public",
      status: "VERIFIED",
      direction: "INFLOW",
      detailPublication: "DETAIL_PUBLIC",
    });
    await seedTx(services, {
      id: "ex-verified-superseded",
      status: "VERIFIED",
      direction: "INFLOW",
      detailPublication: "SUPERSEDED",
    });
    await seedTx(services, { id: "ex-rejected", status: "REJECTED", direction: "INFLOW" });
    await seedTx(services, { id: "ex-duplicate", status: "DUPLICATE", direction: "INFLOW" });
    await seedTx(services, { id: "ex-draft", status: "MANUAL_DRAFT", direction: "INFLOW" });
    await seedTx(services, {
      id: "org-b",
      organizationId: ORG_B,
      status: "DETECTED",
      direction: "INFLOW",
    });
    const deps = createWp4Deps({ services });
    const counted = await handleTreasuryOverviewCountsGet(
      getRequest(`/api/admin/treasury/overview-counts?organization_id=${ORG_A}`),
      deps,
    );
    expect(counted.status).toBe(200);
    expect(counted.body).toEqual({
      reviewRequiredCount: 4,
      publicationPendingCount: 1,
    });
    const orgB = await handleTreasuryOverviewCountsGet(
      getRequest(`/api/admin/treasury/overview-counts?organization_id=${ORG_B}`),
      deps,
    );
    expect(orgB.body).toEqual({ reviewRequiredCount: 1, publicationPendingCount: 0 });
    for (let i = 0; i < 60; i += 1) {
      await seedTx(services, {
        id: `page-${i}`,
        status: "DETECTED",
        direction: "INFLOW",
      });
    }
    const paged = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}&limit=1`),
      deps,
    );
    expect((paged.body as { transactions: unknown[] }).transactions).toHaveLength(1);
    const afterPage = await handleTreasuryOverviewCountsGet(
      getRequest(`/api/admin/treasury/overview-counts?organization_id=${ORG_A}`),
      deps,
    );
    expect(afterPage.body).toEqual({
      reviewRequiredCount: 64,
      publicationPendingCount: 1,
    });
    const complete = await services.domain.repository.listTransactions(ctxA);
    expect(countTreasuryOverview(complete)).toEqual(afterPage.body);
  });

  it("rejects an inverted occurred_at range", () => {
    expect(() =>
      parseTreasuryTransactionListQuery(
        new URLSearchParams(
          "occurred_at_from=2026-08-10T00:00:00.000Z&occurred_at_to=2026-08-01T00:00:00.000Z",
        ),
      ),
    ).toThrow(TreasuryValidationError);
  });

  it("loads the complete Overview through one authorized handler runtime", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    const result = await handleTreasuryOverviewGet(
      getRequest(`/api/admin/treasury/overview?organization_id=${ORG_A}`),
      deps,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      preview: { status: "pending" },
      counts: { reviewRequiredCount: 0, publicationPendingCount: 0 },
    });
    expect(result.body as Record<string, unknown>).toHaveProperty("settings");
    expect(result.body as Record<string, unknown>).toHaveProperty("allocation");
    expect(deps.authorizedOrgsSeen).toEqual([ORG_A]);
  });
});

describe("DEE-615 WP-3 derived budget and funding-need reads", () => {
  it("computes signed remaining, non-EXPENSE spent, and active commitments only", async () => {
    const { services } = createWp4Bundle();
    await seedBudget(services, { id: BUDGET_A, plannedAmountMicros: 10_000_000n });
    await seedTx(services, {
      id: "funded",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      budgetId: BUDGET_A,
      accountingAmountMicros: 4_000_000n,
      cashEffectMicros: 4_000_000n,
    });
    await seedTx(services, {
      id: "outflow",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXTERNAL_OUTFLOW",
      budgetId: BUDGET_A,
      accountingAmountMicros: 1_000_000n,
      cashEffectMicros: -1_000_000n,
    });
    await seedCommitment(services, {
      id: "active-approved",
      status: "APPROVED",
      budgetId: BUDGET_A,
      amountMicros: 2_000_000n,
    });
    await seedCommitment(services, {
      id: "active-released",
      status: "RELEASED",
      budgetId: BUDGET_A,
      amountMicros: 1_000_000n,
    });
    await seedCommitment(services, {
      id: "inactive-draft",
      status: "DRAFT",
      budgetId: BUDGET_A,
      amountMicros: 9_000_000n,
    });
    await seedCommitment(services, {
      id: "inactive-cancelled",
      status: "CANCELLED",
      budgetId: BUDGET_A,
      amountMicros: 9_000_000n,
    });
    const listed = await handleTreasuryBudgetsGet(
      getRequest(`/api/admin/treasury/budgets?organization_id=${ORG_A}`),
      createWp4Deps({ services }),
    );
    const budget = (listed.body as { budgets: Record<string, string>[] }).budgets[0];
    expect(budget.funded).toBe("4000000");
    expect(budget.spent).toBe("1000000");
    expect(budget.committed).toBe("3000000");
    expect(budget.remaining).toBe("6000000");
  });

  it("preserves negative remaining and isolates organizations", async () => {
    const { services } = createWp4Bundle();
    await seedBudget(services, { id: BUDGET_A, plannedAmountMicros: 1_000_000n });
    await seedBudget(services, {
      id: "budbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      organizationId: ORG_B,
      plannedAmountMicros: 9_000_000n,
    });
    await seedTx(services, {
      id: "big-spend",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      budgetId: BUDGET_A,
      accountingAmountMicros: 5_000_000n,
      cashEffectMicros: -5_000_000n,
    });
    await seedTx(services, {
      id: "b-funded",
      organizationId: ORG_B,
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      budgetId: "budbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      accountingAmountMicros: 2_000_000n,
      cashEffectMicros: 2_000_000n,
    });
    const deps = createWp4Deps({ services });
    const orgA = await handleTreasuryBudgetsGet(
      getRequest(`/api/admin/treasury/budgets?organization_id=${ORG_A}`),
      deps,
    );
    expect((orgA.body as { budgets: { remaining: string }[] }).budgets[0].remaining).toBe(
      "-4000000",
    );
    const orgB = await handleTreasuryBudgetsGet(
      getRequest(`/api/admin/treasury/budgets?organization_id=${ORG_B}`),
      deps,
    );
    expect(
      (orgB.body as { budgets: { remaining: string; funded: string }[] }).budgets[0],
    ).toMatchObject({
      funded: "2000000",
      remaining: "9000000",
    });
  });

  it("fails closed when a matching VERIFIED row is financially incomplete", async () => {
    const { services } = createWp4Bundle();
    await seedBudget(services, { id: BUDGET_A, plannedAmountMicros: 10_000_000n });
    await seedTx(services, {
      id: "incomplete",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      budgetId: BUDGET_A,
      cashEffectMicros: null,
    });
    const listed = await handleTreasuryBudgetsGet(
      getRequest(`/api/admin/treasury/budgets?organization_id=${ORG_A}`),
      createWp4Deps({ services }),
    );
    expect(listed.status).toBe(400);
    expect(errorCode(listed)).toBe("VERIFIED_FINANCIAL_ROW_INCOMPLETE");
  });

  it("derives funding-need funded and signed remaining from contribution assignment", async () => {
    const { services } = createWp4Bundle();
    await seedNeed(services, { id: NEED_A, requiredAmountMicros: 5_000_000n, targetStage: "ga" });
    await seedTx(services, {
      id: "need-fund",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      fundingNeedId: NEED_A,
      accountingAmountMicros: 8_000_000n,
      cashEffectMicros: 8_000_000n,
    });
    const listed = await handleTreasuryFundingNeedsGet(
      getRequest(`/api/admin/treasury/funding-needs?organization_id=${ORG_A}`),
      createWp4Deps({ services }),
    );
    expect(
      (
        listed.body as {
          fundingNeeds: { funded: string; remaining: string; targetStage: string }[];
        }
      ).fundingNeeds[0],
    ).toEqual(
      expect.objectContaining({
        funded: "8000000",
        remaining: "-3000000",
        targetStage: "ga",
      }),
    );
  });
});

describe("DEE-615 WP-4 treasury organizations", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = await handleTreasuryOrganizationsGet(
      getRequest("/api/admin/treasury/organizations"),
      createWp4Deps({ userId: null, listOrganizations: ORGS }),
    );
    expect(result.status).toBe(401);
    expect(errorCode(result)).toBe("UNAUTHORIZED");
  });

  it("returns 403 without admin.treasury.read and does not require trader access", async () => {
    const denied = await handleTreasuryOrganizationsGet(
      getRequest("/api/admin/treasury/organizations"),
      createWp4Deps({ permissions: "none", listOrganizations: ORGS }),
    );
    expect(denied.status).toBe(403);
    const traderOnly = await handleTreasuryOrganizationsGet(
      getRequest("/api/admin/treasury/organizations"),
      createWp4Deps({
        permissions: ["admin.org.read", "admin.trader.operations.mutate"],
        listOrganizations: ORGS,
      }),
    );
    expect(traderOnly.status).toBe(403);
  });

  it("returns the organization list for an allowed treasury admin", async () => {
    const result = await handleTreasuryOrganizationsGet(
      getRequest("/api/admin/treasury/organizations"),
      createWp4Deps({
        permissions: ["admin.treasury.read"],
        listOrganizations: ORGS,
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ organizations: ORGS });
  });
});
