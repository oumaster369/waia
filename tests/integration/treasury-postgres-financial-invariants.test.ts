import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeCommitmentsForBudget,
  assignedNegativeCashMagnitude,
  computeVerifiedAccountingTotals,
} from "@/lib/waia-core/treasury/breath/accounting";
import {
  evaluateBalanceReconciliationGate,
  latestReconciliation,
} from "@/lib/waia-core/treasury/breath/publication-gates";
import {
  BREATH_RECON_MAX_AGE_MS,
  breathPendingReasons,
} from "@/lib/waia-core/treasury/breath/types";
import {
  TREASURY_USDT_V1_NETWORK,
  TREASURY_USDT_V1_TOKEN_CONTRACT,
  USDT_NOMINAL_USD_POLICY_V1,
} from "@/lib/waia-core/treasury/types";
import { accountingCashBalanceAt } from "@/lib/waia-core/treasury/watcher/reconciliation";
import { WATCHER_SERVICE_ACTOR } from "@/lib/waia-core/treasury/watcher/ingest";
import {
  getPublicContributionAggregate,
  getSelfContributionShare,
} from "@/lib/waia-core/treasury/share";
import { usdtAmount } from "@/tests/unit/helpers/treasury-wp2";
import {
  ADDR_A,
  ADDR_B,
  ORG_A,
  ORG_B,
  USER_A,
  actorA,
  ctxA,
  ctxB,
  createVerifiedUsdtDraft,
  expectPostgresRejects,
  insertChainObservationFixture,
  insertWatchedPair,
  openWp8Postgres,
  openWp8Services,
  registerMetadataEvidence,
  resetWp8Tenants,
  seedActiveInception,
  seedWp8Identity,
  verifiedManualTx,
  wp8IsolationEnabled,
  type Wp8PostgresHandle,
  type Wp8Services,
} from "@/tests/integration/treasury-wp8-harness";

const describeWp8 = describe.skipIf(!wp8IsolationEnabled);
const HUGE = 9_007_199_254_740_993n;

describeWp8("DEE-606 WP-8 Postgres financial invariants", () => {
  let handle: Wp8PostgresHandle;
  let services: Wp8Services;

  beforeAll(async () => {
    handle = openWp8Postgres();
    services = openWp8Services(handle.db);
    await seedWp8Identity(handle.sql);
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await resetWp8Tenants(handle.sql);
  });

  it("25-26 impossible kind/direction and cash-effect combinations are rejected", async () => {
    const tx = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "check",
    });
    const cases: Array<[string, string]> = [
      ["OPENING_BALANCE", "OUTFLOW"],
      ["CONTRIBUTION", "OUTFLOW"],
      ["EXPENSE", "INFLOW"],
      ["EXTERNAL_INFLOW", "OUTFLOW"],
      ["EXTERNAL_OUTFLOW", "INFLOW"],
      ["INTERNAL_TRANSFER", "INFLOW"],
    ];
    for (const [kind, direction] of cases) {
      await expectPostgresRejects(() =>
        handle.sql.unsafe(
          `UPDATE treasury_transactions SET kind = $1::treasury_tx_kind, direction = $2::treasury_tx_direction WHERE id = $3`,
          [kind, direction, tx.id],
        ),
      );
    }
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_transactions SET cash_effect_micros = -1 WHERE id = $1`, [
        tx.id,
      ]),
    );
    const outflow = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "OUTFLOW",
      kind: "EXPENSE",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "out",
    });
    await expectPostgresRejects(() =>
      handle.sql.unsafe(
        `UPDATE treasury_transactions SET cash_effect_micros = 1_000_000 WHERE id = $1`,
        [outflow.id],
      ),
    );
    const internal = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INTERNAL",
      kind: "INTERNAL_TRANSFER",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "int",
    });
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_transactions SET cash_effect_micros = 1 WHERE id = $1`, [
        internal.id,
      ]),
    );
    const correction = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CORRECTION",
      nativeAmountAtomic: 1_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 1_000_000n,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "corr",
    });
    await expectPostgresRejects(() =>
      handle.sql.unsafe(`UPDATE treasury_transactions SET cash_effect_micros = 0 WHERE id = $1`, [
        correction.id,
      ]),
    );
  });

  it("27-29 WATCHER verify zero-link / unconfirmed reject; all-confirmed passes", async () => {
    const watched = await insertWatchedPair(services, ORG_A);
    const detected = await services.domain.transactions.ensureWatcherDetected(
      ctxA,
      WATCHER_SERVICE_ACTOR,
      {
        direction: "INFLOW",
        nativeAmountAtomic: 1_000_000n,
        nativeDecimals: 6,
        nativeAsset: "USDT",
        nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        canonicalNetwork: TREASURY_USDT_V1_NETWORK,
        canonicalTokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        canonicalTxHash: "hash-zero",
        canonicalTransferIndex: 0,
        occurredAt: new Date("2026-08-13T00:00:00.000Z"),
        counterpartyIsInternal: false,
      },
    );
    await services.domain.transactions.classify(ctxA, actorA, {
      transactionId: detected.id,
      reason: "classify",
      patch: { kind: "CONTRIBUTION", direction: "INFLOW", ...usdtAmount(1_000_000n) },
    });
    await expect(
      services.domain.transactions.verify(ctxA, actorA, {
        transactionId: detected.id,
        reason: "verify",
      }),
    ).rejects.toMatchObject({ reasonCode: "WATCHER_VERIFY_NO_LINKS" });

    const observed = await insertChainObservationFixture(services, {
      organizationId: ORG_A,
      watchedAddressId: watched.watchedA,
      txHash: "hash-zero",
      fromAddress: ADDR_A,
      toAddress: ADDR_B,
      direction: "INFLOW",
      observationStatus: "OBSERVED",
      confirmationsObserved: 1,
      confirmationsRequired: 3,
      blockHeight: "100",
    });
    await services.watcher.insertObservationLink({
      id: crypto.randomUUID(),
      organizationId: ORG_A,
      transactionId: detected.id,
      observationId: observed.id,
      observationRole: "PRIMARY",
      createdAt: new Date(),
    });
    await expect(
      services.domain.transactions.verify(ctxA, actorA, {
        transactionId: detected.id,
        reason: "verify",
      }),
    ).rejects.toMatchObject({ reasonCode: "WATCHER_VERIFY_UNCONFIRMED" });

    await handle.sql.unsafe(
      `UPDATE treasury_chain_observations
       SET confirmations_observed = 2, observation_status = 'CONFIRMED'
       WHERE id = $1`,
      [observed.id],
    );
    await expect(
      services.domain.transactions.verify(ctxA, actorA, {
        transactionId: detected.id,
        reason: "verify",
      }),
    ).rejects.toMatchObject({ reasonCode: "WATCHER_VERIFY_INSUFFICIENT_CONFIRMATIONS" });

    const droppedTx = await services.domain.transactions.ensureWatcherDetected(
      ctxA,
      WATCHER_SERVICE_ACTOR,
      {
        direction: "INFLOW",
        nativeAmountAtomic: 1_000_000n,
        nativeDecimals: 6,
        nativeAsset: "USDT",
        nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        canonicalNetwork: TREASURY_USDT_V1_NETWORK,
        canonicalTokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        canonicalTxHash: "hash-drop",
        canonicalTransferIndex: 0,
        occurredAt: new Date("2026-08-13T00:00:00.000Z"),
        counterpartyIsInternal: false,
      },
    );
    await services.domain.transactions.classify(ctxA, actorA, {
      transactionId: droppedTx.id,
      reason: "classify",
      patch: { kind: "CONTRIBUTION", direction: "INFLOW", ...usdtAmount(1_000_000n) },
    });
    const dropped = await insertChainObservationFixture(services, {
      organizationId: ORG_A,
      watchedAddressId: watched.watchedA,
      txHash: "hash-drop",
      fromAddress: ADDR_A,
      toAddress: ADDR_B,
      direction: "INFLOW",
      observationStatus: "DROPPED",
      confirmationsObserved: 3,
      confirmationsRequired: 3,
      blockHeight: "100",
    });
    await services.watcher.insertObservationLink({
      id: crypto.randomUUID(),
      organizationId: ORG_A,
      transactionId: droppedTx.id,
      observationId: dropped.id,
      observationRole: "PRIMARY",
      createdAt: new Date(),
    });
    await expect(
      services.domain.transactions.verify(ctxA, actorA, {
        transactionId: droppedTx.id,
        reason: "verify",
      }),
    ).rejects.toMatchObject({ reasonCode: "WATCHER_VERIFY_UNCONFIRMED" });

    await handle.sql.unsafe(
      `UPDATE treasury_chain_observations
       SET confirmations_observed = 3, observation_status = 'CONFIRMED'
       WHERE id = $1`,
      [observed.id],
    );
    const verified = await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: detected.id,
      reason: "human verify",
    });
    expect(verified.status).toBe("VERIFIED");
  });

  it("30-36 PRIVATE aggregates, public privacy, DETAIL_PUBLIC activity, >50 untruncated, BigInt, identity", async () => {
    const privateIn = await createVerifiedUsdtDraft(services, {
      organizationId: ORG_A,
      actor: actorA,
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      amountMicros: HUGE,
      internalNotes: "SECRET_NOTE_DO_NOT_LEAK",
      counterpartyDisplay: "Hidden Counterparty",
    });
    await services.domain.repository.updateTransaction(ctxA, privateIn.id, {
      internalNotes: "SECRET_NOTE_DO_NOT_LEAK",
      counterpartyDisplay: "Hidden Counterparty",
      verifiedByUserId: USER_A,
    });
    const evidenceId = await registerMetadataEvidence(services, ORG_A, actorA);
    await services.catalog.linkEvidence(ctxA, actorA, {
      transactionId: privateIn.id,
      evidenceObjectId: evidenceId,
      reason: "link",
    });
    await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: privateIn.id,
      reason: "verify private in",
    });
    const privateOut = await createVerifiedUsdtDraft(services, {
      organizationId: ORG_A,
      actor: actorA,
      direction: "OUTFLOW",
      kind: "EXPENSE",
      amountMicros: 1_000_000n,
    });
    await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: privateOut.id,
      reason: "verify private out",
    });
    const publicTx = await createVerifiedUsdtDraft(services, {
      organizationId: ORG_A,
      actor: actorA,
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      amountMicros: 2_000_000n,
    });
    await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: publicTx.id,
      reason: "verify public",
    });
    await services.domain.transactions.setDetailPublication(ctxA, actorA, {
      transactionId: publicTx.id,
      detailPublication: "DETAIL_PUBLIC",
      reason: "publish detail",
    });
    const draft = await services.domain.transactions.createManualDraft(ctxA, actorA, {
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      nativeAmountAtomic: 3_000_000n,
      nativeDecimals: 6,
      nativeAsset: "USDT",
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingAmountMicros: 3_000_000n,
      occurredAt: new Date("2026-08-02T00:00:00.000Z"),
      reason: "unverified",
    });
    const superseded = await createVerifiedUsdtDraft(services, {
      organizationId: ORG_A,
      actor: actorA,
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      amountMicros: 4_000_000n,
    });
    await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: superseded.id,
      reason: "verify superseded",
    });
    await services.domain.transactions.setDetailPublication(ctxA, actorA, {
      transactionId: superseded.id,
      detailPublication: "SUPERSEDED",
      supersededById: publicTx.id,
      reason: "supersede",
    });

    const now = new Date("2026-08-13T12:00:00.000Z");
    for (let i = 0; i < 51; i += 1) {
      await services.domain.repository.insertTransaction(
        verifiedManualTx({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          direction: "INFLOW",
          kind: "CONTRIBUTION",
          accountingAmountMicros: 1n,
          cashEffectMicros: 1n,
          nativeAmountAtomic: 1n,
          occurredAt: new Date(now.getTime() + i),
        }),
      );
    }

    const facts = await services.breathFacts.loadFacts(ctxA);
    expect(facts.transactions.filter((row) => row.status === "VERIFIED").length).toBeGreaterThan(
      50,
    );
    const accounting = computeVerifiedAccountingTotals(facts.transactions);
    expect(accounting.remaining).toBe(accounting.accountingCashBalance);
    expect(accounting.entered - accounting.spent).toBe(accounting.remaining);
    expect(accounting.entered >= HUGE).toBe(true);

    const snapshot = await services.breath.getPublicSnapshot(ctxA);
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain("SECRET_NOTE_DO_NOT_LEAK");
    expect(encoded).not.toContain("Hidden Counterparty");
    expect(encoded).not.toContain(USER_A);
    expect(encoded).not.toContain(evidenceId);
    expect(encoded).not.toContain("internalNotes");
    expect(snapshot.recentActivity.some((row) => row.accountingAmountMicros === "2000000")).toBe(
      true,
    );
    expect(snapshot.recentActivity.some((row) => row.accountingAmountMicros === "4000000")).toBe(
      false,
    );
    expect(snapshot.recentActivity.some((row) => row.accountingAmountMicros === "3000000")).toBe(
      false,
    );
    expect(draft.status).toBe("MANUAL_DRAFT");
  });

  it("37-39 active commitments reduce remaining and are not spent", async () => {
    const budget = await services.catalog.createBudget(ctxA, actorA, {
      code: "OPS",
      title: "Ops",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      currency: "USD",
      plannedAmountMicros: 10_000_000n,
      status: "ACTIVE",
      notes: null,
      reason: "budget",
    });
    const draft = await services.domain.commitments.createDraft(ctxA, actorA, {
      amountMicros: 2_000_000n,
      purpose: "vendor",
      budgetId: budget.id,
      reason: "draft",
    });
    const ignoredDraft = await services.domain.commitments.createDraft(ctxA, actorA, {
      amountMicros: 9_000_000n,
      purpose: "draft excluded",
      budgetId: budget.id,
      reason: "stay draft",
    });
    expect(ignoredDraft.status).toBe("DRAFT");
    await services.domain.commitments.approve(ctxA, actorA, {
      commitmentId: draft.id,
      reason: "approve",
    });
    const factsBefore = await services.breathFacts.loadFacts(ctxA);
    expect(activeCommitmentsForBudget(factsBefore.commitments, budget.id)).toBe(2_000_000n);
    expect(assignedNegativeCashMagnitude(factsBefore.transactions, budget.id)).toBe(0n);
    const remainingBefore =
      budget.plannedAmountMicros -
      assignedNegativeCashMagnitude(factsBefore.transactions, budget.id) -
      activeCommitmentsForBudget(factsBefore.commitments, budget.id);
    expect(remainingBefore).toBe(8_000_000n);

    const expense = await createVerifiedUsdtDraft(services, {
      organizationId: ORG_A,
      actor: actorA,
      direction: "OUTFLOW",
      kind: "EXPENSE",
      amountMicros: 500_000n,
      budgetId: budget.id,
    });
    await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: expense.id,
      reason: "spend",
    });
    const factsAfter = await services.breathFacts.loadFacts(ctxA);
    const spent = assignedNegativeCashMagnitude(factsAfter.transactions, budget.id);
    const committed = activeCommitmentsForBudget(factsAfter.commitments, budget.id);
    expect(spent).toBe(500_000n);
    expect(committed).toBe(2_000_000n);
    expect(budget.plannedAmountMicros - spent - committed).toBe(7_500_000n);
  });

  it("48-56 latest recon, MATCHED/PENDING/MISMATCH/UNAVAILABLE/stale/10m/scope/as-of", async () => {
    const { inceptionId, openingId } = await seedActiveInception(services);
    const now = new Date("2026-08-13T12:00:00.000Z");
    const base = {
      organizationId: ORG_A,
      ledgerInceptionId: inceptionId,
      asOfBlock: "100",
      asOfTime: now,
      explainedPendingMicros: 0n,
      toleranceMicros: 0n,
      evidenceObjectId: null,
      notes: null,
      createdBy: "wp8",
    };

    await services.watcher.insertBalanceReconciliation({
      ...base,
      id: "11111111-1111-4111-8111-111111111111",
      observedOnchainBalanceAtomic: 1_000_000n,
      accountingCashBalanceMicros: 1_000_000n,
      deltaMicros: 0n,
      unexplainedResidualMicros: 0n,
      status: "MATCHED",
      createdAt: new Date(now.getTime() - 60_000),
    });
    await services.watcher.insertBalanceReconciliation({
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      observedOnchainBalanceAtomic: 9n,
      accountingCashBalanceMicros: 1_000_000n,
      deltaMicros: -999_991n,
      unexplainedResidualMicros: -999_991n,
      status: "MISMATCH",
      createdAt: now,
    });
    const loaded = await services.breathFacts.loadFacts(ctxA);
    const latest = latestReconciliation(loaded.reconciliations);
    expect(latest?.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(
      evaluateBalanceReconciliationGate({
        latest,
        inceptions: loaded.inceptions,
        now,
      }).reason,
    ).toBe(breathPendingReasons.BALANCE_RECONCILIATION_MISMATCH);

    const matchedGate = evaluateBalanceReconciliationGate({
      latest: {
        ...base,
        id: "m",
        observedOnchainBalanceAtomic: 1_000_000n,
        accountingCashBalanceMicros: 1_000_000n,
        deltaMicros: 0n,
        unexplainedResidualMicros: 0n,
        status: "MATCHED",
        createdAt: now,
      },
      inceptions: loaded.inceptions,
      now,
    });
    expect(matchedGate.ok).toBe(true);

    const pendingGate = evaluateBalanceReconciliationGate({
      latest: {
        ...base,
        id: "p",
        observedOnchainBalanceAtomic: 1_100_000n,
        accountingCashBalanceMicros: 1_000_000n,
        deltaMicros: 100_000n,
        explainedPendingMicros: 100_000n,
        unexplainedResidualMicros: 0n,
        status: "PENDING_CONFIRMATIONS",
        createdAt: now,
      },
      inceptions: loaded.inceptions,
      now,
    });
    expect(pendingGate.ok).toBe(true);

    expect(
      evaluateBalanceReconciliationGate({
        latest: {
          ...base,
          id: "u",
          observedOnchainBalanceAtomic: null,
          accountingCashBalanceMicros: 1_000_000n,
          deltaMicros: null,
          unexplainedResidualMicros: null,
          status: "UNAVAILABLE",
          createdAt: now,
        },
        inceptions: loaded.inceptions,
        now,
      }).reason,
    ).toBe(breathPendingReasons.BALANCE_RECONCILIATION_UNAVAILABLE);

    expect(
      evaluateBalanceReconciliationGate({
        latest: null,
        inceptions: loaded.inceptions,
        now,
      }).reason,
    ).toBe(breathPendingReasons.BALANCE_RECONCILIATION_MISSING);

    expect(
      evaluateBalanceReconciliationGate({
        latest: {
          ...base,
          id: "s",
          observedOnchainBalanceAtomic: 1_000_000n,
          accountingCashBalanceMicros: 1_000_000n,
          deltaMicros: 0n,
          unexplainedResidualMicros: 0n,
          status: "MATCHED",
          createdAt: new Date(now.getTime() - BREATH_RECON_MAX_AGE_MS - 1),
        },
        inceptions: loaded.inceptions,
        now,
      }).reason,
    ).toBe(breathPendingReasons.BALANCE_RECONCILIATION_STALE);

    expect(
      evaluateBalanceReconciliationGate({
        latest: {
          ...base,
          id: "exact",
          observedOnchainBalanceAtomic: 1_000_000n,
          accountingCashBalanceMicros: 1_000_000n,
          deltaMicros: 0n,
          unexplainedResidualMicros: 0n,
          status: "MATCHED",
          createdAt: new Date(now.getTime() - BREATH_RECON_MAX_AGE_MS),
        },
        inceptions: loaded.inceptions,
        now,
      }).ok,
    ).toBe(true);

    expect(
      evaluateBalanceReconciliationGate({
        latest: {
          ...base,
          id: "scope",
          ledgerInceptionId: crypto.randomUUID(),
          observedOnchainBalanceAtomic: 1_000_000n,
          accountingCashBalanceMicros: 1_000_000n,
          deltaMicros: 0n,
          unexplainedResidualMicros: 0n,
          status: "MATCHED",
          createdAt: now,
        },
        inceptions: loaded.inceptions,
        now,
      }).reason,
    ).toBe(breathPendingReasons.BALANCE_RECONCILIATION_SCOPE_INVALID);

    const watchedLater = await insertWatchedPair(services, ORG_A);
    const later = await services.domain.transactions.ensureWatcherDetected(
      ctxA,
      WATCHER_SERVICE_ACTOR,
      {
        direction: "INFLOW",
        nativeAmountAtomic: 5_000_000n,
        nativeDecimals: 6,
        nativeAsset: "USDT",
        nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        canonicalNetwork: TREASURY_USDT_V1_NETWORK,
        canonicalTokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        canonicalTxHash: "hash-later",
        canonicalTransferIndex: 0,
        occurredAt: new Date("2026-08-13T13:00:00.000Z"),
        counterpartyIsInternal: false,
      },
    );
    await services.domain.transactions.classify(ctxA, actorA, {
      transactionId: later.id,
      reason: "classify later",
      patch: { kind: "CONTRIBUTION", direction: "INFLOW", ...usdtAmount(5_000_000n) },
    });
    const laterObs = await insertChainObservationFixture(services, {
      organizationId: ORG_A,
      watchedAddressId: watchedLater.watchedA,
      txHash: "hash-later",
      fromAddress: ADDR_A,
      toAddress: ADDR_B,
      direction: "INFLOW",
      observationStatus: "CONFIRMED",
      confirmationsObserved: 20,
      confirmationsRequired: 20,
      blockHeight: "200",
    });
    await services.watcher.insertObservationLink({
      id: crypto.randomUUID(),
      organizationId: ORG_A,
      transactionId: later.id,
      observationId: laterObs.id,
      observationRole: "PRIMARY",
      createdAt: now,
    });
    await services.domain.transactions.verify(ctxA, actorA, {
      transactionId: later.id,
      reason: "verify later",
    });
    const txs = await services.domain.repository.listTransactions(ctxA);
    const observationsByTransactionId = new Map();
    for (const tx of txs) {
      observationsByTransactionId.set(
        tx.id,
        await services.watcher.listLinkedFullObservations(ctxA, tx.id),
      );
    }
    const asOf100 = accountingCashBalanceAt({
      transactions: txs,
      observationsByTransactionId,
      asOfBlock: "100",
      asOfTime: now,
    });
    const asOf200 = accountingCashBalanceAt({
      transactions: txs,
      observationsByTransactionId,
      asOfBlock: "200",
      asOfTime: new Date("2026-08-13T13:00:00.000Z"),
    });
    expect(asOf100.unavailable).toBe(false);
    expect(asOf200.cashMicros! - asOf100.cashMicros!).toBe(5_000_000n);
    expect(openingId).toBeTruthy();
  });

  it("57-59 share >50 untruncated, cross-org isolation, public aggregate does not read attributions", async () => {
    for (let i = 0; i < 51; i += 1) {
      const row = verifiedManualTx({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        direction: "INFLOW",
        kind: "CONTRIBUTION",
        accountingAmountMicros: 1_000_000n,
        cashEffectMicros: 1_000_000n,
        nativeAmountAtomic: 1_000_000n,
        nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
        verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
      await services.domain.repository.insertTransaction(row);
      if (i === 0) {
        await services.domain.repository.insertAttribution({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          transactionId: row.id,
          status: "ATTRIBUTED",
          contributorUserId: USER_A,
          revokedAt: null,
        });
      } else if (i === 1) {
        await services.domain.repository.insertAttribution({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          transactionId: row.id,
          status: "UNMATCHED",
          contributorUserId: null,
          revokedAt: null,
        });
      } else if (i === 2) {
        await services.domain.repository.insertAttribution({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          transactionId: row.id,
          status: "ANONYMOUS",
          contributorUserId: null,
          revokedAt: null,
        });
      }
    }
    const orgB = verifiedManualTx({
      id: crypto.randomUUID(),
      organizationId: ORG_B,
      direction: "INFLOW",
      kind: "CONTRIBUTION",
      accountingAmountMicros: 99_000_000n,
      cashEffectMicros: 99_000_000n,
      nativeAmountAtomic: 99_000_000n,
      nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
      accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
    });
    await services.domain.repository.insertTransaction(orgB);

    const refundTarget = (await services.breathFacts.loadFacts(ctxA)).transactions[0]!;
    await services.domain.repository.insertTransaction(
      verifiedManualTx({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        direction: "OUTFLOW",
        kind: "REFUND",
        accountingAmountMicros: 100_000n,
        cashEffectMicros: -100_000n,
        nativeAmountAtomic: 100_000n,
        correctsTransactionId: refundTarget.id,
        nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
      }),
    );
    await services.domain.repository.insertTransaction(
      verifiedManualTx({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        direction: "INFLOW",
        kind: "BALANCE_ADJUSTMENT",
        accountingAmountMicros: 50_000n,
        cashEffectMicros: 50_000n,
        nativeAmountAtomic: 50_000n,
        nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
        accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
      }),
    );
    await services.domain.repository.insertTransaction(
      verifiedManualTx({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        direction: "INFLOW",
        kind: "CONTRIBUTION",
        accountingAmountMicros: 1_000_000n,
        cashEffectMicros: 1_000_000n,
        nativeAmountAtomic: 1_000_000n,
        nativeContract: "wrong-contract",
        accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
      }),
    );

    let attributionReads = 0;
    const wrapped = {
      loadContributionFacts: (context: typeof ctxA) =>
        services.shareFacts.loadContributionFacts(context),
      loadAttributionFacts: async (context: typeof ctxA) => {
        attributionReads += 1;
        return services.shareFacts.loadAttributionFacts(context);
      },
    };
    const { createContributionShareEngine } = await import("@/lib/waia-core/treasury/share/engine");
    const engine = createContributionShareEngine(wrapped);
    const pub = await getPublicContributionAggregate(ctxA, engine);
    expect(attributionReads).toBe(0);
    expect(pub.qualifyingContributionCount).toBe(51);
    expect(BigInt(pub.totalNetContributionMicros)).toBe(51_000_000n - 100_000n);
    expect(JSON.stringify(pub)).not.toContain(USER_A);

    const pubB = await getPublicContributionAggregate(ctxB, services.shareEngine);
    expect(pubB.qualifyingContributionCount).toBe(1);
    expect(pubB.totalNetContributionMicros).toBe("99000000");

    const self = await getSelfContributionShare(ctxA, USER_A, engine);
    expect(attributionReads).toBe(1);
    expect(BigInt(self.denominatorMicros)).toBe(51_000_000n - 100_000n);
    expect(self.isZeroShare).toBe(false);
  });
});
