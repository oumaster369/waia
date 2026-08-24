import { describe, expect, it } from "vitest";

import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  computeVirtualFundAllocation,
  createMemoryTreasuryFundAllocationRepository,
  createTreasuryFundAllocationService,
  fundAllocationUnavailableReasons,
} from "@/lib/waia-core/treasury/allocation";
import {
  IDEAL_A,
  NOW,
  ORG_B,
  createWp6Bundle,
  ctxA,
  seedCommitment,
  seedIdeal,
  seedInception,
  seedRecon,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";

const OPENING_TX_ID = "69000000-0000-4000-8000-000000000001";
const COMMITMENT_ID = "69000000-0000-4000-8000-000000000002";
const SECOND_IDEAL_ID = "69000000-0000-4000-8000-000000000003";

async function seedAllocationTruth(input: { cashMicros?: bigint; budgetMicros?: bigint }) {
  const bundle = createWp6Bundle();
  const cashMicros = input.cashMicros ?? 150_000_000n;
  await seedTx(bundle.services, {
    id: OPENING_TX_ID,
    status: "VERIFIED",
    direction: "INFLOW",
    accountingAmountMicros: cashMicros,
    cashEffectMicros: cashMicros,
  });
  await seedIdeal(bundle.services, {
    id: IDEAL_A,
    amountMicros: input.budgetMicros ?? 100_000_000n,
  });
  await seedInception(bundle.services, { openingBalanceTransactionId: OPENING_TX_ID });
  await seedRecon(bundle.services, {
    observedOnchainBalanceAtomic: cashMicros,
    accountingCashBalanceMicros: cashMicros,
    deltaMicros: 0n,
  });
  return bundle;
}

describe("DEE-690 virtual Development Fund allocation", () => {
  it("uses exact integer micros below, at, and above the protected annual budget", () => {
    expect(
      computeVirtualFundAllocation({
        canonicalFreeFundsMicros: 80n,
        protectedAnnualBudgetMicros: 100n,
      }),
    ).toEqual({ operatingAllocationMicros: 80n, developmentAllocationMicros: 0n });
    expect(
      computeVirtualFundAllocation({
        canonicalFreeFundsMicros: 100n,
        protectedAnnualBudgetMicros: 100n,
      }),
    ).toEqual({ operatingAllocationMicros: 100n, developmentAllocationMicros: 0n });
    expect(
      computeVirtualFundAllocation({
        canonicalFreeFundsMicros: 150n,
        protectedAnnualBudgetMicros: 100n,
      }),
    ).toEqual({ operatingAllocationMicros: 100n, developmentAllocationMicros: 50n });
    expect(() =>
      computeVirtualFundAllocation({
        canonicalFreeFundsMicros: -1n,
        protectedAnnualBudgetMicros: 100n,
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      computeVirtualFundAllocation({
        // @ts-expect-error Runtime guard must reject floating-point money.
        canonicalFreeFundsMicros: 100,
        protectedAnnualBudgetMicros: 100n,
      }),
    ).toThrow(/bigint/);
  });

  it("derives conserved operating and Development Fund truth from canonical facts", async () => {
    const { services } = await seedAllocationTruth({});
    const current = await services.allocation.getCurrent(ctxA);

    expect(current.status).toBe("available");
    if (current.status !== "available") return;
    expect(current.evidence).toMatchObject({
      organizationId: ctxA.organizationId,
      accountingCurrency: "USD",
      accountingCashBalanceMicros: 150_000_000n,
      activeCommitmentsMicros: 0n,
      canonicalFreeFundsMicros: 150_000_000n,
      protectedAnnualBudgetMicros: 100_000_000n,
      operatingAllocationMicros: 100_000_000n,
      developmentAllocationMicros: 50_000_000n,
    });
    expect(
      current.evidence.operatingAllocationMicros + current.evidence.developmentAllocationMicros,
    ).toBe(current.evidence.canonicalFreeFundsMicros);
    expect(current.evidence.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(current.evidence.outputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is idempotent under concurrency and appends evidence only when truth changes", async () => {
    const { services, clock } = await seedAllocationTruth({});
    const repository = createMemoryTreasuryFundAllocationRepository({
      treasury: services.domain.repository,
      catalog: services.catalogRepo,
      watcher: services.watcher,
    });
    let sequence = 0;
    const allocation = createTreasuryFundAllocationService({
      repository,
      now: clock.now,
      newId: () => `69000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    });

    const concurrent = await Promise.all(
      Array.from({ length: 12 }, () => allocation.getCurrent(ctxA)),
    );
    expect(concurrent.every((row) => row.status === "available")).toBe(true);
    const firstIds = new Set(
      concurrent.map((row) => (row.status === "available" ? row.evidence.id : "unavailable")),
    );
    expect(firstIds.size).toBe(1);
    expect(repository.listEvidence(ctxA)).toHaveLength(1);

    await seedCommitment(services, {
      id: COMMITMENT_ID,
      status: "APPROVED",
      amountMicros: 20_000_000n,
    });
    clock.set(new Date(NOW.getTime() + 60_000));
    const changed = await allocation.getCurrent(ctxA);
    expect(changed.status).toBe("available");
    if (changed.status !== "available") return;
    expect(changed.evidence.canonicalFreeFundsMicros).toBe(130_000_000n);
    expect(changed.evidence.developmentAllocationMicros).toBe(30_000_000n);
    expect(repository.listEvidence(ctxA)).toHaveLength(2);
    expect(repository.listEvidence(ctxA)[0]!.canonicalFreeFundsMicros).toBe(150_000_000n);
  });

  it("recalculates after corrections and ideal-budget replacement without rewriting history", async () => {
    const { services, clock } = await seedAllocationTruth({});
    const first = await services.allocation.getCurrent(ctxA);
    expect(first.status).toBe("available");
    if (first.status !== "available") return;

    const correctedAt = new Date(NOW.getTime() + 60_000);
    clock.set(correctedAt);
    await seedTx(services, {
      id: "69000000-0000-4000-8000-000000000004",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "CORRECTION",
      accountingAmountMicros: 60_000_000n,
      cashEffectMicros: -60_000_000n,
      correctsTransactionId: OPENING_TX_ID,
      occurredAt: correctedAt,
      createdAt: correctedAt,
      updatedAt: correctedAt,
    });
    await seedRecon(services, {
      id: "69000000-0000-4000-8000-000000000005",
      observedOnchainBalanceAtomic: 90_000_000n,
      accountingCashBalanceMicros: 90_000_000n,
      deltaMicros: 0n,
      asOfTime: correctedAt,
      createdAt: correctedAt,
    });
    const afterCorrection = await services.allocation.getCurrent(ctxA);
    expect(afterCorrection.status).toBe("available");
    if (afterCorrection.status !== "available") return;
    expect(afterCorrection.evidence.operatingAllocationMicros).toBe(90_000_000n);
    expect(afterCorrection.evidence.developmentAllocationMicros).toBe(0n);
    expect(afterCorrection.evidence.id).not.toBe(first.evidence.id);
    expect(first.evidence.canonicalFreeFundsMicros).toBe(150_000_000n);

    await services.catalogRepo.updateIdealBudget(ctxA, IDEAL_A, { status: "SUPERSEDED" });
    await seedIdeal(services, {
      id: SECOND_IDEAL_ID,
      amountMicros: 80_000_000n,
      createdAt: correctedAt,
    });
    const afterBudgetReplacement = await services.allocation.getCurrent(ctxA);
    expect(afterBudgetReplacement.status).toBe("available");
    if (afterBudgetReplacement.status !== "available") return;
    expect(afterBudgetReplacement.evidence.idealAnnualBudgetId).toBe(SECOND_IDEAL_ID);
    expect(afterBudgetReplacement.evidence.operatingAllocationMicros).toBe(80_000_000n);
    expect(afterBudgetReplacement.evidence.developmentAllocationMicros).toBe(10_000_000n);
  });

  it("ignores non-verified transactions and never leaks another organization", async () => {
    const { services } = await seedAllocationTruth({});
    const first = await services.allocation.getCurrent(ctxA);
    expect(first.status).toBe("available");
    await seedTx(services, {
      id: "69000000-0000-4000-8000-000000000006",
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
      cashEffectMicros: 999_000_000n,
    });
    const unchanged = await services.allocation.getCurrent(ctxA);
    expect(unchanged).toEqual(first);

    const other = await services.allocation.getCurrent(requireOrgContext(ORG_B));
    expect(other).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.IDEAL_BUDGET_MISSING,
    });
  });

  it("fails closed for missing or ambiguous authority and unsafe reconciliation", async () => {
    const missing = createWp6Bundle();
    expect(await missing.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.IDEAL_BUDGET_MISSING,
    });

    const ambiguous = await seedAllocationTruth({});
    await seedIdeal(ambiguous.services, {
      id: SECOND_IDEAL_ID,
      periodYear: 2027,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(await ambiguous.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.IDEAL_BUDGET_AMBIGUOUS,
    });

    const stale = await seedAllocationTruth({});
    stale.clock.set(new Date(NOW.getTime() + 10 * 60 * 1000 + 1));
    expect(await stale.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.BALANCE_RECONCILIATION_STALE,
    });

    const material = await seedAllocationTruth({});
    await seedTx(material.services, {
      id: "69000000-0000-4000-8000-000000000008",
      status: "RECONCILIATION_REQUIRED",
      direction: "INFLOW",
      cashEffectMicros: 1n,
    });
    expect(await material.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.MATERIAL_RECONCILIATION_REQUIRED,
    });
  });

  it("fails closed for incomplete, inconsistent, negative, or wrong-currency accounting", async () => {
    const incomplete = await seedAllocationTruth({});
    await seedTx(incomplete.services, {
      id: "69000000-0000-4000-8000-000000000009",
      status: "VERIFIED",
      direction: "INFLOW",
      cashEffectMicros: null,
    });
    expect(await incomplete.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE,
    });

    const mismatch = await seedAllocationTruth({});
    await seedTx(mismatch.services, {
      id: "69000000-0000-4000-8000-000000000010",
      status: "VERIFIED",
      direction: "INFLOW",
      cashEffectMicros: 1n,
    });
    expect(await mismatch.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.ACCOUNTING_BALANCE_MISMATCH,
    });

    const negative = await seedAllocationTruth({ cashMicros: 100_000_000n });
    await seedCommitment(negative.services, {
      id: COMMITMENT_ID,
      status: "APPROVED",
      amountMicros: 100_000_001n,
    });
    expect(await negative.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.NEGATIVE_FREE_FUNDS,
    });

    const currency = await seedAllocationTruth({});
    await currency.services.catalogRepo.updateIdealBudget(ctxA, IDEAL_A, {
      status: "SUPERSEDED",
    });
    await seedIdeal(currency.services, {
      id: SECOND_IDEAL_ID,
      currency: "EUR",
    });
    expect(await currency.services.allocation.getCurrent(ctxA)).toEqual({
      status: "unavailable",
      reason: fundAllocationUnavailableReasons.CURRENCY_MISMATCH,
    });
  });
});
