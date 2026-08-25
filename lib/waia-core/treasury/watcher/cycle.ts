import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type { createTreasuryTransactionService } from "@/lib/waia-core/treasury/transaction-service";
import {
  computeConfirmationDepth,
  computeTreasuryScanRange,
  eachBlockInclusive,
  seedLastScannedBlock,
} from "@/lib/waia-core/treasury/watcher/block-height";
import type { TreasuryChainAdapter } from "@/lib/waia-core/treasury/watcher/chain-adapter.port";
import {
  TREASURY_WATCHER_CHECKPOINT_KEY,
  type TreasuryWatcherConfig,
} from "@/lib/waia-core/treasury/watcher/config";
import {
  ingestObservedTransfer,
  WATCHER_SERVICE_ACTOR,
} from "@/lib/waia-core/treasury/watcher/ingest";
import type { TreasuryWatcherLogger } from "@/lib/waia-core/treasury/watcher/logger";
import {
  isReorgAgeoutEligible,
  observationStatusFromDepth,
} from "@/lib/waia-core/treasury/watcher/observation-status";
import {
  TREASURY_RECON_TOLERANCE_MICROS,
  accountingCashBalanceAt,
  classifyReconciliation,
  pendingExplanationMicros,
} from "@/lib/waia-core/treasury/watcher/reconciliation";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";

export type TreasuryWatcherCycleOutcome =
  | "noop_disabled"
  | "noop_no_inception"
  | "noop_lease_held"
  | "noop_provider_error"
  | "failed_closed"
  | "completed";

export type TreasuryWatcherCycleReport = {
  organizationId: string;
  outcome: TreasuryWatcherCycleOutcome;
  tipBlock: string | null;
  fromBlock: string | null;
  toBlock: string | null;
  observationsUpserted: number;
  semanticTransactions: number;
  dropped: number;
  reconciliationStatus: string | null;
  errorMessage: string | null;
  chainCalls: number;
  persistenceMutations: number;
};

export type TreasuryWatcherCycleDeps = {
  config: TreasuryWatcherConfig;
  chainAdapter: TreasuryChainAdapter;
  watcherRepository: TreasuryWatcherRepository;
  treasuryRepository: TreasuryRepository;
  transactions: ReturnType<typeof createTreasuryTransactionService>;
  logger: TreasuryWatcherLogger;
  now?: () => Date;
  newId?: () => string;
  runAtomic?: <T>(
    fn: (bound: {
      watcherRepository: TreasuryWatcherRepository;
      transactions: ReturnType<typeof createTreasuryTransactionService>;
    }) => Promise<T>,
  ) => Promise<T>;
};

function emptyReport(
  organizationId: string,
  outcome: TreasuryWatcherCycleOutcome,
): TreasuryWatcherCycleReport {
  return {
    organizationId,
    outcome,
    tipBlock: null,
    fromBlock: null,
    toBlock: null,
    observationsUpserted: 0,
    semanticTransactions: 0,
    dropped: 0,
    reconciliationStatus: null,
    errorMessage: null,
    chainCalls: 0,
    persistenceMutations: 0,
  };
}

export async function runTreasuryWatcherCycle(
  context: OrgContext,
  deps: TreasuryWatcherCycleDeps,
): Promise<TreasuryWatcherCycleReport> {
  const scoped = requireOrgContext(context.organizationId);
  const now = deps.now?.() ?? new Date();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const runAtomic =
    deps.runAtomic ??
    (async (fn) =>
      fn({
        watcherRepository: deps.watcherRepository,
        transactions: deps.transactions,
      }));
  const counters = { chainCalls: 0, persistenceMutations: 0 };

  if (!deps.config.enabled) {
    deps.logger.log({
      event: "waia_treasury_watcher",
      phase: "disabled",
      organizationId: scoped.organizationId,
    });
    return emptyReport(scoped.organizationId, "noop_disabled");
  }

  const inception = await deps.treasuryRepository.getActiveInception(
    scoped,
    deps.config.network,
    deps.config.tokenContract,
  );
  if (!inception) {
    deps.logger.log({
      event: "waia_treasury_watcher",
      phase: "no_inception",
      organizationId: scoped.organizationId,
    });
    return emptyReport(scoped.organizationId, "noop_no_inception");
  }

  let checkpoint = await deps.watcherRepository.getCheckpoint(
    scoped,
    TREASURY_WATCHER_CHECKPOINT_KEY,
  );
  if (!checkpoint) {
    const seeded = seedLastScannedBlock(inception.watcherStartBlock);
    checkpoint = {
      organizationId: scoped.organizationId,
      checkpointKey: TREASURY_WATCHER_CHECKPOINT_KEY,
      lastScannedBlock: seeded,
      lastScannedAt: now,
      leaseUntil: null,
      lastError: null,
      lastErrorAt: null,
      cycleCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await deps.watcherRepository.insertCheckpoint(checkpoint);
    counters.persistenceMutations += 1;
    deps.logger.log({
      event: "waia_treasury_watcher",
      phase: "checkpoint_seeded",
      organizationId: scoped.organizationId,
      last_scanned_block: seeded,
    });
  }

  let lease = await deps.watcherRepository.tryAcquireLease(
    scoped,
    TREASURY_WATCHER_CHECKPOINT_KEY,
    deps.config.leaseTtlSeconds,
    now,
  );
  if (!lease) {
    const lagSeconds = Math.max(
      0,
      Math.floor((now.getTime() - checkpoint.lastScannedAt.getTime()) / 1000),
    );
    const leaseActive = checkpoint.leaseUntil && checkpoint.leaseUntil.getTime() > now.getTime();
    if (leaseActive && lagSeconds >= deps.config.staleThresholdSeconds) {
      await deps.watcherRepository.releaseLease(scoped, TREASURY_WATCHER_CHECKPOINT_KEY, now);
      lease = await deps.watcherRepository.tryAcquireLease(
        scoped,
        TREASURY_WATCHER_CHECKPOINT_KEY,
        deps.config.leaseTtlSeconds,
        now,
      );
    }
  }
  if (!lease) {
    deps.logger.log({
      event: "waia_treasury_watcher",
      phase: "lease_held",
      organizationId: scoped.organizationId,
    });
    return emptyReport(scoped.organizationId, "noop_lease_held");
  }
  counters.persistenceMutations += 1;

  let observationsUpserted = 0;
  let semanticTransactions = 0;
  let dropped = 0;
  let tipBlock: string | null = null;
  let fromBlock: string | null = null;
  let toBlock: string | null = null;
  let reconciliationStatus: string | null = null;

  try {
    const tip = await deps.chainAdapter.getTipBlock();
    counters.chainCalls += 1;
    if (!tip.ok) {
      await deps.watcherRepository.recordError(
        scoped,
        TREASURY_WATCHER_CHECKPOINT_KEY,
        tip.error,
        now,
      );
      deps.logger.log({
        event: "waia_treasury_watcher",
        phase: "provider_error",
        organizationId: scoped.organizationId,
        error: tip.error,
      });
      return {
        ...emptyReport(scoped.organizationId, "noop_provider_error"),
        errorMessage: tip.error,
        chainCalls: counters.chainCalls,
        persistenceMutations: counters.persistenceMutations,
      };
    }
    tipBlock = tip.value;
    const range = computeTreasuryScanRange({
      lastScannedBlock: checkpoint.lastScannedBlock,
      tipBlock,
      watcherStartBlock: inception.watcherStartBlock,
      inceptionBlock: inception.inceptionBlock,
      rescanWindow: deps.config.rescanWindow,
      maxBlocksPerCycle: deps.config.maxBlocksPerCycle,
    });
    fromBlock = range.fromBlock;
    toBlock = range.toBlock;
    const blocks = eachBlockInclusive(range.fromBlock, range.toBlock);

    for (const block of blocks) {
      const page = await deps.chainAdapter.getTransfersForBlock(block);
      counters.chainCalls += 1;
      if (!page.ok) {
        await deps.watcherRepository.recordError(
          scoped,
          TREASURY_WATCHER_CHECKPOINT_KEY,
          page.error,
          now,
        );
        deps.logger.log({
          event: "waia_treasury_watcher",
          phase: "provider_error",
          organizationId: scoped.organizationId,
          error: page.error,
          block,
        });
        return {
          ...emptyReport(scoped.organizationId, "failed_closed"),
          tipBlock,
          fromBlock,
          toBlock,
          errorMessage: page.error,
          chainCalls: counters.chainCalls,
          persistenceMutations: counters.persistenceMutations,
        };
      }
      for (const transfer of page.value) {
        if (transfer.tokenContract !== deps.config.tokenContract) continue;
        try {
          const result = await ingestObservedTransfer({
            context: scoped,
            transfer,
            tipBlock,
            inceptionBlock: inception.inceptionBlock,
            inceptionId: inception.id,
            confirmationsRequired: deps.config.confirmationsRequired,
            network: deps.config.network,
            tokenContract: deps.config.tokenContract,
            nativeDecimals: deps.config.nativeDecimals,
            now,
            newId,
            watcherRepository: deps.watcherRepository,
            transactions: deps.transactions,
            runAtomic,
          });
          observationsUpserted += result.observations;
          if (result.semanticCreated) semanticTransactions += 1;
          counters.persistenceMutations += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "persist_failed";
          await deps.watcherRepository.recordError(
            scoped,
            TREASURY_WATCHER_CHECKPOINT_KEY,
            message,
            now,
          );
          deps.logger.log({
            event: "waia_treasury_watcher",
            phase: "persist_failed",
            organizationId: scoped.organizationId,
            error: message,
          });
          return {
            ...emptyReport(scoped.organizationId, "failed_closed"),
            tipBlock,
            fromBlock,
            toBlock,
            errorMessage: message,
            chainCalls: counters.chainCalls,
            persistenceMutations: counters.persistenceMutations,
          };
        }
      }
    }

    let existingObservations = await deps.watcherRepository.listObservationsForOrg(scoped);
    for (const observation of existingObservations) {
      if (observation.observationStatus === "OBSERVED") {
        const depth = computeConfirmationDepth(tipBlock, observation.blockHeight);
        const next = observationStatusFromDepth({
          depth,
          confirmationsRequired: observation.confirmationsRequired,
        });
        if (
          next &&
          (next !== observation.observationStatus || depth !== observation.confirmationsObserved)
        ) {
          await deps.watcherRepository.updateObservationLifecycle(scoped, observation.id, {
            confirmationsObserved: depth,
            observationStatus: next,
          });
          counters.persistenceMutations += 1;
          deps.logger.log({
            event: "waia_treasury_watcher",
            phase: "confirmation_progressed",
            organizationId: scoped.organizationId,
            observationId: observation.id,
            observation_status: next,
          });
        }
      }
      if (observation.observationStatus === "DROPPED") continue;
      if (!isReorgAgeoutEligible(observation.createdAt, now, deps.config.reorgAgeoutMinutes)) {
        continue;
      }
      const exists = await deps.chainAdapter.getTransactionExists(observation.txHash);
      counters.chainCalls += 1;
      if (!exists.ok) {
        deps.logger.log({
          event: "waia_treasury_watcher",
          phase: "provider_error",
          organizationId: scoped.organizationId,
          error: exists.error,
          note: "provider_error_is_not_dropped",
        });
        continue;
      }
      if (exists.value) continue;
      await deps.watcherRepository.updateObservationLifecycle(scoped, observation.id, {
        confirmationsObserved: observation.confirmationsObserved,
        observationStatus: "DROPPED",
      });
      dropped += 1;
      counters.persistenceMutations += 1;
      const link = await deps.watcherRepository.getLinkForObservation(scoped, observation.id);
      if (link) {
        await deps.transactions.reopenReconciliation(scoped, WATCHER_SERVICE_ACTOR, {
          transactionId: link.transactionId,
          reason: "watcher reorg age-out DROPPED observation",
        });
      }
      deps.logger.log({
        event: "waia_treasury_watcher",
        phase: "reorg_detected",
        organizationId: scoped.organizationId,
        observationId: observation.id,
      });
    }

    existingObservations = await deps.watcherRepository.listObservationsForOrg(scoped);
    const asOfBlock = toBlock ?? tipBlock;
    const asOfTime = now;
    const txs = await deps.watcherRepository.listOrgTransactions(scoped);
    const observationsByTx = new Map<
      string,
      Awaited<ReturnType<TreasuryWatcherRepository["listLinkedFullObservations"]>>
    >();
    for (const tx of txs) {
      observationsByTx.set(
        tx.id,
        await deps.watcherRepository.listLinkedFullObservations(scoped, tx.id),
      );
    }
    const accounting = accountingCashBalanceAt({
      transactions: txs,
      observationsByTransactionId: observationsByTx,
      asOfBlock,
      asOfTime,
    });
    const watched = await deps.watcherRepository.listActiveWatchedAddresses(
      scoped,
      deps.config.network,
      deps.config.tokenContract,
    );
    const reconAddresses = watched.filter((row) => row.includeInBalanceRecon);
    const pending = pendingExplanationMicros({
      observations: existingObservations,
      watchedAddressIds: new Set(reconAddresses.map((row) => row.id)),
    });

    let observedOnchain: bigint | null = null;
    let chainExact = false;
    if (deps.chainAdapter.getConsolidatedBalanceAtBlock) {
      counters.chainCalls += 1;
      const balance = await deps.chainAdapter.getConsolidatedBalanceAtBlock({
        addresses: reconAddresses.map((row) => row.address),
        asOfBlock,
        tokenContract: deps.config.tokenContract,
      });
      if (balance.ok && balance.value.supported) {
        observedOnchain = balance.value.atomic;
        chainExact = true;
      }
    }

    const classified = accounting.unavailable
      ? {
          status: "UNAVAILABLE" as const,
          deltaMicros: null,
          unexplainedResidualMicros: null,
        }
      : classifyReconciliation({
          observedOnchainBalanceAtomic: observedOnchain,
          accountingCashBalanceMicros: accounting.cashMicros,
          explainedPendingMicros: pending,
          chainBalanceExact: chainExact,
        });

    await deps.watcherRepository.insertBalanceReconciliation({
      id: newId(),
      organizationId: scoped.organizationId,
      ledgerInceptionId: inception.id,
      asOfBlock,
      asOfTime,
      observedOnchainBalanceAtomic: chainExact ? observedOnchain : null,
      accountingCashBalanceMicros: accounting.unavailable ? null : accounting.cashMicros,
      deltaMicros: classified.deltaMicros,
      explainedPendingMicros: pending,
      unexplainedResidualMicros: classified.unexplainedResidualMicros,
      status: classified.status,
      toleranceMicros: TREASURY_RECON_TOLERANCE_MICROS,
      evidenceObjectId: null,
      notes: null,
      createdBy: "treasury-watcher",
      createdAt: now,
    });
    counters.persistenceMutations += 1;
    reconciliationStatus = classified.status;
    deps.logger.log({
      event: "waia_treasury_watcher",
      phase: "reconciliation_emitted",
      organizationId: scoped.organizationId,
      status: classified.status,
      as_of_block: asOfBlock,
    });

    if (blocks.length > 0) {
      await deps.watcherRepository.advanceCursor(
        scoped,
        TREASURY_WATCHER_CHECKPOINT_KEY,
        range.toBlock,
        now,
      );
      counters.persistenceMutations += 1;
      deps.logger.log({
        event: "waia_treasury_watcher",
        phase: "cursor_advanced",
        organizationId: scoped.organizationId,
        last_scanned_block: range.toBlock,
      });
    }

    return {
      organizationId: scoped.organizationId,
      outcome: "completed",
      tipBlock,
      fromBlock,
      toBlock,
      observationsUpserted,
      semanticTransactions,
      dropped,
      reconciliationStatus,
      errorMessage: null,
      chainCalls: counters.chainCalls,
      persistenceMutations: counters.persistenceMutations,
    };
  } finally {
    try {
      await deps.watcherRepository.releaseLease(scoped, TREASURY_WATCHER_CHECKPOINT_KEY, now);
    } catch {
      deps.logger.log({
        event: "waia_treasury_watcher",
        phase: "lease_release_failed",
        organizationId: scoped.organizationId,
      });
    }
  }
}

export function assertNoBusinessMeaningAssigned(input: {
  kind: string | null;
  budgetId: string | null;
  fundingNeedId: string | null;
  purpose: string | null;
  category: string | null;
  publicDescription: string | null;
}): void {
  if (
    input.kind ||
    input.budgetId ||
    input.fundingNeedId ||
    input.purpose ||
    input.category ||
    input.publicDescription
  ) {
    throw new TreasuryValidationError(
      "WATCHER_ASSIGNED_BUSINESS_MEANING",
      "watcher must not assign Human classification fields",
    );
  }
}
