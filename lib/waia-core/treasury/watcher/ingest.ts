import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { createTreasuryTransactionService } from "@/lib/waia-core/treasury/transaction-service";
import type { TreasuryActorContext } from "@/lib/waia-core/treasury/types";
import { TREASURY_USDT_V1_ASSET } from "@/lib/waia-core/treasury/types";
import {
  computeConfirmationDepth,
  parseChainBlockHeight,
} from "@/lib/waia-core/treasury/watcher/block-height";
import { TREASURY_WATCHER_INGESTION_SOURCE } from "@/lib/waia-core/treasury/watcher/config";
import { computeTreasuryRawEventDigest } from "@/lib/waia-core/treasury/watcher/digest";
import { treasuryObservationIdempotencyKey } from "@/lib/waia-core/treasury/watcher/idempotency";
import {
  assignObservationRoles,
  matchWatchedAddresses,
} from "@/lib/waia-core/treasury/watcher/matching";
import { observationStatusFromDepth } from "@/lib/waia-core/treasury/watcher/observation-status";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";
import type { TreasuryObservedTransfer } from "@/lib/waia-core/treasury/watcher/types";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";

export const WATCHER_SERVICE_ACTOR: TreasuryActorContext = {
  actorType: "service",
  actorUserId: null,
};

export async function ingestObservedTransfer(input: {
  context: OrgContext;
  transfer: TreasuryObservedTransfer;
  tipBlock: string;
  inceptionBlock: string;
  inceptionId: string;
  confirmationsRequired: number;
  network: string;
  tokenContract: string;
  nativeDecimals: number;
  now: Date;
  newId: () => string;
  watcherRepository: TreasuryWatcherRepository;
  transactions: ReturnType<typeof createTreasuryTransactionService>;
  runAtomic: <T>(
    fn: (bound: {
      watcherRepository: TreasuryWatcherRepository;
      transactions: ReturnType<typeof createTreasuryTransactionService>;
    }) => Promise<T>,
  ) => Promise<T>;
}): Promise<{ observations: number; semanticCreated: boolean }> {
  const transferHeight = parseChainBlockHeight(input.transfer.blockHeight, "transfer_block");
  const inception = parseChainBlockHeight(input.inceptionBlock, "inception_block");
  if (transferHeight <= inception) {
    return { observations: 0, semanticCreated: false };
  }

  const addresses = await input.watcherRepository.listActiveWatchedAddresses(
    input.context,
    input.network,
    input.tokenContract,
  );
  const matches = assignObservationRoles(
    matchWatchedAddresses({
      fromAddress: input.transfer.fromAddress,
      toAddress: input.transfer.toAddress,
      addresses,
    }),
  );
  if (matches.length === 0) {
    return { observations: 0, semanticCreated: false };
  }

  const depth = computeConfirmationDepth(input.tipBlock, input.transfer.blockHeight);
  const status = observationStatusFromDepth({
    depth,
    confirmationsRequired: input.confirmationsRequired,
  });
  if (!status) {
    return { observations: 0, semanticCreated: false };
  }

  const internal =
    matches.some((row) => row.direction === "INFLOW") &&
    matches.some((row) => row.direction === "OUTFLOW");
  const semanticDirection = internal ? "INTERNAL" : matches[0]!.direction;
  const digest = computeTreasuryRawEventDigest({
    network: input.network,
    tokenContract: input.tokenContract,
    txHash: input.transfer.txHash,
    transferIndex: input.transfer.transferIndex,
    fromAddress: input.transfer.fromAddress,
    toAddress: input.transfer.toAddress,
    nativeAmountAtomic: input.transfer.nativeAmountAtomic,
    nativeDecimals: input.nativeDecimals,
    blockHeight: input.transfer.blockHeight,
    blockTimestamp: input.transfer.blockTimestamp?.toISOString() ?? null,
  });

  return input.runAtomic(async ({ watcherRepository, transactions }) => {
    const observationIds: string[] = [];
    for (const match of matches) {
      const idempotencyKey = treasuryObservationIdempotencyKey({
        network: input.network,
        txHash: input.transfer.txHash,
        transferIndex: input.transfer.transferIndex,
        watchedAddressId: match.address.id,
      });
      const existing = await watcherRepository.getObservationByIdempotency(
        input.context,
        idempotencyKey,
      );
      if (existing) {
        if (existing.observationStatus === "DROPPED") {
          observationIds.push(existing.id);
          continue;
        }
        if (existing.blockHeight !== input.transfer.blockHeight) {
          throw new TreasuryValidationError(
            "OBSERVATION_IMMUTABLE_BLOCK_CONFLICT",
            `reorg presented different block_height for ${idempotencyKey}`,
          );
        }
        if (
          existing.observationStatus === "OBSERVED" &&
          (status === "CONFIRMED" || depth !== existing.confirmationsObserved)
        ) {
          if (existing.observationStatus === "OBSERVED") {
            await watcherRepository.updateObservationLifecycle(input.context, existing.id, {
              confirmationsObserved: depth,
              observationStatus: status,
            });
          }
        }
        observationIds.push(existing.id);
        continue;
      }
      const observationId = input.newId();
      await watcherRepository.insertChainObservation({
        id: observationId,
        organizationId: input.context.organizationId,
        watchedAddressId: match.address.id,
        network: input.network,
        tokenContract: input.tokenContract,
        assetCode: TREASURY_USDT_V1_ASSET,
        txHash: input.transfer.txHash,
        transferIndex: input.transfer.transferIndex,
        fromAddress: input.transfer.fromAddress,
        toAddress: input.transfer.toAddress,
        direction: match.direction,
        nativeAmountAtomic: input.transfer.nativeAmountAtomic,
        nativeDecimals: input.nativeDecimals,
        blockHeight: input.transfer.blockHeight,
        blockTimestamp: input.transfer.blockTimestamp,
        observedAt: input.now,
        confirmationsObserved: depth,
        confirmationsRequired: input.confirmationsRequired,
        observationStatus: status,
        idempotencyKey,
        ingestionSource: TREASURY_WATCHER_INGESTION_SOURCE,
        rawEventDigest: digest,
        relatedPaymentId: null,
        createdAt: input.now,
      });
      observationIds.push(observationId);
    }

    const before = await watcherRepository.getTransactionByCanonicalTransfer(input.context, {
      network: input.network,
      tokenContract: input.tokenContract,
      txHash: input.transfer.txHash,
      transferIndex: input.transfer.transferIndex,
    });
    const tx = await transactions.ensureWatcherDetected(input.context, WATCHER_SERVICE_ACTOR, {
      direction: semanticDirection,
      nativeAmountAtomic: input.transfer.nativeAmountAtomic,
      nativeDecimals: input.nativeDecimals,
      nativeAsset: TREASURY_USDT_V1_ASSET,
      nativeContract: input.tokenContract,
      canonicalNetwork: input.network,
      canonicalTokenContract: input.tokenContract,
      canonicalTxHash: input.transfer.txHash,
      canonicalTransferIndex: input.transfer.transferIndex,
      occurredAt: input.transfer.blockTimestamp ?? input.now,
      counterpartyIsInternal: internal,
      ledgerInceptionId: input.inceptionId,
    });

    for (let i = 0; i < matches.length; i += 1) {
      const observationId = observationIds[i];
      const match = matches[i];
      if (!observationId || !match) continue;
      const existingLink = await watcherRepository.getLinkForObservation(
        input.context,
        observationId,
      );
      if (existingLink) continue;
      await watcherRepository.insertObservationLink({
        id: input.newId(),
        organizationId: input.context.organizationId,
        transactionId: tx.id,
        observationId,
        observationRole: match.observationRole,
        createdAt: input.now,
      });
    }

    if (semanticDirection === "INFLOW" && watcherRepository.matchContributionIntent) {
      const matchedIntentId = await watcherRepository.matchContributionIntent(input.context, {
        transactionId: tx.id,
        toAddress: input.transfer.toAddress,
        amountAtomic: input.transfer.nativeAmountAtomic,
        network: input.network,
        assetCode: TREASURY_USDT_V1_ASSET,
        now: input.now,
        newId: input.newId,
      });
      if (!matchedIntentId && watcherRepository.ensureAnonymousContributionAttribution) {
        await watcherRepository.ensureAnonymousContributionAttribution(input.context, {
          transactionId: tx.id,
          now: input.now,
          newId: input.newId,
        });
      }
    }

    return { observations: matches.length, semanticCreated: !before };
  });
}
