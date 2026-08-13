import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";

/**
 * Typed WP-6 boundary. WP-4 must not implement Breath financial formulas or a
 * live public snapshot. `getBreathPublicSnapshot` is intentionally absent.
 */
export type TreasuryBreathPendingDto = {
  status: "pending";
  reasonCode: "TREASURY_BREATH_READ_MODEL_NOT_READY";
};

export type TreasuryBreathReadModelPort = {
  getAdminPreview(context: OrgContext): Promise<TreasuryBreathPendingDto>;
};

/** WP-6 owns public snapshot computation. WP-4 does not implement it. */
export const WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED = false as const;

export function createUnreadyTreasuryBreathReadModel(): TreasuryBreathReadModelPort {
  return {
    async getAdminPreview(): Promise<TreasuryBreathPendingDto> {
      throw new TreasuryValidationError(
        "TREASURY_BREATH_READ_MODEL_NOT_READY",
        "Breath read model is owned by WP-6 and is not ready",
      );
    },
  };
}
