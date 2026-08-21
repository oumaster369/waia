import { describe, expect, it } from "vitest";

import {
  handleTreasuryIdealBudgetCommandsPost,
  handleTreasuryLedgerCatalogGet,
  handleTreasuryLedgerCatalogPost,
  handleTreasuryTransactionsPost,
} from "@/lib/waia-core/treasury/admin/handlers";
import { computeAnnualCategoryBudgetMicros } from "@/lib/waia-core/treasury/admin/ledger-catalog-service";
import type { TreasuryCategoryRecord } from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  ORG_A,
  ORG_B,
  createWp4Bundle,
  createWp4Deps,
  errorCode,
  getRequest,
  jsonRequest,
} from "@/tests/unit/helpers/treasury-wp4";

const ADMIN = { actorType: "admin" as const, actorUserId: "admin-user" };

describe("DEE-661 Treasury ledger catalogs", () => {
  it("keeps search, pagination and detail metadata organization-scoped", async () => {
    const { services } = createWp4Bundle();
    const contextA = { organizationId: ORG_A };
    const contextB = { organizationId: ORG_B };

    const alpha = await services.ledgerCatalog.createCounterparty(contextA, ADMIN, {
      displayName: "Alpha Studio",
      email: "Pay@Alpha.example",
      paymentInstructions: "Invoice by email; card •••• 4242",
      reason: "fixture",
    });
    await services.ledgerCatalog.createCounterparty(contextA, ADMIN, {
      displayName: "Beta Studio",
      reason: "fixture",
    });
    await services.ledgerCatalog.createCounterparty(contextB, ADMIN, {
      displayName: "Alpha foreign",
      reason: "fixture",
    });

    const first = await services.ledgerCatalog.listCounterparties(contextA, {
      q: "studio",
      limit: 1,
    });
    expect(first.items.map((row) => row.displayName)).toEqual(["Alpha Studio"]);
    expect(first.next).not.toBeNull();
    const second = await services.ledgerCatalog.listCounterparties(contextA, {
      q: "studio",
      limit: 1,
      ...first.next!,
    });
    expect(second.items.map((row) => row.displayName)).toEqual(["Beta Studio"]);

    const deps = createWp4Deps({ services });
    const list = await handleTreasuryLedgerCatalogGet(
      getRequest(`/api/admin/treasury/counterparties?organization_id=${ORG_A}`),
      deps,
      "counterparties",
    );
    const summary = (
      list.body as { counterparties: Record<string, unknown>[] }
    ).counterparties.find((row) => row.id === alpha.id)!;
    expect(summary).not.toHaveProperty("email");
    expect(summary).not.toHaveProperty("paymentInstructions");

    const detail = await handleTreasuryLedgerCatalogGet(
      getRequest(`/api/admin/treasury/counterparties?organization_id=${ORG_A}&id=${alpha.id}`),
      deps,
      "counterparties",
    );
    expect((detail.body as { counterparty: { email: string } }).counterparty.email).toBe(
      "pay@alpha.example",
    );
    const crossOrg = await handleTreasuryLedgerCatalogGet(
      getRequest(`/api/admin/treasury/counterparties?organization_id=${ORG_B}&id=${alpha.id}`),
      deps,
      "counterparties",
    );
    expect(crossOrg.status).toBe(404);
  });

  it("rejects custody secrets and unmasked card numbers", async () => {
    const { services } = createWp4Bundle();
    const context = { organizationId: ORG_A };

    await expect(
      services.ledgerCatalog.createAccount(context, ADMIN, {
        displayName: "Unsafe wallet",
        kind: "CRYPTO_WALLET",
        currency: "USDT",
        maskedRequisites: "seed phrase: abandon abandon abandon",
        reason: "fixture",
      }),
    ).rejects.toMatchObject({ reasonCode: "CUSTODY_MATERIAL_FORBIDDEN" });

    await expect(
      services.ledgerCatalog.createCounterparty(context, ADMIN, {
        displayName: "Unsafe card",
        paymentInstructions: "Charge 4111 1111 1111 1111",
        reason: "fixture",
      }),
    ).rejects.toMatchObject({ reasonCode: "FULL_CARD_PAN_FORBIDDEN" });
  });

  it("validates same-organization watched-address links and project dates", async () => {
    const { services } = createWp4Bundle();
    await services.catalogRepo.insertWatchedAddress({
      id: "watch-b",
      organizationId: ORG_B,
      network: "TRON",
      address: "TForeign",
      tokenContract: "USDT",
      assetCode: "USDT",
      directionScope: "BOTH",
      includeInBalanceRecon: true,
      label: "foreign",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      services.ledgerCatalog.createAccount({ organizationId: ORG_A }, ADMIN, {
        displayName: "USDT TRC-20",
        kind: "CRYPTO_WALLET",
        currency: "USDT",
        watchedAddressId: "watch-b",
        reason: "fixture",
      }),
    ).rejects.toMatchObject({ reasonCode: "CROSS_ORG_REFERENCE" });

    await expect(
      services.ledgerCatalog.createProject({ organizationId: ORG_A }, ADMIN, {
        name: "Invalid project",
        startsOn: "2026-09-02",
        endsOn: "2026-09-01",
        reason: "fixture",
      }),
    ).rejects.toBeInstanceOf(TreasuryValidationError);
  });

  it("links an attributed WAIA identity authoritatively without inferring it from a wallet", async () => {
    const { services } = createWp4Bundle();
    const context = { organizationId: ORG_A };
    const first = await services.ledgerCatalog.ensureWaiaUserCounterparty(context, ADMIN, {
      waiaUserId: "waia-user-1",
      displayName: "Alex WAIA",
      reason: "authoritative attribution",
    });
    const refreshed = await services.ledgerCatalog.ensureWaiaUserCounterparty(context, ADMIN, {
      waiaUserId: "waia-user-1",
      displayName: "Alex Updated",
      waiaUsername: "@alex",
      reason: "refresh authoritative identity",
    });

    expect(refreshed.id).toBe(first.id);
    expect(refreshed).toMatchObject({
      waiaUserId: "waia-user-1",
      displayName: "Alex Updated",
      waiaUsername: "alex",
      isActive: true,
    });
    expect(
      await services.ledgerCatalog.listCounterparties({ organizationId: ORG_B }),
    ).toMatchObject({ items: [] });
  });

  it("derives an exact annual draft from every active monthly category", async () => {
    const { services, audits } = createWp4Bundle();
    for (let index = 0; index < 101; index += 1) {
      await services.ledgerCatalog.createCategory({ organizationId: ORG_A }, ADMIN, {
        code: `category-${index.toString().padStart(3, "0")}`,
        name: `Category ${index.toString().padStart(3, "0")}`,
        monthlyBudgetMicros: 1_000_000n,
        currency: "USD",
        reason: "fixture",
      });
    }
    await services.ledgerCatalog.createCategory({ organizationId: ORG_A }, ADMIN, {
      code: "archived",
      name: "Archived",
      monthlyBudgetMicros: 9_000_000n,
      currency: "USD",
      isActive: false,
      reason: "fixture",
    });

    const result = await handleTreasuryIdealBudgetCommandsPost(
      jsonRequest("/api/admin/treasury/ideal-budgets/commands", {
        organization_id: ORG_A,
        command: "refresh_from_categories",
        period_year: 2027,
        currency: "usd",
        reason: "refresh annual snapshot",
      }),
      createWp4Deps({ services }),
    );
    expect(result.status).toBe(200);
    expect(
      (
        result.body as {
          idealBudget: { amountMicros: string; status: string; publicationState: string };
        }
      ).idealBudget,
    ).toMatchObject({
      amountMicros: (101n * 12n * 1_000_000n).toString(),
      status: "DRAFT",
      publicationState: "PRIVATE",
    });
    const audit = audits.find((row) => row.action === "treasury.ideal_budget.create");
    expect(audit?.metadata).toMatchObject({
      source: "TREASURY_CATEGORIES",
      activeCategoryCount: 101,
    });
  });

  it("rejects mixed currencies in annual aggregation", () => {
    const base: Omit<TreasuryCategoryRecord, "id" | "currency"> = {
      organizationId: ORG_A,
      code: "x",
      name: "x",
      description: null,
      monthlyBudgetMicros: 1n,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() =>
      computeAnnualCategoryBudgetMicros(
        [
          { ...base, id: "usd", currency: "USD" },
          { ...base, id: "eur", currency: "EUR" },
        ],
        "USD",
      ),
    ).toThrowError(TreasuryValidationError);
  });

  it("maps signed manual amounts to canonical direction without a verification bypass", async () => {
    const { services } = createWp4Bundle();
    const deps = createWp4Deps({ services });
    const outgoing = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        signed_amount_micros: "-2500000",
        native_amount_atomic: "2500000",
        native_asset: "USDT",
        occurred_at: "2026-08-21T12:00:00.000Z",
        reason: "manual outgoing",
      }),
      deps,
    );
    expect(outgoing.status).toBe(200);
    expect(
      (
        outgoing.body as {
          transaction: { direction: string; signedAmountMicros: string; status: string };
        }
      ).transaction,
    ).toMatchObject({
      direction: "OUTFLOW",
      signedAmountMicros: "-2500000",
      status: "NEEDS_REVIEW",
    });

    const verified = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        signed_amount_micros: "1000000",
        native_amount_atomic: "1000000",
        native_asset: "USDT",
        occurred_at: "2026-08-21T12:00:00.000Z",
        status: "VERIFIED",
        reason: "attempt bypass",
      }),
      deps,
    );
    expect(verified.status).toBe(400);
    expect(errorCode(verified)).toBe("STATUS_GATE_REQUIRED");
  });

  it("enforces mutate permission on catalog writes", async () => {
    const { services } = createWp4Bundle();
    const denied = await handleTreasuryLedgerCatalogPost(
      jsonRequest("/api/admin/treasury/categories", {
        organization_id: ORG_A,
        code: "infra",
        name: "Infrastructure",
        monthly_budget_micros: "1000000",
        currency: "USD",
        reason: "fixture",
      }),
      createWp4Deps({ services, permissions: ["admin.treasury.read"] }),
      "categories",
    );
    expect(denied.status).toBe(403);
  });
});
