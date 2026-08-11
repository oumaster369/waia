/**
 * Breath of WAIA — public read-only snapshot contract (DEE-605).
 * Authoritative finance publication is owned by DEE-606.
 * Until then, return a truthful pending/empty snapshot — never invent figures.
 *
 * This contract models the full future public read surface so DEE-606 can
 * connect without another homepage redesign.
 */

import { WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";

export type BreathPublicationStatus = "pending" | "published";

export type BreathMoney = {
  currency: "USD" | null;
  amount: number | null;
};

export type BreathTransaction = {
  id: string;
  direction: "inflow" | "outflow";
  label: string;
  amount: number | null;
  currency: "USD" | null;
  occurredAt: string | null;
  /** Public provenance URL when publication allows it. */
  provenanceUrl: string | null;
};

export type BreathPublicSnapshot = {
  status: BreathPublicationStatus;
  /** ISO-8601 when published; null while pending. */
  lastUpdatedAt: string | null;
  /** Current development / funding stage label when published. */
  stageLabel: string | null;
  resources: {
    currency: "USD" | null;
    entered: number | null;
    allocated: number | null;
    spent: number | null;
    remaining: number | null;
    neededNext: number | null;
  };
  budget: {
    currency: "USD" | null;
    planned: number | null;
    funded: number | null;
    committed: number | null;
    spent: number | null;
    remaining: number | null;
    /** 0–1 fill only when authoritative numbers exist; otherwise null. */
    fillRatio: number | null;
  };
  runway: {
    /** Human-readable period (e.g. "12 weeks") when published. */
    periodLabel: string | null;
    value: number | null;
    unit: "days" | "weeks" | "months" | null;
  };
  recentActivity: {
    inflows: ReadonlyArray<BreathTransaction>;
    outflows: ReadonlyArray<BreathTransaction>;
  };
  work: {
    summary: string | null;
    githubUrl: typeof WAIA_PUBLIC_GITHUB_URL;
  };
  methodologyNote: string;
};

const PENDING_NOTE =
  "Stage, resources, budget, runway, and recent activity publish only after the Breath of WAIA treasury ledger (DEE-606) is available. Until then, this surface shows a truthful pending state — not estimated numbers.";

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
    budget: {
      currency: null,
      planned: null,
      funded: null,
      committed: null,
      spent: null,
      remaining: null,
      fillRatio: null,
    },
    runway: {
      periodLabel: null,
      value: null,
      unit: null,
    },
    recentActivity: {
      inflows: [],
      outflows: [],
    },
    work: {
      summary: null,
      githubUrl: WAIA_PUBLIC_GITHUB_URL,
    },
    methodologyNote: PENDING_NOTE,
  };
}

export function formatBreathAmount(value: number | null, currency: "USD" | null): string {
  if (value === null || currency === null) return "Not yet published";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBreathRunway(runway: BreathPublicSnapshot["runway"]): string {
  if (runway.value === null || runway.unit === null) {
    return runway.periodLabel ?? "Not yet published";
  }
  return `${runway.value} ${runway.unit}`;
}
