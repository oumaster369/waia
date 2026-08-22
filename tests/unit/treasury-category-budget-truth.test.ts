import { describe, expect, it } from "vitest";

import {
  handleTreasuryCategoryBudgetsGet,
  handleTreasuryLedgerCatalogPost,
} from "@/lib/waia-core/treasury/admin/handlers";
import {
  ORG_A,
  createWp4Deps,
  errorCode,
  getRequest,
  jsonRequest,
} from "@/tests/unit/helpers/treasury-wp4";
import {
  NOW,
  createWp6Bundle,
  createWp6Clock,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";

const ADMIN = { actorType: "admin" as const, actorUserId: "admin-user" };
const context = { organizationId: ORG_A };

describe("DEE-671 category budget truth", () => {
  it("generates unique codes and derives only verified non-duplicate outflow spend", async () => {
    const { services } = createWp6Bundle();
    const primary = await services.ledgerCatalog.createCategory(context, ADMIN, {
      name: "Core Development",
      groupName: "Development",
      monthlyBudgetMicros: 10_000_000n,
      currency: "usd",
      reason: "fixture",
    });
    const secondary = await services.ledgerCatalog.createCategory(context, ADMIN, {
      name: "Core—Development",
      groupName: "Development",
      monthlyBudgetMicros: 5_000_000n,
      currency: "USD",
      reason: "fixture",
    });
    expect(primary.code).toBe("CORE-DEVELOPMENT");
    expect(secondary.code).toBe("CORE-DEVELOPMENT-2");

    await seedTx(services, {
      id: "verified-expense",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      categoryId: primary.id,
      accountingAmountMicros: 3_000_000n,
      cashEffectMicros: -3_000_000n,
      occurredAt: NOW,
    });
    await seedTx(services, {
      id: "review-expense",
      status: "NEEDS_REVIEW",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      categoryId: primary.id,
      cashEffectMicros: -9_000_000n,
      occurredAt: NOW,
    });
    await seedTx(services, {
      id: "duplicate-expense",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      categoryId: primary.id,
      duplicateOfTransactionId: "verified-expense",
      cashEffectMicros: -4_000_000n,
      occurredAt: NOW,
    });
    await seedTx(services, {
      id: "superseded-expense",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      categoryId: primary.id,
      detailSupersededById: "correction",
      cashEffectMicros: -4_000_000n,
      occurredAt: NOW,
    });
    await seedTx(services, {
      id: "verified-inflow",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "EXTERNAL_INFLOW",
      categoryId: primary.id,
      cashEffectMicros: 8_000_000n,
      occurredAt: NOW,
    });

    const summary = await services.ledgerCatalog.getBudgetMonthSummary(context, "2026-08");
    expect(summary.categories.find((row) => row.categoryId === primary.id)).toMatchObject({
      budgetMicros: 10_000_000n,
      spentMicros: 3_000_000n,
      remainingMicros: 7_000_000n,
    });
    expect(summary.groups).toEqual([
      {
        groupName: "Development",
        currency: "USD",
        budgetMicros: 15_000_000n,
        spentMicros: 3_000_000n,
        remainingMicros: 12_000_000n,
      },
    ]);
  });

  it("preserves effective-month history and exposes negative remaining on overspend", async () => {
    const clock = createWp6Clock(new Date("2026-08-15T12:00:00.000Z"));
    const { services } = createWp6Bundle(clock);
    const category = await services.ledgerCatalog.createCategory(context, ADMIN, {
      name: "Advertising",
      groupName: "Advertising",
      monthlyBudgetMicros: 10_000_000n,
      currency: "USD",
      reason: "fixture",
    });
    await seedTx(services, {
      id: "overspend",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      categoryId: category.id,
      accountingAmountMicros: 12_000_000n,
      cashEffectMicros: -12_000_000n,
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
    });
    clock.set(new Date("2026-09-02T12:00:00.000Z"));
    await services.ledgerCatalog.updateCategory(context, ADMIN, category.id, {
      monthlyBudgetMicros: 20_000_000n,
      groupName: "Marketing",
      reason: "September plan",
    });

    const august = await services.ledgerCatalog.getBudgetMonthSummary(context, "2026-08");
    const september = await services.ledgerCatalog.getBudgetMonthSummary(context, "2026-09");
    expect(august.categories[0]).toMatchObject({
      groupName: "Advertising",
      budgetMicros: 10_000_000n,
      spentMicros: 12_000_000n,
      remainingMicros: -2_000_000n,
    });
    expect(september.categories[0]).toMatchObject({
      groupName: "Marketing",
      budgetMicros: 20_000_000n,
      spentMicros: 0n,
      remainingMicros: 20_000_000n,
    });

    const annual = await services.ledgerCatalog.getBudgetAnnualSummary(context, 2026);
    expect(annual.totals).toEqual([
      {
        currency: "USD",
        budgetMicros: 90_000_000n,
        spentMicros: 12_000_000n,
        remainingMicros: 78_000_000n,
      },
    ]);
    await expect(
      services.ledgerCatalog.updateCategory(context, ADMIN, category.id, {
        monthlyBudgetMicros: 1n,
        effectiveMonth: "2026-08",
        reason: "rewrite past",
      }),
    ).rejects.toMatchObject({ reasonCode: "PAST_BUDGET_MONTH_IMMUTABLE" });
  });

  it("keeps create codes server-owned and serializes the read-only admin summary", async () => {
    const { services } = createWp6Bundle();
    const deps = createWp4Deps({ services });
    const rejected = await handleTreasuryLedgerCatalogPost(
      jsonRequest("/api/admin/treasury/categories", {
        organization_id: ORG_A,
        code: "MANUAL",
        name: "Office",
        group_name: "Office",
        monthly_budget_micros: "1000000",
        currency: "USD",
        reason: "fixture",
      }),
      deps,
      "categories",
    );
    expect(rejected.status).toBe(400);
    expect(errorCode(rejected)).toBe("CATEGORY_CODE_SERVER_OWNED");

    const created = await handleTreasuryLedgerCatalogPost(
      jsonRequest("/api/admin/treasury/categories", {
        organization_id: ORG_A,
        name: "Office",
        group_name: "Office",
        monthly_budget_micros: "1000000",
        currency: "USD",
        effective_month: "2026-08",
        reason: "fixture",
      }),
      deps,
      "categories",
    );
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      category: { code: "OFFICE", groupName: "Office", monthlyBudgetMicros: "1000000" },
    });

    const summary = await handleTreasuryCategoryBudgetsGet(
      getRequest(`/api/admin/treasury/category-budgets?organization_id=${ORG_A}&month=2026-08`),
      deps,
    );
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      month: {
        month: "2026-08",
        totals: [
          {
            currency: "USD",
            budgetMicros: "1000000",
            spentMicros: "0",
            remainingMicros: "1000000",
          },
        ],
      },
    });

    const annual = await handleTreasuryCategoryBudgetsGet(
      getRequest(`/api/admin/treasury/category-budgets?organization_id=${ORG_A}&year=2026`),
      deps,
    );
    expect(annual.status).toBe(200);
    expect(annual.body).toMatchObject({
      annual: {
        year: 2026,
        totals: [
          {
            currency: "USD",
            budgetMicros: "5000000",
            spentMicros: "0",
            remainingMicros: "5000000",
          },
        ],
      },
    });

    for (const year of ["not-a-year", "2026.5", "2026.0", "2e3", "1999", "2201"]) {
      const invalid = await handleTreasuryCategoryBudgetsGet(
        getRequest(
          `/api/admin/treasury/category-budgets?organization_id=${ORG_A}&year=${year}`,
        ),
        deps,
      );
      expect(invalid.status).toBe(400);
      expect(errorCode(invalid)).toBe("INVALID_BODY");
    }
  });
});
