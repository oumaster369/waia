import { treasuryTxStatusEnum } from "@/db/core-enums";
import { IllegalTreasuryTransitionError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryTxStatus } from "@/lib/waia-core/treasury/types";

const ALLOWED_TRANSITIONS: Readonly<Record<TreasuryTxStatus, readonly TreasuryTxStatus[]>> = {
  DETECTED: ["NEEDS_REVIEW", "DUPLICATE", "RECONCILIATION_REQUIRED", "REJECTED"],
  MANUAL_DRAFT: ["PLANNED", "NEEDS_REVIEW", "REJECTED"],
  PLANNED: ["NEEDS_REVIEW", "REJECTED"],
  NEEDS_REVIEW: ["CLASSIFIED", "REJECTED", "DUPLICATE", "RECONCILIATION_REQUIRED"],
  CLASSIFIED: ["VERIFIED", "NEEDS_REVIEW", "REJECTED", "RECONCILIATION_REQUIRED"],
  VERIFIED: ["RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["NEEDS_REVIEW", "REJECTED", "DUPLICATE", "VERIFIED"],
  REJECTED: [],
  DUPLICATE: [],
};

export const TREASURY_TX_STATUSES: readonly TreasuryTxStatus[] = treasuryTxStatusEnum;

export function isTerminalTreasuryTxStatus(status: TreasuryTxStatus): boolean {
  return status === "REJECTED" || status === "DUPLICATE";
}

export function allowedTreasuryTxTransitions(from: TreasuryTxStatus): readonly TreasuryTxStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isTreasuryTxTransitionAllowed(
  from: TreasuryTxStatus,
  to: TreasuryTxStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTreasuryTxTransitionAllowed(
  transactionId: string,
  from: TreasuryTxStatus,
  to: TreasuryTxStatus,
): void {
  if (!isTreasuryTxTransitionAllowed(from, to)) {
    throw new IllegalTreasuryTransitionError(transactionId, from, to);
  }
}
