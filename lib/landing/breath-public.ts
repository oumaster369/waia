/**
 * Breath of WAIA — public read-only snapshot contract (DEE-605).
 * Authoritative finance publication is owned by DEE-606.
 * Until then, return a truthful pending/empty snapshot — never invent figures.
 */

import { WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";

export type BreathPublicationStatus = "pending" | "published";

export type BreathPublicSnapshot = {
  status: BreathPublicationStatus;
  lastUpdatedAt: string | null;
  stageLabel: string | null;
  resources: {
    currency: "USD" | null;
    entered: number | null;
    allocated: number | null;
    spent: number | null;
    remaining: number | null;
    neededNext: number | null;
  };
  work: {
    summary: string | null;
    githubUrl: typeof WAIA_PUBLIC_GITHUB_URL;
  };
  methodologyNote: string;
};

const PENDING_NOTE =
  "Resource figures publish only after the Breath of WAIA treasury ledger (DEE-606) is available. Until then, this surface shows a truthful pending state — not estimated numbers.";

/** Homepage-facing Breath snapshot. Always pending until DEE-606 wires publication. */
export function getBreathPublicSnapshot(): BreathPublicSnapshot {
  return {
    status: "pending",
    lastUpdatedAt: null,
    stageLabel: null,
    resources: {
      currency: null,
      entered: null,
      allocated: null,
      spent: null,
      remaining: null,
      neededNext: null,
    },
    work: {
      summary: null,
      githubUrl: WAIA_PUBLIC_GITHUB_URL,
    },
    methodologyNote: PENDING_NOTE,
  };
}

export function formatBreathAmount(
  value: number | null,
  currency: "USD" | null,
): string {
  if (value === null || currency === null) return "Not yet published";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
