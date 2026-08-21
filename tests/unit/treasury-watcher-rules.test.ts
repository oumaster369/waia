import { describe, expect, it } from "vitest";

import { computeCanonicalCashEffect, USDT_NOMINAL_USD_POLICY_V1 } from "@/lib/waia-core/treasury";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import {
  computeConfirmationDepth,
  computeTreasuryScanRange,
  seedLastScannedBlock,
} from "@/lib/waia-core/treasury/watcher/block-height";
import { computeTreasuryRawEventDigest } from "@/lib/waia-core/treasury/watcher/digest";
import { treasuryObservationIdempotencyKey } from "@/lib/waia-core/treasury/watcher/idempotency";
import {
  assignObservationRoles,
  matchWatchedAddresses,
} from "@/lib/waia-core/treasury/watcher/matching";
import { observationStatusFromDepth } from "@/lib/waia-core/treasury/watcher/observation-status";
import {
  TREASURY_RECON_TOLERANCE_MICROS,
  accountingCashBalanceAt,
  classifyReconciliation,
  pendingExplanationMicros,
} from "@/lib/waia-core/treasury/watcher/reconciliation";
import type { TreasuryChainObservationRecord } from "@/lib/waia-core/treasury/watcher/types";
import { ORG_A } from "@/tests/unit/helpers/treasury-wp2";
import {
  ADDR_A,
  ADDR_B,
  ADDR_EXT,
  ADDR_EXT_2,
  USDT_TRC20_CONTRACT,
  WATCHED_A,
  WATCHED_B,
} from "@/tests/unit/helpers/treasury-wp3";

const now = new Date("2026-08-13T12:00:00.000Z");

function address(id: string, addr: string, scope: "INBOUND" | "OUTBOUND" | "BOTH") {
  return {
    id,
    organizationId: ORG_A,
    network: "TRC-20" as const,
    address: addr,
    tokenContract: USDT_TRC20_CONTRACT,
    assetCode: "USDT",
    directionScope: scope,
    includeInBalanceRecon: true,
    label: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

function observation(
  overrides: Partial<TreasuryChainObservationRecord> &
    Pick<TreasuryChainObservationRecord, "id" | "watchedAddressId" | "direction" | "txHash">,
): TreasuryChainObservationRecord {
  return {
    organizationId: ORG_A,
    network: "TRC-20",
    tokenContract: USDT_TRC20_CONTRACT,
    assetCode: "USDT",
    transferIndex: 0,
    fromAddress: ADDR_EXT,
    toAddress: ADDR_A,
    nativeAmountAtomic: 1_000_000n,
    nativeDecimals: 6,
    blockHeight: "105",
    blockTimestamp: now,
    observedAt: now,
    confirmationsObserved: 2,
    confirmationsRequired: 3,
    observationStatus: "OBSERVED",
    idempotencyKey: "k",
    ingestionSource: "treasury-watcher",
    rawEventDigest: "d",
    relatedPaymentId: null,
    createdAt: now,
    ...overrides,
  };
}

function verifiedTx(
  overrides: Partial<TreasuryTransactionRecord> &
    Pick<TreasuryTransactionRecord, "id" | "provenance">,
): TreasuryTransactionRecord {
  return {
    organizationId: ORG_A,
    status: "VERIFIED",
    detailPublication: "PRIVATE",
    canonicalNetwork: "TRC-20",
    canonicalTokenContract: USDT_TRC20_CONTRACT,
    canonicalTxHash: `hash-${overrides.id}`,
    canonicalTransferIndex: 0,
    direction: "INFLOW",
    kind: "CONTRIBUTION",
    fundBucketCode: "UNASSIGNED",
    nativeAmountAtomic: 1_000_000n,
    nativeDecimals: 6,
    nativeAsset: "USDT",
    nativeContract: USDT_TRC20_CONTRACT,
    accountingAmountMicros: 1_000_000n,
    accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
    cashEffectMicros: 1_000_000n,
    counterpartyIsInternal: false,
    occurredAt: now,
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
    txHash: `hash-${overrides.id}`,
    correctsTransactionId: null,
    duplicateOfTransactionId: null,
    detailSupersededById: null,
    ledgerInceptionId: null,
    verifiedAt: now,
    verifiedByUserId: null,
    detailPublishedAt: null,
    detailPublishedByUserId: null,
    latestRevisionId: null,
    recordContentDigest: "d",
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    counterpartyId: overrides.counterpartyId ?? null,
    accountId: overrides.accountId ?? null,
    categoryId: overrides.categoryId ?? null,
    projectId: overrides.projectId ?? null,
  };
}

describe("DEE-606 WP-3 watcher pure rules", () => {
  it("8-9,13. scan range derives from watcher_start_block and never crosses inception", () => {
    expect(seedLastScannedBlock("100")).toBe("99");
    const range = computeTreasuryScanRange({
      lastScannedBlock: "50",
      tipBlock: "110",
      watcherStartBlock: "100",
      inceptionBlock: "99",
      rescanWindow: 40,
      maxBlocksPerCycle: 20,
    });
    expect(range.fromBlock).toBe("100");
    expect(BigInt(range.fromBlock) > 99n).toBe(true);
    const rescan = computeTreasuryScanRange({
      lastScannedBlock: "105",
      tipBlock: "110",
      watcherStartBlock: "100",
      inceptionBlock: "99",
      rescanWindow: 40,
      maxBlocksPerCycle: 20,
    });
    expect(BigInt(rescan.fromBlock) >= 100n).toBe(true);
  });

  it("18/36-37. confirmation depth maps OBSERVED then CONFIRMED", () => {
    expect(computeConfirmationDepth("110", "109")).toBe(2);
    expect(observationStatusFromDepth({ depth: 0, confirmationsRequired: 3 })).toBeNull();
    expect(observationStatusFromDepth({ depth: 1, confirmationsRequired: 3 })).toBe("OBSERVED");
    expect(observationStatusFromDepth({ depth: 2, confirmationsRequired: 3 })).toBe("OBSERVED");
    expect(observationStatusFromDepth({ depth: 3, confirmationsRequired: 3 })).toBe("CONFIRMED");
  });

  it("27-32. watched-address matching and direction_scope", () => {
    const both = [address(WATCHED_A, ADDR_A, "BOTH"), address(WATCHED_B, ADDR_B, "BOTH")];
    expect(
      matchWatchedAddresses({ fromAddress: ADDR_EXT, toAddress: ADDR_A, addresses: both }),
    ).toEqual([
      expect.objectContaining({
        direction: "INFLOW",
        address: expect.objectContaining({ id: WATCHED_A }),
      }),
    ]);
    expect(
      matchWatchedAddresses({ fromAddress: ADDR_A, toAddress: ADDR_EXT, addresses: both }),
    ).toEqual([
      expect.objectContaining({
        direction: "OUTFLOW",
        address: expect.objectContaining({ id: WATCHED_A }),
      }),
    ]);
    expect(
      matchWatchedAddresses({ fromAddress: ADDR_EXT, toAddress: ADDR_EXT_2, addresses: both }),
    ).toHaveLength(0);
    expect(
      matchWatchedAddresses({
        fromAddress: ADDR_A,
        toAddress: ADDR_EXT,
        addresses: [address(WATCHED_A, ADDR_A, "INBOUND")],
      }),
    ).toHaveLength(0);
    expect(
      matchWatchedAddresses({
        fromAddress: ADDR_EXT,
        toAddress: ADDR_A,
        addresses: [address(WATCHED_A, ADDR_A, "OUTBOUND")],
      }),
    ).toHaveLength(0);
    expect(
      matchWatchedAddresses({
        fromAddress: ADDR_EXT,
        toAddress: ADDR_A,
        addresses: [address(WATCHED_A, ADDR_A, "INBOUND")],
      })[0]?.direction,
    ).toBe("INFLOW");
    const internal = assignObservationRoles(
      matchWatchedAddresses({ fromAddress: ADDR_A, toAddress: ADDR_B, addresses: both }),
    );
    expect(internal).toHaveLength(2);
    expect(internal.find((row) => row.direction === "OUTFLOW")?.observationRole).toBe("PRIMARY");
    expect(internal.find((row) => row.direction === "INFLOW")?.observationRole).toBe(
      "INTERNAL_COUNTERPARTY",
    );
  });

  it("33,35. exact idempotency key and deterministic raw digest", () => {
    const key = treasuryObservationIdempotencyKey({
      network: "TRC-20",
      txHash: "abc",
      transferIndex: 0,
      watchedAddressId: WATCHED_A,
    });
    expect(key).toBe(`TRC-20:abc:0:${WATCHED_A}`);
    const facts = {
      network: "TRC-20",
      tokenContract: USDT_TRC20_CONTRACT,
      txHash: "abc",
      transferIndex: 0,
      fromAddress: ADDR_EXT,
      toAddress: ADDR_A,
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      blockHeight: "105",
      blockTimestamp: now.toISOString(),
    };
    expect(computeTreasuryRawEventDigest(facts)).toBe(computeTreasuryRawEventDigest(facts));
    expect(computeTreasuryRawEventDigest({ ...facts, nativeAmountAtomic: 2_000_000n })).not.toBe(
      computeTreasuryRawEventDigest(facts),
    );
  });

  it("60. Human INTERNAL_TRANSFER uses canonical cash engine 0", () => {
    expect(
      computeCanonicalCashEffect({
        kind: "INTERNAL_TRANSFER",
        direction: "INTERNAL",
        accountingAmountMicros: 1_000_000n,
      }).cashEffectMicros,
    ).toBe(0n);
  });

  it("84-96. reconciliation as-of, pending, MATCHED/PENDING/MISMATCH/UNAVAILABLE", () => {
    expect(TREASURY_RECON_TOLERANCE_MICROS).toBe(0n);
    const laterWatcher = verifiedTx({ id: "w-later", provenance: "WATCHER" });
    const earlierManual = verifiedTx({
      id: "m-early",
      provenance: "MANUAL",
      occurredAt: new Date("2026-08-13T11:00:00.000Z"),
    });
    const laterManual = verifiedTx({
      id: "m-late",
      provenance: "MANUAL",
      occurredAt: new Date("2026-08-13T13:00:00.000Z"),
    });
    const obsLater = observation({
      id: "o-later",
      watchedAddressId: WATCHED_A,
      direction: "INFLOW",
      txHash: "h-later",
      blockHeight: "110",
    });
    const excluded = accountingCashBalanceAt({
      transactions: [laterWatcher, earlierManual, laterManual],
      observationsByTransactionId: new Map([["w-later", [obsLater]]]),
      asOfBlock: "105",
      asOfTime: now,
    });
    expect(excluded.unavailable).toBe(false);
    expect(excluded.cashMicros).toBe(1_000_000n);

    expect(
      accountingCashBalanceAt({
        transactions: [laterWatcher],
        observationsByTransactionId: new Map([["w-later", []]]),
        asOfBlock: "105",
        asOfTime: now,
      }).unavailable,
    ).toBe(true);

    expect(
      accountingCashBalanceAt({
        transactions: [laterWatcher],
        observationsByTransactionId: new Map([
          ["w-later", [observation({ ...obsLater, blockHeight: "not-a-block" })]],
        ]),
        asOfBlock: "105",
        asOfTime: now,
      }).unavailable,
    ).toBe(true);

    expect(
      pendingExplanationMicros({
        observations: [
          observation({
            id: "p1",
            watchedAddressId: WATCHED_A,
            direction: "INFLOW",
            txHash: "p-in",
          }),
        ],
        watchedAddressIds: new Set([WATCHED_A, WATCHED_B]),
      }),
    ).toBe(1_000_000n);
    expect(
      pendingExplanationMicros({
        observations: [
          observation({
            id: "i1",
            watchedAddressId: WATCHED_A,
            direction: "OUTFLOW",
            txHash: "ab",
            fromAddress: ADDR_A,
            toAddress: ADDR_B,
          }),
          observation({
            id: "i2",
            watchedAddressId: WATCHED_B,
            direction: "INFLOW",
            txHash: "ab",
            fromAddress: ADDR_A,
            toAddress: ADDR_B,
          }),
        ],
        watchedAddressIds: new Set([WATCHED_A, WATCHED_B]),
      }),
    ).toBe(0n);

    expect(
      classifyReconciliation({
        observedOnchainBalanceAtomic: 0n,
        accountingCashBalanceMicros: 0n,
        explainedPendingMicros: 0n,
        chainBalanceExact: true,
      }).status,
    ).toBe("MATCHED");
    expect(
      classifyReconciliation({
        observedOnchainBalanceAtomic: 1_000_000n,
        accountingCashBalanceMicros: 0n,
        explainedPendingMicros: 1_000_000n,
        chainBalanceExact: true,
      }).status,
    ).toBe("PENDING_CONFIRMATIONS");
    expect(
      classifyReconciliation({
        observedOnchainBalanceAtomic: 5_000_000n,
        accountingCashBalanceMicros: 0n,
        explainedPendingMicros: 1_000_000n,
        chainBalanceExact: true,
      }).status,
    ).toBe("MISMATCH");
    expect(
      classifyReconciliation({
        observedOnchainBalanceAtomic: null,
        accountingCashBalanceMicros: 0n,
        explainedPendingMicros: 0n,
        chainBalanceExact: false,
      }),
    ).toEqual({ status: "UNAVAILABLE", deltaMicros: null, unexplainedResidualMicros: null });
  });
});
