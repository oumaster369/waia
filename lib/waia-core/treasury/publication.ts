import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryDetailPublication, TreasuryTxStatus } from "@/lib/waia-core/treasury/types";

export type DetailPublicationChange = {
  from: TreasuryDetailPublication;
  to: TreasuryDetailPublication;
  accountingStatus: TreasuryTxStatus;
  supersededById?: string | null;
};

export type DetailPublicationResult = {
  detailPublication: TreasuryDetailPublication;
  accountingStatus: TreasuryTxStatus;
  detailSupersededById: string | null;
};

/**
 * Accounting status and detail publication are independent.
 * Changing publication must not change accounting status.
 */
export function applyDetailPublicationChange(
  input: DetailPublicationChange,
): DetailPublicationResult {
  if (input.to === "SUPERSEDED" && !input.supersededById?.trim()) {
    throw new TreasuryValidationError(
      "SUPERSEDE_TARGET_REQUIRED",
      "SUPERSEDED retains history and requires detail_superseded_by_id",
    );
  }

  return {
    detailPublication: input.to,
    accountingStatus: input.accountingStatus,
    detailSupersededById: input.to === "SUPERSEDED" ? (input.supersededById ?? null) : null,
  };
}
