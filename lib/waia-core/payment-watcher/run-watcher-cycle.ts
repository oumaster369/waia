import { isAddressActiveForAttribution } from "@/lib/waia-core/payment-addresses/payment-address-lifecycle.transitions";
import { IllegalPaymentTransitionError } from "@/lib/waia-core/payments/payment.errors";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import {
  computeConfirmationDepth,
  computeScanRange,
  isReorgAgeoutEligible,
  shouldConfirm,
  shouldDetect,
} from "@/lib/waia-core/payment-watcher/confirmation";
import {
  parseTxHashFromIdempotencyKey,
  paymentIdempotencyKey,
} from "@/lib/waia-core/payment-watcher/idempotency";
import type { CycleReport, WatcherDeps } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function emptyReport(
  deps: WatcherDeps,
  outcome: CycleReport["outcome"],
  startMs: number,
): CycleReport {
  return {
    network: deps.config.network,
    outcome,
    tipBlock: null,
    fromBlock: null,
    toBlock: null,
    detected: 0,
    confirmed: 0,
    failed: 0,
    skipped: 0,
    provider: null,
    durationMs: Date.now() - startMs,
    errorMessage: null,
  };
}

/** Recover orphaned leases when scan lag exceeds the health stale threshold. */
export async function tryAcquireWatcherLeaseWithStaleRecovery(
  deps: WatcherDeps,
  now: Date = deps.now?.() ?? new Date(),
): Promise<boolean> {
  const { config } = deps;
  const acquired = await deps.checkpointRepository.tryAcquireLease(
    config.network,
    config.leaseTtlSeconds,
  );
  if (acquired) {
    return true;
  }

  const checkpoint = await deps.checkpointRepository.load(config.network);
  if (!checkpoint?.leaseUntil) {
    return false;
  }

  const scanLagSeconds = Math.max(
    0,
    Math.floor((now.getTime() - checkpoint.lastScannedAt.getTime()) / 1000),
  );
  const leaseStillActive = checkpoint.leaseUntil.getTime() > now.getTime();
  if (!leaseStillActive || scanLagSeconds < config.staleThresholdSeconds) {
    return false;
  }

  deps.logger.log({
    event: "waia_payment_watcher",
    phase: "lease_stale_recovery",
    network: config.network,
    scan_lag_seconds: scanLagSeconds,
  });
  await deps.checkpointRepository.releaseLease(config.network);
  return deps.checkpointRepository.tryAcquireLease(config.network, config.leaseTtlSeconds);
}

/** Host-agnostic watcher cycle entrypoint (ADR-0014). */
export async function runWatcherCycle(deps: WatcherDeps): Promise<CycleReport> {
  const startMs = Date.now();
  const now = deps.now?.() ?? new Date();
  const { config } = deps;

  if (!config.enabled) {
    deps.logger.log({
      event: "waia_payment_watcher",
      phase: "cycle_skipped",
      reason: "disabled",
      network: config.network,
    });
    return emptyReport(deps, "noop_disabled", startMs);
  }

  let checkpoint = await deps.checkpointRepository.load(config.network);
  if (!checkpoint) {
    checkpoint = await deps.checkpointRepository.bootstrap(config.network, config.startBlock);
  }

  const leaseAcquired = await tryAcquireWatcherLeaseWithStaleRecovery(deps, now);
  if (!leaseAcquired) {
    deps.logger.log({
      event: "waia_payment_watcher",
      phase: "cycle_skipped",
      reason: "lease_held",
      network: config.network,
    });
    return emptyReport(deps, "noop_lease_held", startMs);
  }

  const counters = { detected: 0, confirmed: 0, failed: 0, skipped: 0 };
  let provider: CycleReport["provider"] = null;
  let tipBlock: string | null = null;
  let fromBlock: string | null = null;
  let toBlock: string | null = null;

  try {
    checkpoint = (await deps.checkpointRepository.load(config.network)) ?? checkpoint;

    const tipResult = await deps.chainAdapter.getTipBlock();
    if (!tipResult.ok) {
      await deps.checkpointRepository.recordError(config.network, tipResult.error);
      deps.logger.log({
        event: "waia_payment_watcher",
        phase: "cycle_noop",
        reason: "provider_error",
        network: config.network,
        error: tipResult.error,
      });
      return {
        ...emptyReport(deps, "noop_provider_error", startMs),
        errorMessage: tipResult.error,
        provider: tipResult.provider,
      };
    }

    tipBlock = tipResult.value;
    provider = tipResult.provider;
    const range = computeScanRange({
      cursorBlock: checkpoint.lastScannedBlock,
      tipBlock,
      startBlock: config.startBlock,
      rescanWindow: config.rescanWindow,
      maxBlocksPerCycle: config.maxBlocksPerCycle,
    });
    fromBlock = range.fromBlock;
    toBlock = range.toBlock;

    const transfersResult = await deps.chainAdapter.getTransfersInRange(fromBlock, toBlock);
    if (!transfersResult.ok) {
      await deps.checkpointRepository.recordError(config.network, transfersResult.error);
      deps.logger.log({
        event: "waia_payment_watcher",
        phase: "cycle_noop",
        reason: "provider_error",
        network: config.network,
        error: transfersResult.error,
      });
      return {
        ...emptyReport(deps, "noop_provider_error", startMs),
        tipBlock,
        fromBlock,
        toBlock,
        errorMessage: transfersResult.error,
        provider: transfersResult.provider ?? provider,
      };
    }

    provider = transfersResult.provider;

    for (const transfer of transfersResult.value) {
      if (transfer.contractAddress !== config.tronContractAddress) {
        counters.skipped += 1;
        deps.logger.log({
          event: "waia_payment_watcher",
          phase: "transfer_skipped",
          skip_reason: "wrong_contract",
          tx_hash: transfer.txHash,
          transfer_index: transfer.transferIndex,
        });
        continue;
      }

      const owner = await deps.inboundResolver.resolveOwnerByDepositAddress(
        config.network,
        transfer.toAddress,
      );
      if (!owner) {
        counters.skipped += 1;
        deps.logger.log({
          event: "waia_payment_watcher",
          phase: "transfer_skipped",
          skip_reason: "unknown_address",
          tx_hash: transfer.txHash,
          to_address: transfer.toAddress,
        });
        continue;
      }

      if (!isAddressActiveForAttribution(owner.status)) {
        counters.skipped += 1;
        deps.logger.log({
          event: "waia_payment_watcher",
          phase: "transfer_skipped",
          skip_reason: "address_not_eligible",
          tx_hash: transfer.txHash,
          organization_id: owner.organizationId,
        });
        continue;
      }

      if (!owner.subjectModule) {
        counters.skipped += 1;
        deps.logger.log({
          event: "waia_payment_watcher",
          phase: "transfer_skipped",
          skip_reason: "address_unbound",
          tx_hash: transfer.txHash,
          organization_id: owner.organizationId,
        });
        continue;
      }

      const orgContext = requireOrgContext(owner.organizationId);
      const depth = computeConfirmationDepth(tipBlock, transfer.blockHeight);
      transfer.confirmationsObserved = depth;

      if (shouldDetect(depth)) {
        const idempotencyKey = paymentIdempotencyKey(transfer.txHash, transfer.transferIndex);
        const detectedProjection = await deps.paymentService.detectPayment(orgContext, {
          idempotencyKey,
          subjectModule: owner.subjectModule,
          paymentAddressId: owner.addressId,
          direction: "INBOUND",
        });
        if (detectedProjection.status === "DETECTED") {
          counters.detected += 1;
          deps.logger.log({
            event: "waia_payment_watcher",
            phase: "payment_detected",
            tx_hash: transfer.txHash,
            transfer_index: transfer.transferIndex,
            organization_id: owner.organizationId,
            depth,
          });
        }
      }

      if (shouldConfirm(depth, config.confirmationsRequired)) {
        const idempotencyKey = paymentIdempotencyKey(transfer.txHash, transfer.transferIndex);
        const detected = await deps.paymentService.detectPayment(orgContext, {
          idempotencyKey,
          subjectModule: owner.subjectModule,
          paymentAddressId: owner.addressId,
          direction: "INBOUND",
        });

        const settlement = buildSettlementEvidence(transfer, config.confirmationsRequired, now);

        try {
          await deps.paymentService.confirmPayment(orgContext, {
            paymentId: detected.paymentId,
            settlement,
            paymentAddressId: owner.addressId,
          });
          counters.confirmed += 1;
          deps.logger.log({
            event: "waia_payment_watcher",
            phase: "payment_confirmed",
            tx_hash: transfer.txHash,
            transfer_index: transfer.transferIndex,
            organization_id: owner.organizationId,
            depth,
          });
        } catch (error) {
          if (error instanceof IllegalPaymentTransitionError) {
            deps.logger.log({
              event: "waia_payment_watcher",
              phase: "payment_confirm_idempotent",
              tx_hash: transfer.txHash,
              transfer_index: transfer.transferIndex,
            });
          } else {
            throw error;
          }
        }
      }
    }

    const staleDetected = await deps.listDetectedInboundPayments();
    for (const row of staleDetected) {
      if (!isReorgAgeoutEligible(row.createdAt, now, config.reorgAgeoutMinutes)) {
        continue;
      }
      const txHash = parseTxHashFromIdempotencyKey(row.idempotencyKey);
      if (!txHash) {
        continue;
      }
      const existsResult = await deps.chainAdapter.getTransactionExists(txHash);
      if (!existsResult.ok) {
        await deps.checkpointRepository.recordError(config.network, existsResult.error);
        return {
          network: config.network,
          outcome: "noop_provider_error",
          tipBlock,
          fromBlock,
          toBlock,
          ...counters,
          provider: existsResult.provider ?? provider,
          durationMs: Date.now() - startMs,
          errorMessage: existsResult.error,
        };
      }
      if (existsResult.value) {
        continue;
      }

      const orgContext = requireOrgContext(row.organizationId);
      await deps.paymentService.failPayment(orgContext, {
        paymentId: row.paymentId,
        reason: "ORPHANED",
      });
      counters.failed += 1;
      deps.logger.log({
        event: "waia_payment_watcher",
        phase: "payment_failed",
        cause: "reorg_dropped",
        reason: "ORPHANED",
        payment_id: row.paymentId,
        tx_hash: txHash,
      });
    }

    await deps.checkpointRepository.saveProgress(config.network, toBlock);
    const report: CycleReport = {
      network: config.network,
      outcome: "success",
      tipBlock,
      fromBlock,
      toBlock,
      ...counters,
      provider,
      durationMs: Date.now() - startMs,
      errorMessage: null,
    };
    deps.logger.log({
      event: "waia_payment_watcher",
      phase: "cycle_complete",
      ...report,
    });
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.checkpointRepository.recordError(config.network, message);
    deps.logger.log({
      event: "waia_payment_watcher",
      phase: "cycle_error",
      network: config.network,
      error: message,
    });
    return {
      network: config.network,
      outcome: "error",
      tipBlock,
      fromBlock,
      toBlock,
      ...counters,
      provider,
      durationMs: Date.now() - startMs,
      errorMessage: message,
    };
  } finally {
    await deps.checkpointRepository.releaseLease(config.network);
  }
}
