/**
 * WP-4 historical flag: WP-4 did not implement the live public snapshot.
 * WP-6 implements `getBreathPublicSnapshot` under Core Treasury.
 */
export const WP4_BREATH_PUBLIC_SNAPSHOT_IMPLEMENTED = false as const;

export type { TreasuryBreathReadModelPort } from "@/lib/waia-core/treasury/breath/read-model";
export type {
  BreathAdminPreview,
  BreathPublicSnapshot,
} from "@/lib/waia-core/treasury/breath/types";
