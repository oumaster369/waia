/**
 * Breath of WAIA — public support-channel contract.
 * The public support page is always a real destination. The payment address on
 * that page remains fail-closed until an operator publishes the governed
 * USDT/TRC-20 address through server configuration.
 */

export type BreathSupportChannel = {
  status: "pending" | "available";
  /** Absolute or same-origin path when available; null while pending. */
  href: string | null;
};

/** Canonical public support destination for KEEP WAIA BREATHING. */
export function getBreathSupportChannel(): BreathSupportChannel {
  return {
    status: "available",
    href: "/support",
  };
}
