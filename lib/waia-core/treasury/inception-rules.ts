import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type {
  TreasuryInceptionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

export function parseChainBlockHeight(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new TreasuryValidationError(
      "INVALID_BLOCK_HEIGHT",
      `${label} must be a non-negative decimal block height`,
    );
  }
  return BigInt(trimmed);
}

/** watcher_start_block must be strictly after inception_block. */
export function assertWatcherStartAfterInception(
  inceptionBlock: string,
  watcherStartBlock: string,
): void {
  const inception = parseChainBlockHeight(inceptionBlock, "inception_block");
  const start = parseChainBlockHeight(watcherStartBlock, "watcher_start_block");
  if (start <= inception) {
    throw new TreasuryValidationError(
      "WATCHER_START_NOT_AFTER_INCEPTION",
      "watcher_start_block must be strictly after inception_block",
    );
  }
}

export function assertOpeningBalanceEligibleForInception(input: {
  opening: TreasuryTransactionRecord;
  organizationId: string;
  evidenceLinkCount: number;
}): void {
  if (input.opening.organizationId !== input.organizationId) {
    throw new TreasuryValidationError(
      "INCEPTION_OPENING_WRONG_ORG",
      "opening balance must belong to the same organization",
    );
  }
  if (input.opening.kind !== "OPENING_BALANCE") {
    throw new TreasuryValidationError(
      "INCEPTION_OPENING_KIND",
      "linked transaction must be kind OPENING_BALANCE",
    );
  }
  if (input.opening.status !== "VERIFIED") {
    throw new TreasuryValidationError(
      "INCEPTION_OPENING_NOT_VERIFIED",
      "ACTIVE inception requires a VERIFIED OPENING_BALANCE",
    );
  }
  if (input.evidenceLinkCount < 1) {
    throw new TreasuryValidationError(
      "INCEPTION_OPENING_EVIDENCE_REQUIRED",
      "opening balance must be evidence-backed",
    );
  }
}

export function assertNoSecondActiveInception(input: {
  existingActive: TreasuryInceptionRecord | null;
  replacingInceptionId?: string | null;
}): void {
  if (!input.existingActive) return;
  if (input.replacingInceptionId && input.existingActive.id === input.replacingInceptionId) {
    return;
  }
  throw new TreasuryValidationError(
    "INCEPTION_ACTIVE_EXISTS",
    "second ACTIVE inception requires an explicit SUPERSEDE replacement path",
  );
}
