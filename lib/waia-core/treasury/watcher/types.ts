import type {
  TreasuryObservationStatus,
  TreasuryTxDirection,
} from "@/lib/waia-core/treasury/types";

export type TreasuryAddressDirectionScope = "INBOUND" | "OUTBOUND" | "BOTH";
export type ObservationRole = "PRIMARY" | "INTERNAL_COUNTERPARTY" | "SECONDARY";
export type TreasuryBalanceReconStatus =
  | "MATCHED"
  | "PENDING_CONFIRMATIONS"
  | "MISMATCH"
  | "UNAVAILABLE";

export type TreasuryWatchedAddressRecord = {
  id: string;
  organizationId: string;
  network: string;
  address: string;
  tokenContract: string;
  assetCode: string;
  directionScope: TreasuryAddressDirectionScope;
  includeInBalanceRecon: boolean;
  label: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryChainObservationRecord = {
  id: string;
  organizationId: string;
  watchedAddressId: string;
  network: string;
  tokenContract: string;
  assetCode: string;
  txHash: string;
  transferIndex: number;
  fromAddress: string;
  toAddress: string;
  direction: Extract<TreasuryTxDirection, "INFLOW" | "OUTFLOW">;
  nativeAmountAtomic: bigint;
  nativeDecimals: number;
  blockHeight: string;
  blockTimestamp: Date | null;
  observedAt: Date;
  confirmationsObserved: number;
  confirmationsRequired: number;
  observationStatus: TreasuryObservationStatus;
  idempotencyKey: string;
  ingestionSource: string;
  rawEventDigest: string;
  relatedPaymentId: string | null;
  createdAt: Date;
};

export type TreasuryObservationLifecyclePatch = {
  confirmationsObserved: number;
  observationStatus: TreasuryObservationStatus;
};

export type TreasuryObservationLinkRecord = {
  id: string;
  organizationId: string;
  transactionId: string;
  observationId: string;
  observationRole: ObservationRole;
  createdAt: Date;
};

export type TreasuryWatcherCheckpointRecord = {
  organizationId: string;
  checkpointKey: string;
  lastScannedBlock: string;
  lastScannedAt: Date;
  leaseUntil: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  cycleCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryBalanceReconciliationRecord = {
  id: string;
  organizationId: string;
  ledgerInceptionId: string | null;
  asOfBlock: string;
  asOfTime: Date;
  observedOnchainBalanceAtomic: bigint | null;
  accountingCashBalanceMicros: bigint | null;
  deltaMicros: bigint | null;
  explainedPendingMicros: bigint;
  unexplainedResidualMicros: bigint | null;
  status: TreasuryBalanceReconStatus;
  toleranceMicros: bigint;
  evidenceObjectId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
};

export type TreasuryObservedTransfer = {
  txHash: string;
  transferIndex: number;
  fromAddress: string;
  toAddress: string;
  tokenContract: string;
  nativeAmountAtomic: bigint;
  blockHeight: string;
  blockTimestamp: Date | null;
};

export type TreasuryCanonicalTransferQuery = {
  network: string;
  tokenContract: string;
  txHash: string;
  transferIndex: number;
};
