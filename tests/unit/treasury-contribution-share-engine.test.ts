import { describe, expect, it } from "vitest";

import { USDT_TRC20_CONTRACT } from "@/lib/waia-core/payment-watcher/watcher-config";
import {
  TREASURY_USDT_V1_NETWORK,
  TREASURY_USDT_V1_TOKEN_CONTRACT,
  USDT_NOMINAL_USD_POLICY_V1,
  getPublicContributionAggregate,
  getSelfContributionShare,
  isQualifyingContribution,
} from "@/lib/waia-core/treasury";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  ATTR_A,
  BUDGET_A,
  COMMIT_A,
  NOW,
  ORG_A,
  PLAN_A,
  USER_A,
  USER_B,
  createWp7Bundle,
  ctxA,
  seedBudget,
  seedCommitment,
  seedNeed,
  seedOpenAttribution,
  seedPlan,
  seedQualifyingContribution,
  seedTx,
  seedWatcherQualifyingContribution,
} from "@/tests/unit/helpers/treasury-wp7";

describe("DEE-606 WP-7 contribution share engine", () => {
  it("1-18 qualifying set Q requires VERIFIED INFLOW CONTRIBUTION USDT TRC-20 + policy", async () => {
    expect(TREASURY_USDT_V1_TOKEN_CONTRACT).toBe(USDT_TRC20_CONTRACT);
    expect(TREASURY_USDT_V1_NETWORK).toBe("TRC-20");

    const { services, engine } = createWp7Bundle();
    const verified = await seedQualifyingContribution(services, { id: "q-verified" });
    expect(isQualifyingContribution(verified)).toBe(true);

    const classified = await seedQualifyingContribution(services, {
      id: "q-classified",
      status: "CLASSIFIED",
    });
    const needsReview = await seedQualifyingContribution(services, {
      id: "q-needs",
      status: "NEEDS_REVIEW",
    });
    const recon = await seedQualifyingContribution(services, {
      id: "q-recon",
      status: "RECONCILIATION_REQUIRED",
    });
    const rejected = await seedQualifyingContribution(services, {
      id: "q-rejected",
      status: "REJECTED",
    });
    const duplicate = await seedQualifyingContribution(services, {
      id: "q-dup",
      status: "DUPLICATE",
    });
    expect(isQualifyingContribution(classified)).toBe(false);
    expect(isQualifyingContribution(needsReview)).toBe(false);
    expect(isQualifyingContribution(recon)).toBe(false);
    expect(isQualifyingContribution(rejected)).toBe(false);
    expect(isQualifyingContribution(duplicate)).toBe(false);

    const expense = await seedTx(services, {
      id: "q-expense",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    });
    const externalIn = await seedTx(services, {
      id: "q-ext-in",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "EXTERNAL_INFLOW",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    });
    const outflowContribution = await seedQualifyingContribution(services, {
      id: "q-wrong-dir",
      direction: "OUTFLOW",
    });
    expect(isQualifyingContribution(expense)).toBe(false);
    expect(isQualifyingContribution(externalIn)).toBe(false);
    expect(isQualifyingContribution(outflowContribution)).toBe(false);

    await seedQualifyingContribution(services, {
      id: "q-no-amount",
    });
    await services.domain.repository.updateTransaction(ctxA, "q-no-amount", {
      accountingAmountMicros: null,
    });
    const missingAfter = await services.domain.repository.getTransaction(ctxA, "q-no-amount");
    const wrongPolicy = await seedQualifyingContribution(services, {
      id: "q-policy",
      accountingDenominationPolicy: "NOT_USDT_NOMINAL",
    });
    const nonUsdt = await seedQualifyingContribution(services, {
      id: "q-btc",
      nativeAsset: "BTC",
    });
    const wrongDecimals = await seedQualifyingContribution(services, {
      id: "q-dec",
      nativeDecimals: 18,
    });
    expect(isQualifyingContribution(missingAfter!)).toBe(false);
    expect(isQualifyingContribution(wrongPolicy)).toBe(false);
    expect(isQualifyingContribution(nonUsdt)).toBe(false);
    expect(isQualifyingContribution(wrongDecimals)).toBe(false);

    const ethUsdt = await seedTx(services, {
      id: "q-eth",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      provenance: "WATCHER",
      nativeAsset: "USDT",
      nativeDecimals: 6,
      accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
      nativeContract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      canonicalNetwork: "ERC-20",
      canonicalTokenContract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    });
    const wrongContract = await seedQualifyingContribution(services, {
      id: "q-wrong-contract",
      nativeContract: "TWrongUsdtContract111111111111111111",
    });
    const noContract = await seedQualifyingContribution(services, {
      id: "q-no-contract",
      nativeContract: null,
    });
    expect(isQualifyingContribution(ethUsdt)).toBe(false);
    expect(isQualifyingContribution(wrongContract)).toBe(false);
    expect(isQualifyingContribution(noContract)).toBe(false);

    const watcherOk = await seedWatcherQualifyingContribution(services, { id: "q-watcher" });
    expect(isQualifyingContribution(watcherOk)).toBe(true);

    const privateOk = await seedQualifyingContribution(services, {
      id: "q-private",
      detailPublication: "PRIVATE",
    });
    const publicOk = await seedQualifyingContribution(services, {
      id: "q-public",
      detailPublication: "DETAIL_PUBLIC",
    });
    expect(isQualifyingContribution(privateOk)).toBe(true);
    expect(isQualifyingContribution(publicOk)).toBe(true);

    const agg = await getPublicContributionAggregate(ctxA, engine);
    expect(agg.qualifyingContributionCount).toBe(4);
    expect(agg.totalNetContributionMicros).toBe("4000000");
  });

  it("19-31 direct VERIFIED REFUND/CORRECTION netting; BALANCE_ADJUSTMENT excluded; fail closed", async () => {
    const { services, engine } = createWp7Bundle();
    await seedQualifyingContribution(services, {
      id: "c-base",
      accountingAmountMicros: 10_000_000n,
    });

    await seedTx(services, {
      id: "refund-out",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      cashEffectMicros: -1_000_000n,
      correctsTransactionId: "c-base",
    });
    await seedTx(services, {
      id: "corr-in",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "CORRECTION",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 500_000n,
      cashEffectMicros: 500_000n,
      correctsTransactionId: "c-base",
    });
    await seedTx(services, {
      id: "corr-neg",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "CORRECTION",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 250_000n,
      cashEffectMicros: -250_000n,
      correctsTransactionId: "c-base",
    });
    await seedTx(services, {
      id: "refund-unverified",
      status: "NEEDS_REVIEW",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 9_000_000n,
      cashEffectMicros: -9_000_000n,
      correctsTransactionId: "c-base",
    });
    await seedTx(services, {
      id: "corr-unverified",
      status: "CLASSIFIED",
      direction: "OUTFLOW",
      kind: "CORRECTION",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 9_000_000n,
      cashEffectMicros: -9_000_000n,
      correctsTransactionId: "c-base",
    });
    await seedTx(services, {
      id: "refund-unrelated",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 4_000_000n,
      cashEffectMicros: -4_000_000n,
      correctsTransactionId: null,
    });
    await seedTx(services, {
      id: "corr-other",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "CORRECTION",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 4_000_000n,
      cashEffectMicros: -4_000_000n,
      correctsTransactionId: "not-c-base",
    });
    await seedTx(services, {
      id: "nested-corr",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "CORRECTION",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 100_000n,
      cashEffectMicros: -100_000n,
      correctsTransactionId: "corr-neg",
    });
    await seedTx(services, {
      id: "bal-adj",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "BALANCE_ADJUSTMENT",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 8_000_000n,
      cashEffectMicros: -8_000_000n,
      correctsTransactionId: "c-base",
    });

    const netted = await getPublicContributionAggregate(ctxA, engine);
    expect(netted.qualifyingContributionCount).toBe(1);
    expect(netted.totalNetContributionMicros).toBe("9250000");

    const { services: failServices, engine: failEngine } = createWp7Bundle();
    await seedQualifyingContribution(failServices, { id: "c-null-cash" });
    await seedTx(failServices, {
      id: "refund-null",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1n,
      cashEffectMicros: null,
      correctsTransactionId: "c-null-cash",
    });
    await expect(getPublicContributionAggregate(ctxA, failEngine)).rejects.toBeInstanceOf(
      TreasuryValidationError,
    );
    await expect(getPublicContributionAggregate(ctxA, failEngine)).rejects.toMatchObject({
      reasonCode: "SHARE_ADJUSTMENT_INCOMPLETE",
    });

    const { services: reconServices, engine: reconEngine } = createWp7Bundle();
    await seedQualifyingContribution(reconServices, { id: "c-linked-recon" });
    await seedTx(reconServices, {
      id: "refund-recon",
      status: "RECONCILIATION_REQUIRED",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      cashEffectMicros: -1_000_000n,
      correctsTransactionId: "c-linked-recon",
    });
    const excluded = await getPublicContributionAggregate(ctxA, reconEngine);
    expect(excluded.qualifyingContributionCount).toBe(0);
    expect(excluded.totalNetContributionMicros).toBe("0");
  });

  it("32-42 current-open attribution: ATTRIBUTED numerator; UNMATCHED/ANONYMOUS/none in denominator only", async () => {
    const { services, engine } = createWp7Bundle();
    await seedQualifyingContribution(services, {
      id: "a-mine",
      accountingAmountMicros: 1_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-other",
      accountingAmountMicros: 2_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-unmatched",
      accountingAmountMicros: 3_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-anon",
      accountingAmountMicros: 4_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-none",
      accountingAmountMicros: 5_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-revoked",
      accountingAmountMicros: 6_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-reassign",
      accountingAmountMicros: 7_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-missing-user",
      accountingAmountMicros: 8_000_000n,
    });
    await seedQualifyingContribution(services, {
      id: "a-consent",
      accountingAmountMicros: 9_000_000n,
    });

    await seedOpenAttribution(services, {
      id: "attr-mine",
      transactionId: "a-mine",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
    });
    await seedOpenAttribution(services, {
      id: "attr-other",
      transactionId: "a-other",
      status: "ATTRIBUTED",
      contributorUserId: USER_B,
    });
    await seedOpenAttribution(services, {
      id: "attr-unmatched",
      transactionId: "a-unmatched",
      status: "UNMATCHED",
    });
    await seedOpenAttribution(services, {
      id: "attr-anon",
      transactionId: "a-anon",
      status: "ANONYMOUS",
    });
    await seedOpenAttribution(services, {
      id: "attr-revoked",
      transactionId: "a-revoked",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      revokedAt: NOW,
    });
    await seedOpenAttribution(services, {
      id: "attr-hist",
      transactionId: "a-reassign",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      revokedAt: NOW,
    });
    await seedOpenAttribution(services, {
      id: "attr-current",
      transactionId: "a-reassign",
      status: "ATTRIBUTED",
      contributorUserId: USER_B,
    });
    await seedOpenAttribution(services, {
      id: "attr-missing",
      transactionId: "a-missing-user",
      status: "ATTRIBUTED",
      contributorUserId: null,
    });
    await seedOpenAttribution(services, {
      id: "attr-consent",
      transactionId: "a-consent",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      consentPublicIdentity: true,
    });

    const selfA = await getSelfContributionShare(ctxA, USER_A, engine);
    const selfB = await getSelfContributionShare(ctxA, USER_B, engine);
    const denom = "45000000";
    expect(selfA.denominatorMicros).toBe(denom);
    expect(selfB.denominatorMicros).toBe(denom);
    expect(selfA.numeratorMicros).toBe("10000000");
    expect(selfB.numeratorMicros).toBe("9000000");
    expect(selfA.isZeroShare).toBe(false);

    const recordA = await engine.computeSelfRecord(ctxA, USER_A);
    expect(recordA.partsPerMillion).toBe("222222");
    expect(recordA.contributions.map((row) => row.transactionId)).toEqual(["a-mine", "a-consent"]);
    expect(recordA.contributions.map((row) => row.contributedAmountMicros)).toEqual([
      "1000000",
      "9000000",
    ]);

    const { services: ambServices, engine: ambEngine } = createWp7Bundle();
    await seedQualifyingContribution(ambServices, { id: "amb-tx" });
    await ambServices.domain.repository.insertAttribution({
      id: "open-1",
      organizationId: ORG_A,
      transactionId: "amb-tx",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
      revokedAt: null,
    });
    await ambServices.domain.repository.insertAttribution({
      id: "open-2",
      organizationId: ORG_A,
      transactionId: "amb-tx",
      status: "UNMATCHED",
      contributorUserId: null,
      revokedAt: null,
    });
    await expect(getSelfContributionShare(ctxA, USER_A, ambEngine)).rejects.toMatchObject({
      reasonCode: "ATTRIBUTION_OPEN_AMBIGUOUS",
    });
  });

  it("43-55 denominator is global Q; expenses/outflows/commitments/runway/budget/publication do not dilute; >50 unpaginated", async () => {
    const { services, engine, facts } = createWp7Bundle();
    for (let i = 0; i < 55; i += 1) {
      await seedQualifyingContribution(services, {
        id: `q-${i}`,
        accountingAmountMicros: 1_000_000n,
        occurredAt: new Date(NOW.getTime() - i * 1000),
      });
    }
    await seedOpenAttribution(services, {
      id: ATTR_A,
      transactionId: "q-0",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
    });
    await seedOpenAttribution(services, {
      id: "attr-unmatched-50",
      transactionId: "q-1",
      status: "UNMATCHED",
    });
    await seedOpenAttribution(services, {
      id: "attr-anon-50",
      transactionId: "q-2",
      status: "ANONYMOUS",
    });

    const before = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(before.denominatorMicros).toBe("55000000");
    expect(before.numeratorMicros).toBe("1000000");

    await seedTx(services, {
      id: "dilute-expense",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXPENSE",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 40_000_000n,
      cashEffectMicros: -40_000_000n,
    });
    await seedTx(services, {
      id: "dilute-outflow",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "EXTERNAL_OUTFLOW",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 3_000_000n,
      cashEffectMicros: -3_000_000n,
    });
    await seedTx(services, {
      id: "dilute-inflow",
      status: "VERIFIED",
      direction: "INFLOW",
      kind: "EXTERNAL_INFLOW",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 9_000_000n,
      cashEffectMicros: 9_000_000n,
    });
    await seedCommitment(services, { id: COMMIT_A, status: "APPROVED", amountMicros: 12_000_000n });
    await seedBudget(services, { id: BUDGET_A, plannedAmountMicros: 99_000_000n });
    await seedNeed(services, { id: "need-share", requiredAmountMicros: 50_000_000n });
    await seedPlan(services, { id: PLAN_A, dailyBurnMicros: 2_000_000n });
    await services.domain.repository.updateTransaction(ctxA, "q-3", {
      detailPublication: "DETAIL_PUBLIC",
    });

    const after = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(after.denominatorMicros).toBe("55000000");
    expect(after.numeratorMicros).toBe("1000000");

    const paginated = await services.domain.repository.listTransactions(ctxA, {
      kind: "CONTRIBUTION",
    });
    expect(paginated.length).toBe(50);
    const loaded = await facts.loadContributionFacts(ctxA);
    expect(loaded.filter((row) => row.kind === "CONTRIBUTION").length).toBe(55);
    const agg = await getPublicContributionAggregate(ctxA, engine);
    expect(agg.qualifyingContributionCount).toBe(55);
    expect(agg.totalNetContributionMicros).toBe("55000000");
  });

  it("56-64 exact BigInt fraction; denominator<=0 is zero share; no Number money authority", async () => {
    const huge = 9_007_199_254_740_993n;
    const { services, engine } = createWp7Bundle();
    await seedQualifyingContribution(services, {
      id: "huge-a",
      accountingAmountMicros: huge,
      nativeAmountAtomic: huge,
      cashEffectMicros: huge,
    });
    await seedQualifyingContribution(services, {
      id: "huge-b",
      accountingAmountMicros: huge,
      nativeAmountAtomic: huge,
      cashEffectMicros: huge,
    });
    await seedOpenAttribution(services, {
      id: "attr-huge",
      transactionId: "huge-a",
      status: "ATTRIBUTED",
      contributorUserId: USER_A,
    });
    const self = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(self.numeratorMicros).toBe(huge.toString(10));
    expect(self.denominatorMicros).toBe((huge * 2n).toString(10));
    expect(Number.isSafeInteger(Number(huge))).toBe(false);
    expect(self).not.toHaveProperty("percentage");
    expect(self).not.toHaveProperty("equityPercentage");
    expect(self).not.toHaveProperty("ownershipPercentage");

    const { engine: emptyEngine } = createWp7Bundle();
    const zero = await getSelfContributionShare(ctxA, USER_A, emptyEngine);
    expect(zero.isZeroShare).toBe(true);
    expect(zero.numeratorMicros).toBe("0");
    expect(zero.denominatorMicros).toBe("0");

    const { services: negServices, engine: negEngine } = createWp7Bundle();
    await seedQualifyingContribution(negServices, {
      id: "over-refunded",
      accountingAmountMicros: 1_000_000n,
    });
    await seedTx(negServices, {
      id: "big-refund",
      status: "VERIFIED",
      direction: "OUTFLOW",
      kind: "REFUND",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 2_000_000n,
      cashEffectMicros: -2_000_000n,
      correctsTransactionId: "over-refunded",
    });
    const negativeDenom = await getSelfContributionShare(ctxA, USER_A, negEngine);
    expect(negativeDenom.isZeroShare).toBe(true);
    expect(negativeDenom.numeratorMicros).toBe("0");
    expect(negativeDenom.denominatorMicros).toBe("0");

    const engineSrc = [
      "lib/waia-core/treasury/contribution-share.ts",
      "lib/waia-core/treasury/share/engine.ts",
      "lib/waia-core/treasury/share/public-aggregate.ts",
      "lib/waia-core/treasury/share/self-share.ts",
    ];
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = engineSrc.map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");
    expect(src).not.toMatch(/Number\((numerator|denominator|net|total)/);
    expect(src).not.toContain("parseFloat(");
    expect(src).not.toContain("equityPercentage");
    expect(src).not.toContain("ownershipPercentage");
    expect(src).not.toContain("governanceWeight");
    expect(src).not.toContain("votingPower");
    expect(src).not.toContain("profitShare");
  });
});
