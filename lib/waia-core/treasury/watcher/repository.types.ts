import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import type {
  TreasuryBalanceReconciliationRecord,
  TreasuryCanonicalTransferQuery,
  TreasuryChainObservationRecord,
  TreasuryObservationLifecyclePatch,
  TreasuryObservationLinkRecord,
  TreasuryWatchedAddressRecord,
  TreasuryWatcherCheckpointRecord,
} from "@/lib/waia-core/treasury/watcher/types";

export type TreasuryWatcherRepository = {
  listActiveWatchedAddresses(
    context: OrgContext,
    network: string,
    tokenContract: string,
  ): Promise<TreasuryWatchedAddressRecord[]>;
  insertWatchedAddress(record: TreasuryWatchedAddressRecord): Promise<void>;

  getObservationByIdempotency(
    context: OrgContext,
    idempotencyKey: string,
  ): Promise<TreasuryChainObservationRecord | null>;
  getObservationById(
    context: OrgContext,
    observationId: string,
  ): Promise<TreasuryChainObservationRecord | null>;
  insertChainObservation(record: TreasuryChainObservationRecord): Promise<void>;
  updateObservationLifecycle(
    context: OrgContext,
    observationId: string,
    patch: TreasuryObservationLifecyclePatch,
  ): Promise<TreasuryChainObservationRecord>;
  listObservationsForOrg(context: OrgContext): Promise<TreasuryChainObservationRecord[]>;
  listLinkedFullObservations(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryChainObservationRecord[]>;

  insertObservationLink(record: TreasuryObservationLinkRecord): Promise<void>;
  getLinkForObservation(
    context: OrgContext,
    observationId: string,
  ): Promise<TreasuryObservationLinkRecord | null>;
  listLinksForTransaction(
    context: OrgContext,
    transactionId: string,
  ): Promise<TreasuryObservationLinkRecord[]>;

  getCheckpoint(
    context: OrgContext,
    checkpointKey: string,
  ): Promise<TreasuryWatcherCheckpointRecord | null>;
  insertCheckpoint(record: TreasuryWatcherCheckpointRecord): Promise<void>;
  tryAcquireLease(
    context: OrgContext,
    checkpointKey: string,
    leaseTtlSeconds: number,
    now: Date,
  ): Promise<boolean>;
  releaseLease(context: OrgContext, checkpointKey: string, now: Date): Promise<void>;
  advanceCursor(
    context: OrgContext,
    checkpointKey: string,
    lastScannedBlock: string,
    now: Date,
  ): Promise<void>;
  recordError(
    context: OrgContext,
    checkpointKey: string,
    message: string,
    now: Date,
  ): Promise<void>;

  getTransactionByCanonicalTransfer(
    context: OrgContext,
    query: TreasuryCanonicalTransferQuery,
  ): Promise<TreasuryTransactionRecord | null>;
  listOrgTransactions(context: OrgContext): Promise<TreasuryTransactionRecord[]>;

  insertBalanceReconciliation(record: TreasuryBalanceReconciliationRecord): Promise<void>;
  listBalanceReconciliations(context: OrgContext): Promise<TreasuryBalanceReconciliationRecord[]>;
};
