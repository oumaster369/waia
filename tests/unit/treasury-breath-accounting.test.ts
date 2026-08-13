import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createMemoryTreasuryBreathFactsRepository } from "@/lib/waia-core/treasury/breath/memory-repository";
import {
  budgetFillRatioDisplay,
  computeVerifiedAccountingTotals,
  deriveActiveCommittedFunds,
  deriveCurrentFreeFunds,
} from "@/lib/waia-core/treasury/breath/accounting";
import { BREATH_FILL_RATIO_SCALE } from "@/lib/waia-core/treasury/breath/types";
import { getBreathPublicSnapshot } from "@/lib/waia-core/treasury";
import {
  BUDGET_A,
  BUDGET_B,
  COMMIT_A,
  NEED_A,
  NEED_B,
  createWp6Bundle,
  ctxA,
  seedBudget,
  seedCommitment,
  seedNeed,
  seedPublishableControl,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";

describe("DEE-606 WP-6 Breath accounting", () => {
  it("1-14 complete VERIFIED set, cash formulas, PRIVATE counts, fail-closed incomplete", async () => {
    const { services } = createWp6Bundle();
    await seedPublishableControl(services);
    for (let i = 0; i < 60; i += 1) {
      await seedTx(services, {
        id: `v-${i}`,
        status: "VERIFIED",
        direction: "INFLOW",
        kind: "CONTRIBUTION",
        cashEffectMicros: 1_000_000n,
        accountingAmountMicros: 1_000_000n,
        detailPublication: i === 0 ? "PRIVATE" : "DETAIL_PUBLIC",
      });
    }
    await seedTx(services, {
      id: "pending-tx",
      status: "NEEDS_REVIEW",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: 9_000_000n,
    });
    await seedTx(services, {
      id: "opening",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 5_000_000n,
      accountingAmountMicros: 5_000_000n,
    });
    await seedTx(services, {
      id: "internal",
      status: "VERIFIED",
      direction: "INTERNAL",
      kind: "INTERNAL_TRANSFER",
      cashEffectMicros: 0n,
      accountingAmountMicros: 4_000_000n,
    });
    await seedTx(services, {
      id: "outflow",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      cashEffectMicros: -2_000_000n,
      accountingAmountMicros: 2_000_000n,
    });
    await seedTx(services, {
      id: "pos-adj",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "BALANCE_ADJUSTMENT",
      cashEffectMicros: 3_000_000n,
      accountingAmountMicros: 3_000_000n,
    });
    await seedTx(services, {
      id: "neg-adj",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "REFUND",
      cashEffectMicros: -1_000_000n,
      accountingAmountMicros: 1_000_000n,
    });
    const listed = await services.domain.repository.listTransactions(ctxA, { status: "VERIFIED" });
    expect(listed).toHaveLength(50);
    const facts = createMemoryTreasuryBreathFactsRepository({
      treasury: services.domain.repository,
      catalog: services.catalogRepo,
      watcher: services.watcher,
    });
    const loaded = await facts.loadFacts(ctxA);
    const verified = loaded.transactions.filter((row) => row.status === "VERIFIED");
    expect(verified.length).toBeGreaterThan(50);
    expect(verified).toHaveLength(65);
    const totals = computeVerifiedAccountingTotals(loaded.transactions);
    expect(totals.entered).toBe(60_000_000n + 5_000_000n + 3_000_000n);
    expect(totals.spent).toBe(2_000_000n + 1_000_000n);
    expect(totals.remaining).toBe(totals.entered - totals.spent);
    expect(totals.remaining).toBe(totals.accountingCashBalance);
    const preview = await services.breath.getAdminPreview(ctxA);
    expect(preview.resources?.entered).toBe(totals.entered.toString(10));
    expect(preview.resources?.spent).toBe(totals.spent.toString(10));
    expect(preview.resources?.remaining).toBe(totals.remaining.toString(10));

    const { services: incomplete } = createWp6Bundle();
    await seedPublishableControl(incomplete);
    await seedTx(incomplete, {
      id: "bad",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: null,
    });
    const pending = await incomplete.breath.getAdminPreview(ctxA);
    expect(pending.status).toBe("pending");
    expect(pending.pendingReasons).toContain("VERIFIED_FINANCIAL_ROW_INCOMPLETE");
    expect(pending.resources).toBeNull();
    expect(pending.currentFreeFunds).toBeNull();

    const huge = 9_007_199_254_740_993n;
    const { services: big } = createWp6Bundle();
    await seedPublishableControl(big);
    await seedTx(big, {
      id: "huge",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      cashEffectMicros: huge,
      accountingAmountMicros: huge,
    });
    const bigTotals = computeVerifiedAccountingTotals(
      (
        await createMemoryTreasuryBreathFactsRepository({
          treasury: big.domain.repository,
          catalog: big.catalogRepo,
          watcher: big.watcher,
        }).loadFacts(ctxA)
      ).transactions,
    );
    expect(bigTotals.entered).toBe(huge);
    expect(bigTotals.entered > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("15-23 active commitments and free funds, no mutable committed scalar", async () => {
    const { services } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedTx(services, {
      id: "cash",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "OPENING_BALANCE",
      cashEffectMicros: 10_000_000n,
      accountingAmountMicros: 10_000_000n,
    });
    await seedCommitment(services, { id: "appr", status: "APPROVED", amountMicros: 2_000_000n });
    await seedCommitment(services, { id: "rel", status: "RELEASED", amountMicros: 3_000_000n });
    await seedCommitment(services, { id: "draft", status: "DRAFT", amountMicros: 9_000_000n });
    await seedCommitment(services, { id: "ful", status: "FULFILLED", amountMicros: 9_000_000n });
    await seedCommitment(services, { id: "can", status: "CANCELLED", amountMicros: 9_000_000n });
    const facts = await createMemoryTreasuryBreathFactsRepository({
      treasury: services.domain.repository,
      catalog: services.catalogRepo,
      watcher: services.watcher,
    }).loadFacts(ctxA);
    const allocated = deriveActiveCommittedFunds(facts.commitments);
    expect(allocated).toBe(5_000_000n);
    const cash = computeVerifiedAccountingTotals(facts.transactions).accountingCashBalance;
    expect(deriveCurrentFreeFunds(cash, allocated)).toBe(5_000_000n);
    const preview = await services.breath.getAdminPreview(ctxA);
    expect(preview.resources?.allocated).toBe("5000000");
    expect(preview.currentFreeFunds).toBe("5000000");
    const over = deriveCurrentFreeFunds(1_000_000n, 5_000_000n);
    expect(over).toBe(0n);
    const src = readFileSync(
      path.join(process.cwd(), "lib/waia-core/treasury/breath/accounting.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/committedAmountMicros\s*=/);
    expect(src).toContain("isActiveCommittedStatus");
  });

  it("24-35 budget derivation, signed remaining, bounded fill ratio", async () => {
    const { services } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedBudget(services, { id: BUDGET_A, plannedAmountMicros: 10_000_000n });
    await seedTx(services, {
      id: "fund-pub",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      budgetId: BUDGET_A,
      cashEffectMicros: 4_000_000n,
      accountingAmountMicros: 4_000_000n,
      detailPublication: "DETAIL_PUBLIC",
    });
    await seedTx(services, {
      id: "fund-priv",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      budgetId: BUDGET_A,
      cashEffectMicros: 1_000_000n,
      accountingAmountMicros: 1_000_000n,
      detailPublication: "PRIVATE",
    });
    await seedTx(services, {
      id: "inflow-not-contrib",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "EXTERNAL_INFLOW",
      budgetId: BUDGET_A,
      cashEffectMicros: 7_000_000n,
      accountingAmountMicros: 7_000_000n,
    });
    await seedTx(services, {
      id: "spend",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXTERNAL_OUTFLOW",
      budgetId: BUDGET_A,
      cashEffectMicros: -3_000_000n,
      accountingAmountMicros: 3_000_000n,
    });
    await seedCommitment(services, {
      id: COMMIT_A,
      status: "APPROVED",
      budgetId: BUDGET_A,
      amountMicros: 8_000_000n,
    });
    const preview = await services.breath.getAdminPreview(ctxA);
    expect(preview.budget?.planned).toBe("10000000");
    expect(preview.budget?.funded).toBe("5000000");
    expect(preview.budget?.committed).toBe("8000000");
    expect(preview.budget?.spent).toBe("3000000");
    expect(preview.budget?.remaining).toBe("-1000000");
    expect(preview.budget?.fillRatio).toBe(0.5);
    expect(preview.budget?.remaining.startsWith("-")).toBe(true);

    const fundedHuge = 9_007_199_254_740_993n;
    const plannedHuge = 18_014_398_509_481_986n;
    const ratio = budgetFillRatioDisplay(fundedHuge, plannedHuge);
    expect(ratio).toBe(0.5);
    expect(budgetFillRatioDisplay(plannedHuge * 2n, plannedHuge)).toBe(1);
    expect(budgetFillRatioDisplay(0n, plannedHuge)).toBe(0);
    const accountingSrc = readFileSync(
      path.join(process.cwd(), "lib/waia-core/treasury/breath/accounting.ts"),
      "utf8",
    );
    expect(accountingSrc).toContain("BREATH_FILL_RATIO_SCALE");
    expect(accountingSrc).not.toMatch(/Number\(funded\)/);
    expect(accountingSrc).not.toMatch(/Number\(planned\)/);
    expect(BREATH_FILL_RATIO_SCALE).toBe(1_000_000n);

    const { services: none } = createWp6Bundle();
    await seedPublishableControl(none);
    const absent = await none.breath.getAdminPreview(ctxA);
    expect(absent.budget).toBeNull();
    expect(absent.componentStatus.budget).toBe("absent");

    const { services: many } = createWp6Bundle();
    await seedPublishableControl(many);
    await seedBudget(many, { id: BUDGET_A, code: "A" });
    await seedBudget(many, { id: BUDGET_B, code: "B" });
    const ambiguous = await many.breath.getAdminPreview(ctxA);
    expect(ambiguous.budget).toBeNull();
    expect(ambiguous.pendingReasons).toContain("ACTIVE_PUBLIC_BUDGET_AMBIGUOUS");
    expect(ambiguous.status).toBe("published");
  });

  it("36-41 funding need derived funded, no caller scalar, no invented priority", async () => {
    const { services } = createWp6Bundle();
    await seedPublishableControl(services);
    await seedNeed(services, { id: NEED_A, requiredAmountMicros: 8_000_000n });
    await seedTx(services, {
      id: "need-fund",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      fundingNeedId: NEED_A,
      cashEffectMicros: 3_000_000n,
      accountingAmountMicros: 3_000_000n,
    });
    const preview = await services.breath.getAdminPreview(ctxA);
    expect(preview.resources?.neededNext).toBe("5000000");

    const { services: none } = createWp6Bundle();
    await seedPublishableControl(none);
    expect((await none.breath.getAdminPreview(ctxA)).resources?.neededNext).toBeNull();

    const { services: many } = createWp6Bundle();
    await seedPublishableControl(many);
    await seedNeed(many, { id: NEED_A });
    await seedNeed(many, { id: NEED_B, title: "Other" });
    const ambiguous = await many.breath.getAdminPreview(ctxA);
    expect(ambiguous.resources?.neededNext).toBeNull();
    expect(ambiguous.pendingReasons).toContain("PUBLIC_FUNDING_NEED_AMBIGUOUS");
    const breathSrc = readFileSync(
      path.join(process.cwd(), "lib/waia-core/treasury/breath/read-model.ts"),
      "utf8",
    );
    expect(breathSrc).not.toMatch(/fundedAmountMicros:\s*input/);
    expect(breathSrc).toContain("contributionFundedMicros");
    expect(breathSrc).not.toMatch(/priority/);
    const publicSnap = await getBreathPublicSnapshot(ctxA, services.breath);
    expect(publicSnap.resources?.neededNext).toBe("5000000");
  });
});
