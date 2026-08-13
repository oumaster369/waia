import { treasuryCommitmentStatusEnum } from "@/db/core-enums";
import {
  IllegalTreasuryTransitionError,
  TreasuryValidationError,
} from "@/lib/waia-core/treasury/errors";
import type { TreasuryCommitmentStatus } from "@/lib/waia-core/treasury/types";

const ALLOWED_TRANSITIONS: Readonly<
  Record<TreasuryCommitmentStatus, readonly TreasuryCommitmentStatus[]>
> = {
  DRAFT: ["APPROVED"],
  APPROVED: ["RELEASED", "CANCELLED"],
  RELEASED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export const TREASURY_COMMITMENT_STATUSES: readonly TreasuryCommitmentStatus[] =
  treasuryCommitmentStatusEnum;

export function isActiveCommittedStatus(status: TreasuryCommitmentStatus): boolean {
  return status === "APPROVED" || status === "RELEASED";
}

export function isTreasuryCommitmentTransitionAllowed(
  from: TreasuryCommitmentStatus,
  to: TreasuryCommitmentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTreasuryCommitmentTransitionAllowed(
  commitmentId: string,
  from: TreasuryCommitmentStatus,
  to: TreasuryCommitmentStatus,
  reason?: string | null,
): void {
  if (!isTreasuryCommitmentTransitionAllowed(from, to)) {
    throw new IllegalTreasuryTransitionError(commitmentId, from, to);
  }
  if (from === "RELEASED" && to === "CANCELLED" && !reason?.trim()) {
    throw new TreasuryValidationError(
      "CANCEL_REASON_REQUIRED",
      "RELEASED -> CANCELLED requires an explicit audit reason",
    );
  }
}
