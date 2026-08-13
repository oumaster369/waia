import { describe, expect, it } from "vitest";

import {
  USDT_NOMINAL_USD_POLICY_V1,
  accountingMicrosFromUsdtNominal,
  computeContributionShareTotals,
  contributionShareOrZero,
  isQualifyingContribution,
  type TreasuryAttributionRecord,
  type TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury";

function tx(
  partial: Partial<TreasuryTransactionRecord> &
    Pick<TreasuryTransactionRecord, "id" | "kind" | "status">,
): TreasuryTransactionRecord {
  return {
    organizationId: "org-a",
    detailPublication: "PRIVATE",
    provenance: "MANUAL",
    canonicalNetwork: null,
    canonicalTokenContract: null,
    canonicalTxHash: null,
    canonicalTransferIndex: null,
    direction: "INFLOW",
    fundBucketCode: "UNASSIGNED",
    nativeAmountAtomic: 1_000_000n,
    nativeDecimals: 6,
    nativeAsset: "USDT",
    nativeContract: null,
    accountingAmountMicros: 1_000_000n,
    accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
    cashEffectMicros: 1_000_000n,
    counterpartyIsInternal: false,
    occurredAt: new Date(),
    purpose: null,
    category: null,
    counterpartyDisplay: null,
    publishCounterparty: false,
    projectModule: null,
    milestoneStage: null,
    budgetId: null,
    fundingNeedId: null,
    description: null,
    internalNotes: null,
    publicDescription: null,
    txHash: null,
    correctsTransactionId: null,
    duplicateOfTransactionId: null,
    detailSupersededById: null,
    ledgerInceptionId: null,
    verifiedAt: null,
    verifiedByUserId: null,
    detailPublishedAt: null,
    detailPublishedByUserId: null,
    latestRevisionId: null,
    recordContentDigest: "x",
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function attr(
  partial: Pick<TreasuryAttributionRecord, "transactionId" | "status"> &
    Partial<TreasuryAttributionRecord>,
): TreasuryAttributionRecord {
  return {
    id: `${partial.transactionId}-${partial.status}`,
    organizationId: "org-a",
    contributorUserId: partial.contributorUserId ?? null,
    revokedAt: partial.revokedAt ?? null,
    ...partial,
  };
}

describe("treasury contribution-share WP-2 foundation (DEE-606)", () => {
  const attributed = tx({ id: "c-attr", kind: "CONTRIBUTION", status: "VERIFIED" });
  const unmatched = tx({
    id: "c-unmatched",
    kind: "CONTRIBUTION",
    status: "VERIFIED",
    accountingAmountMicros: 2_000_000n,
    cashEffectMicros: 2_000_000n,
    nativeAmountAtomic: 2_000_000n,
  });
  const anonymous = tx({
    id: "c-anon",
    kind: "CONTRIBUTION",
    status: "VERIFIED",
    accountingAmountMicros: 3_000_000n,
    cashEffectMicros: 3_000_000n,
    nativeAmountAtomic: 3_000_000n,
  });
  const unverified = tx({ id: "c-draft", kind: "CONTRIBUTION", status: "CLASSIFIED" });
  const expense = tx({
    id: "exp",
    kind: "EXPENSE",
    status: "VERIFIED",
    direction: "OUTFLOW",
    cashEffectMicros: -1_000_000n,
  });

  it("only VERIFIED CONTRIBUTION qualifies", () => {
    expect(isQualifyingContribution(attributed)).toBe(true);
    expect(isQualifyingContribution(unverified)).toBe(false);
    expect(isQualifyingContribution(expense)).toBe(false);
  });

  it("keeps UNMATCHED and ANONYMOUS in the denominator and ignores expenses/commitments", () => {
    const attributions = new Map<string, TreasuryAttributionRecord[]>([
      [
        attributed.id,
        [attr({ transactionId: attributed.id, status: "ATTRIBUTED", contributorUserId: "user-1" })],
      ],
      [unmatched.id, [attr({ transactionId: unmatched.id, status: "UNMATCHED" })]],
      [anonymous.id, [attr({ transactionId: anonymous.id, status: "ANONYMOUS" })]],
    ]);
    const totals = computeContributionShareTotals({
      contributions: [attributed, unmatched, anonymous, unverified],
      adjustments: [],
      attributionsByTransactionId: attributions,
      contributorUserId: "user-1",
      expenses: [expense],
      commitmentsAmountMicros: 99_000_000n,
    });
    expect(totals.denominatorMicros).toBe(6_000_000n);
    expect(totals.numeratorMicros).toBe(1_000_000n);
  });

  it("returns zero share when denominator is zero", () => {
    const share = contributionShareOrZero({ numeratorMicros: 1n, denominatorMicros: 0n });
    expect(share.isZeroShare).toBe(true);
    expect(share.numeratorMicros).toBe(0n);
    expect(share.denominatorMicros).toBe(0n);
  });

  it("keeps bigint-safe exact numerator/denominator math", () => {
    const huge = 9_007_199_254_740_993n;
    const totals = computeContributionShareTotals({
      contributions: [
        tx({
          id: "huge",
          kind: "CONTRIBUTION",
          status: "VERIFIED",
          accountingAmountMicros: huge,
          nativeAmountAtomic: huge,
          cashEffectMicros: huge,
        }),
      ],
      adjustments: [],
      attributionsByTransactionId: new Map([
        [
          "huge",
          [
            attr({
              transactionId: "huge",
              status: "ATTRIBUTED",
              contributorUserId: "user-1",
            }),
          ],
        ],
      ]),
      contributorUserId: "user-1",
    });
    expect(totals.numeratorMicros).toBe(huge);
    expect(totals.denominatorMicros).toBe(huge);
    expect(Number.isSafeInteger(Number(huge))).toBe(false);
  });

  it("maps USDT nominal policy exactly", () => {
    expect(
      accountingMicrosFromUsdtNominal({
        nativeAmountAtomic: 7n,
        nativeDecimals: 6,
        nativeAsset: "USDT",
      }),
    ).toBe(7n);
  });
});
