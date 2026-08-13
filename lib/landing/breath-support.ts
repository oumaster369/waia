/**
 * Breath of WAIA — public support-channel contract.
 * Active destination is owned by future Finance publication (DEE-606/607).
 * Until then, the homepage CTA must render as honest pending — never a fake href.
 */

export type BreathSupportChannel = {
  status: "pending" | "available";
  /** Absolute or same-origin path when available; null while pending. */
  href: string | null;
};

/** Canonical public support destination for KEEP WAIA BREATHING. */
export function getBreathSupportChannel(): BreathSupportChannel {
  return {
    status: "pending",
    href: null,
  };
}
