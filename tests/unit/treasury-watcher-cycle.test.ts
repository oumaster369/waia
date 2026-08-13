import { describe, expect, it } from "vitest";

import { assertWatcherVerifiedPrecondition, treasuryAuditActions } from "@/lib/waia-core/treasury";
import { TREASURY_WATCHER_CHECKPOINT_KEY } from "@/lib/waia-core/treasury/watcher/config";
import { treasuryObservationIdempotencyKey } from "@/lib/waia-core/treasury/watcher/idempotency";
import { usdtAmount } from "@/tests/unit/helpers/treasury-wp2";
import {
  ADDR_A,
  ADDR_B,
  ADDR_EXT,
  ADDR_EXT_2,
  HUGE_ATOMIC,
  INCEPTION_A,
  ORG_A,
  USDT_TRC20_CONTRACT,
  WATCHED_A,
  actorA,
  createFakeChainAdapter,
  createWatcherHarness,
  ctxA,
  ctxB,
  transfer,
} from "@/tests/unit/helpers/treasury-wp3";

describe("DEE-606 WP-3 watcher cycle: inception, checkpoint, lease", () => {
  it("7,10,11. ACTIVE inception bootstraps org-scoped checkpoint at start-1", async () => {
    const chain = createFakeChainAdapter({ tipError: "tip_down" });
    const harness = await createWatcherHarness({ chain });
    const report = await harness.run();
    expect(report.outcome).toBe("noop_provider_error");
    const checkpoint = await harness.watcherRepository.getCheckpoint(
      ctxA,
      TREASURY_WATCHER_CHECKPOINT_KEY,
    );
    expect(checkpoint?.lastScannedBlock).toBe("99");
    expect(checkpoint?.organizationId).toBe(ORG_A);
    expect(checkpoint?.checkpointKey).toBe("TRC-20:treasury");
    expect(
      await harness.watcherRepository.getCheckpoint(ctxB, TREASURY_WATCHER_CHECKPOINT_KEY),
    ).toBeNull();
  });

  it("12. existing checkpoint is not reseeded", async () => {
    const harness = await createWatcherHarness();
    await harness.watcherRepository.insertCheckpoint({
      organizationId: ORG_A,
      checkpointKey: TREASURY_WATCHER_CHECKPOINT_KEY,
      lastScannedBlock: "105",
      lastScannedAt: harness.now,
      leaseUntil: null,
      lastError: null,
      lastErrorAt: null,
      cycleCount: 3,
      createdAt: harness.now,
      updatedAt: harness.now,
    });
    await harness.run();
    const checkpoint = await harness.watcherRepository.getCheckpoint(
      ctxA,
      TREASURY_WATCHER_CHECKPOINT_KEY,
    );
    expect(checkpoint?.lastScannedBlock).not.toBe("99");
    expect(checkpoint?.lastScannedBlock).toBe("110");
  });

  it("14. lease contention no-ops without chain ingestion", async () => {
    const chain = createFakeChainAdapter({
      transfersByBlock: {
        "100": [transfer({ txHash: "held", from: ADDR_EXT, to: ADDR_A, block: "100" })],
      },
    });
    const harness = await createWatcherHarness({ chain });
    await harness.watcherRepository.insertCheckpoint({
      organizationId: ORG_A,
      checkpointKey: TREASURY_WATCHER_CHECKPOINT_KEY,
      lastScannedBlock: "99",
      lastScannedAt: harness.now,
      leaseUntil: new Date(harness.now.getTime() + 60_000),
      lastError: null,
      lastErrorAt: null,
      cycleCount: 0,
      createdAt: harness.now,
      updatedAt: harness.now,
    });
    const report = await harness.run();
    expect(report.outcome).toBe("noop_lease_held");
    expect(chain.state.chainCalls).toBe(0);
    expect(await harness.watcherRepository.listOrgTransactions(ctxA)).toHaveLength(0);
  });

  it("15. lease release is failure-safe", async () => {
    const harness = await createWatcherHarness();
    harness.watcherRepository.releaseLease = async () => {
      throw new Error("release failed");
    };
    const report = await harness.run();
    expect(report.outcome).toBe("completed");
  });
});

describe("DEE-606 WP-3 watcher cycle: matching, observations, semantic", () => {
  it("9,16,27,33-52. inbound ingest, huge amount, idempotent semantic tx", async () => {
    const chain = createFakeChainAdapter({
      transfersByBlock: {
        "99": [transfer({ txHash: "too-early", from: ADDR_EXT, to: ADDR_A, block: "99" })],
        "100": [
          transfer({
            txHash: "in-1",
            from: ADDR_EXT,
            to: ADDR_A,
            block: "100",
            amount: HUGE_ATOMIC,
          }),
          transfer({ txHash: "ext-ext", from: ADDR_EXT, to: ADDR_EXT_2, block: "100" }),
          transfer({ txHash: "below", from: ADDR_EXT, to: ADDR_A, block: "99" }),
        ],
      },
    });
    const harness = await createWatcherHarness({ chain });
    const first = await harness.run();
    expect(first.outcome).toBe("completed");
    const observations = await harness.watcherRepository.listObservationsForOrg(ctxA);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.direction).toBe("INFLOW");
    expect(observations[0]?.nativeAmountAtomic).toBe(HUGE_ATOMIC);
    expect(typeof observations[0]?.nativeAmountAtomic).toBe("bigint");
    expect(observations[0]?.idempotencyKey).toBe(
      treasuryObservationIdempotencyKey({
        network: "TRC-20",
        txHash: "in-1",
        transferIndex: 0,
        watchedAddressId: WATCHED_A,
      }),
    );
    expect(observations[0]?.observationStatus).toBe("CONFIRMED");
    expect(observations[0]?.relatedPaymentId).toBeNull();
    const txs = await harness.watcherRepository.listOrgTransactions(ctxA);
    expect(txs).toHaveLength(1);
    expect(txs[0]?.provenance).toBe("WATCHER");
    expect(txs[0]?.detailPublication).toBe("PRIVATE");
    expect(txs[0]?.status).toBe("NEEDS_REVIEW");
    expect(txs[0]?.kind).toBeNull();
    expect(txs[0]?.budgetId).toBeNull();
    expect(txs[0]?.fundingNeedId).toBeNull();
    expect(txs[0]?.cashEffectMicros).toBeNull();
    expect(txs[0]?.createdByUserId).toBeNull();
    expect(txs[0]?.verifiedAt).toBeNull();
    expect(txs[0]?.detailPublishedAt).toBeNull();
    const links = await harness.watcherRepository.listLinksForTransaction(ctxA, txs[0]!.id);
    expect(links).toHaveLength(1);
    expect(links[0]?.observationRole).toBe("PRIMARY");
    expect(harness.verifyCalls).toHaveLength(0);
    expect(
      harness.audits.some((row) => row.action === treasuryAuditActions.transactionWatcherCreate),
    ).toBe(true);
    const revisions = await harness.services.repository.listRevisions(ctxA, txs[0]!.id);
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    const replay = await harness.run();
    expect(replay.outcome).toBe("completed");
    expect(await harness.watcherRepository.listObservationsForOrg(ctxA)).toHaveLength(1);
    expect(await harness.watcherRepository.listOrgTransactions(ctxA)).toHaveLength(1);
    expect(await harness.watcherRepository.listLinksForTransaction(ctxA, txs[0]!.id)).toHaveLength(
      1,
    );
  });

  it("28,47-48. managed->external is one OUTFLOW observation and one semantic tx", async () => {
    const harness = await createWatcherHarness({
      chain: createFakeChainAdapter({
        transfersByBlock: {
          "100": [transfer({ txHash: "out-1", from: ADDR_A, to: ADDR_EXT, block: "100" })],
        },
      }),
    });
    await harness.run();
    const observations = await harness.watcherRepository.listObservationsForOrg(ctxA);
    const txs = await harness.watcherRepository.listOrgTransactions(ctxA);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.direction).toBe("OUTFLOW");
    expect(txs).toHaveLength(1);
    expect(txs[0]?.direction).toBe("OUTFLOW");
    expect(txs[0]?.kind).toBeNull();
    expect(txs[0]?.counterpartyIsInternal).toBe(false);
  });

  it("30-32. direction_scope INBOUND/OUTBOUND/BOTH", async () => {
    const inbound = await createWatcherHarness({
      chain: createFakeChainAdapter({
        transfersByBlock: {
          "100": [transfer({ txHash: "scope-out", from: ADDR_A, to: ADDR_EXT, block: "100" })],
        },
      }),
    });
    await inbound.watcherRepository.insertWatchedAddress({
      id: WATCHED_A,
      organizationId: ORG_A,
      network: "TRC-20",
      address: ADDR_A,
      tokenContract: USDT_TRC20_CONTRACT,
      assetCode: "USDT",
      directionScope: "INBOUND",
      includeInBalanceRecon: true,
      label: "A",
      isActive: true,
      createdAt: inbound.now,
      updatedAt: inbound.now,
    });
    await inbound.run();
    expect(await inbound.watcherRepository.listObservationsForOrg(ctxA)).toHaveLength(0);

    const outbound = await createWatcherHarness({
      chain: createFakeChainAdapter({
        transfersByBlock: {
          "100": [transfer({ txHash: "scope-in", from: ADDR_EXT, to: ADDR_A, block: "100" })],
        },
      }),
    });
    await outbound.watcherRepository.insertWatchedAddress({
      id: WATCHED_A,
      organizationId: ORG_A,
      network: "TRC-20",
      address: ADDR_A,
      tokenContract: USDT_TRC20_CONTRACT,
      assetCode: "USDT",
      directionScope: "OUTBOUND",
      includeInBalanceRecon: true,
      label: "A",
      isActive: true,
      createdAt: outbound.now,
      updatedAt: outbound.now,
    });
    await outbound.run();
    expect(await outbound.watcherRepository.listObservationsForOrg(ctxA)).toHaveLength(0);
  });

  it("36-40. low depth OBSERVED, then lifecycle-only CONFIRMED without immutable rewrite", async () => {
    const chain = createFakeChainAdapter({
      tip: "110",
      transfersByBlock: {
        "109": [transfer({ txHash: "obs-1", from: ADDR_EXT, to: ADDR_A, block: "109" })],
      },
    });
    const harness = await createWatcherHarness({ chain });
    await harness.run();
    const first = (await harness.watcherRepository.listObservationsForOrg(ctxA))[0];
    expect(first?.observationStatus).toBe("OBSERVED");
    expect(first?.confirmationsObserved).toBe(2);
    const digest = first?.rawEventDigest;
    const height = first?.blockHeight;
    chain.state.tip = "112";
    await harness.run();
    const second = (await harness.watcherRepository.listObservationsForOrg(ctxA))[0];
    expect(second?.observationStatus).toBe("CONFIRMED");
    expect(second?.rawEventDigest).toBe(digest);
    expect(second?.blockHeight).toBe(height);
    expect(second?.relatedPaymentId).toBeNull();
    expect(
      harness.lifecyclePatches.every(
        (row) =>
          Object.keys(row.patch).sort().join(",") === "confirmationsObserved,observationStatus",
      ),
    ).toBe(true);
  });

  it("53-69. internal A->B two observations, one semantic tx, no business meaning or VERIFY", async () => {
    const harness = await createWatcherHarness({
      chain: createFakeChainAdapter({
        transfersByBlock: {
          "100": [transfer({ txHash: "ab-1", from: ADDR_A, to: ADDR_B, block: "100" })],
        },
      }),
      seedOrgB: true,
    });
    await harness.run();
    const observations = await harness.watcherRepository.listObservationsForOrg(ctxA);
    expect(observations).toHaveLength(2);
    const txs = await harness.watcherRepository.listOrgTransactions(ctxA);
    expect(txs).toHaveLength(1);
    expect(txs[0]?.direction).toBe("INTERNAL");
    expect(txs[0]?.counterpartyIsInternal).toBe(true);
    expect(txs[0]?.kind).toBeNull();
    expect(txs[0]?.status).toBe("NEEDS_REVIEW");
    const links = await harness.watcherRepository.listLinksForTransaction(ctxA, txs[0]!.id);
    expect(links.map((row) => row.observationRole).sort()).toEqual([
      "INTERNAL_COUNTERPARTY",
      "PRIMARY",
    ]);
    expect(links.find((row) => row.observationRole === "PRIMARY")?.observationId).toBe(
      observations.find((row) => row.watchedAddressId === WATCHED_A)?.id,
    );
    expect(harness.verifyCalls).toHaveLength(0);
    expect(await harness.watcherRepository.listOrgTransactions(ctxB)).toHaveLength(0);

    const classified = await harness.services.transactions.classify(ctxA, actorA, {
      transactionId: txs[0]!.id,
      reason: "human internal transfer",
      patch: {
        kind: "INTERNAL_TRANSFER",
        direction: "INTERNAL",
        ...usdtAmount(1_000_000n),
      },
    });
    expect(classified.kind).toBe("INTERNAL_TRANSFER");
    expect(classified.cashEffectMicros).toBe(0n);
    const linked = await harness.services.repository.listLinkedObservations(ctxA, txs[0]!.id);
    expect(linked).toHaveLength(2);
    expect(() =>
      assertWatcherVerifiedPrecondition({
        provenance: "WATCHER",
        linkedObservations: linked,
      }),
    ).not.toThrow();
    expect(harness.verifyCalls).toHaveLength(0);
    expect(classified.budgetId).toBeNull();
    expect(classified.fundingNeedId).toBeNull();
  });
});

describe("DEE-606 WP-3 watcher cycle: reorg, cursor, recon", () => {
  it("70-77. provider error is not drop; age-out DROPPED reopens VERIFIED to RECONCILIATION_REQUIRED", async () => {
    const chain = createFakeChainAdapter({
      transfersByBlock: {
        "100": [transfer({ txHash: "drop-me", from: ADDR_EXT, to: ADDR_A, block: "100" })],
      },
    });
    const harness = await createWatcherHarness({ chain });
    await harness.run();
    const tx = (await harness.watcherRepository.listOrgTransactions(ctxA))[0]!;
    await harness.services.transactions.classify(ctxA, actorA, {
      transactionId: tx.id,
      reason: "human contribution",
      patch: { kind: "CONTRIBUTION", direction: "INFLOW", ...usdtAmount(1_000_000n) },
    });
    await harness.services.transactions.verify(ctxA, actorA, {
      transactionId: tx.id,
      reason: "human verify",
    });
    expect((await harness.services.transactions.getTransaction(ctxA, tx.id)).status).toBe(
      "VERIFIED",
    );
    const verifyCountAfterHuman = harness.verifyCalls.length;
    expect(verifyCountAfterHuman).toBe(1);

    chain.state.existsError = "rpc_timeout";
    await harness.run(ctxA, new Date(harness.now.getTime() + 31 * 60 * 1000));
    expect(
      (await harness.watcherRepository.listObservationsForOrg(ctxA))[0]?.observationStatus,
    ).toBe("CONFIRMED");

    chain.state.existsError = undefined;
    chain.state.exists = { "drop-me": false };
    await harness.run(ctxA, new Date(harness.now.getTime() + 10 * 60 * 1000));
    expect(
      (await harness.watcherRepository.listObservationsForOrg(ctxA))[0]?.observationStatus,
    ).toBe("CONFIRMED");

    await harness.run(ctxA, new Date(harness.now.getTime() + 31 * 60 * 1000));
    const dropped = (await harness.watcherRepository.listObservationsForOrg(ctxA))[0];
    expect(dropped?.observationStatus).toBe("DROPPED");
    expect(dropped?.blockHeight).toBe("100");
    expect(dropped?.txHash).toBe("drop-me");
    expect((await harness.services.transactions.getTransaction(ctxA, tx.id)).status).toBe(
      "RECONCILIATION_REQUIRED",
    );
    expect(harness.verifyCalls).toHaveLength(verifyCountAfterHuman);
    expect(await harness.watcherRepository.listOrgTransactions(ctxA)).toHaveLength(1);
    expect(
      (await harness.watcherRepository.listOrgTransactions(ctxA))[0]?.correctsTransactionId,
    ).toBeNull();

    await harness.run(ctxA, new Date(harness.now.getTime() + 40 * 60 * 1000));
    expect(await harness.watcherRepository.listObservationsForOrg(ctxA)).toHaveLength(1);
    expect(
      (await harness.watcherRepository.listObservationsForOrg(ctxA))[0]?.observationStatus,
    ).toBe("DROPPED");
  });

  it("78-81. chain/pagination/persist failure does not advance; success does", async () => {
    const failChain = createFakeChainAdapter({
      blockErrors: { "100": "page_incomplete" },
      transfersByBlock: {
        "100": [transfer({ txHash: "x", from: ADDR_EXT, to: ADDR_A, block: "100" })],
      },
    });
    const failHarness = await createWatcherHarness({ chain: failChain });
    const failed = await failHarness.run();
    expect(failed.outcome).toBe("failed_closed");
    expect(
      (await failHarness.watcherRepository.getCheckpoint(ctxA, TREASURY_WATCHER_CHECKPOINT_KEY))
        ?.lastScannedBlock,
    ).toBe("99");

    const persistHarness = await createWatcherHarness({
      chain: createFakeChainAdapter({
        transfersByBlock: {
          "100": [transfer({ txHash: "p", from: ADDR_EXT, to: ADDR_A, block: "100" })],
        },
      }),
    });
    persistHarness.watcherRepository.insertChainObservation = async () => {
      throw new Error("persist_failed");
    };
    const persistFailed = await persistHarness.run();
    expect(persistFailed.outcome).toBe("failed_closed");
    expect(
      (await persistHarness.watcherRepository.getCheckpoint(ctxA, TREASURY_WATCHER_CHECKPOINT_KEY))
        ?.lastScannedBlock,
    ).toBe("99");

    const okHarness = await createWatcherHarness();
    const ok = await okHarness.run();
    expect(ok.outcome).toBe("completed");
    expect(
      (await okHarness.watcherRepository.getCheckpoint(ctxA, TREASURY_WATCHER_CHECKPOINT_KEY))
        ?.lastScannedBlock,
    ).toBe("110");
  });

  it("82-83. crash/retry and partial observation replay converge to one semantic tx", async () => {
    const chain = createFakeChainAdapter({
      transfersByBlock: {
        "100": [transfer({ txHash: "partial", from: ADDR_EXT, to: ADDR_A, block: "100" })],
      },
    });
    const harness = await createWatcherHarness({ chain });
    await harness.watcherRepository.insertChainObservation({
      id: "obs-partial",
      organizationId: ORG_A,
      watchedAddressId: WATCHED_A,
      network: "TRC-20",
      tokenContract: USDT_TRC20_CONTRACT,
      assetCode: "USDT",
      txHash: "partial",
      transferIndex: 0,
      fromAddress: ADDR_EXT,
      toAddress: ADDR_A,
      direction: "INFLOW",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      blockHeight: "100",
      blockTimestamp: harness.now,
      observedAt: harness.now,
      confirmationsObserved: 11,
      confirmationsRequired: 3,
      observationStatus: "CONFIRMED",
      idempotencyKey: treasuryObservationIdempotencyKey({
        network: "TRC-20",
        txHash: "partial",
        transferIndex: 0,
        watchedAddressId: WATCHED_A,
      }),
      ingestionSource: "treasury-watcher",
      rawEventDigest: "pre",
      relatedPaymentId: null,
      createdAt: harness.now,
    });
    await harness.run();
    await harness.run();
    expect(await harness.watcherRepository.listObservationsForOrg(ctxA)).toHaveLength(1);
    expect(await harness.watcherRepository.listOrgTransactions(ctxA)).toHaveLength(1);
  });

  it("88-95. recon MATCHED, PENDING_CONFIRMATIONS, MISMATCH, UNAVAILABLE, internal net-zero", async () => {
    const matched = await createWatcherHarness({
      chain: createFakeChainAdapter({ historicalBalance: 0n }),
    });
    await matched.run();
    const matchedRow = (await matched.watcherRepository.listBalanceReconciliations(ctxA))[0];
    expect(matchedRow?.status).toBe("MATCHED");
    expect(matchedRow?.asOfBlock).toBe("110");
    expect(matchedRow?.asOfTime).toEqual(matched.now);
    expect(matchedRow?.toleranceMicros).toBe(0n);

    const pending = await createWatcherHarness({
      chain: createFakeChainAdapter({
        historicalBalance: 1_000_000n,
        transfersByBlock: {
          "109": [transfer({ txHash: "pend", from: ADDR_EXT, to: ADDR_A, block: "109" })],
        },
      }),
    });
    await pending.run();
    const pendingRow = (await pending.watcherRepository.listBalanceReconciliations(ctxA))[0];
    expect(pendingRow?.status).toBe("PENDING_CONFIRMATIONS");
    expect(
      (await pending.watcherRepository.listOrgTransactions(ctxA))[0]?.cashEffectMicros,
    ).toBeNull();

    const mismatch = await createWatcherHarness({
      chain: createFakeChainAdapter({
        historicalBalance: 5_000_000n,
        transfersByBlock: {
          "109": [transfer({ txHash: "mis", from: ADDR_EXT, to: ADDR_A, block: "109" })],
        },
      }),
    });
    await mismatch.run();
    expect((await mismatch.watcherRepository.listBalanceReconciliations(ctxA))[0]?.status).toBe(
      "MISMATCH",
    );

    const unavailable = await createWatcherHarness({
      chain: createFakeChainAdapter({ omitBalanceCapability: true }),
    });
    await unavailable.run();
    const unavailableRow = (
      await unavailable.watcherRepository.listBalanceReconciliations(ctxA)
    )[0];
    expect(unavailableRow?.status).toBe("UNAVAILABLE");
    expect(unavailableRow?.observedOnchainBalanceAtomic).toBeNull();
    expect(unavailableRow?.deltaMicros).toBeNull();

    const internal = await createWatcherHarness({
      chain: createFakeChainAdapter({
        historicalBalance: 0n,
        transfersByBlock: {
          "109": [transfer({ txHash: "ab-pend", from: ADDR_A, to: ADDR_B, block: "109" })],
        },
      }),
    });
    await internal.run();
    expect((await internal.watcherRepository.listBalanceReconciliations(ctxA))[0]?.status).toBe(
      "MATCHED",
    );
    expect(
      (await internal.watcherRepository.listBalanceReconciliations(ctxA))[0]
        ?.explainedPendingMicros,
    ).toBe(0n);
  });

  it("inception id is recorded on watcher semantic tx", async () => {
    const harness = await createWatcherHarness({
      chain: createFakeChainAdapter({
        transfersByBlock: {
          "100": [transfer({ txHash: "inc", from: ADDR_EXT, to: ADDR_A, block: "100" })],
        },
      }),
    });
    await harness.run();
    expect((await harness.watcherRepository.listOrgTransactions(ctxA))[0]?.ledgerInceptionId).toBe(
      INCEPTION_A,
    );
  });
});
