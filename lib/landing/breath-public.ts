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
  /**
   * Canonical ideal annual operating budget (one-year breath capacity target).
   * Distinct from generic budget.planned — DEE-606 publishes this explicitly.
   */
  idealAnnualBudget: BreathMoney;
  /**
   * Current free / uncommitted treasury funds available to operate.
   * Distinct from ambiguous remaining fields — DEE-606 publishes this explicitly.
   */
  currentFreeFunds: BreathMoney;
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
    /**
     * Authoritative ISO-8601 instant when current free funds are projected to end.
     * Required for the live countdown; null until the ledger publishes it.
     */
    endsAt: string | null;
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
  "Stage, resources, budget, runway, and recent activity publish only after the Breath of WAIA treasury ledger is available. Until then, this surface shows a truthful pending state — not estimated numbers.";

/** Homepage-facing Breath snapshot. Always pending until the treasury ledger publishes. */
export function getBreathPublicSnapshot(): BreathPublicSnapshot {
  return {
    status: "pending",
    lastUpdatedAt: null,
    stageLabel: null,
    idealAnnualBudget: { currency: null, amount: null },
    currentFreeFunds: { currency: null, amount: null },
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
      endsAt: null,
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

/**
 * Funding-gauge marker ratio: currentFreeFunds / idealAnnualBudget.
 * Returns null when either side is unpublished, currencies mismatch, or ideal ≤ 0.
 * Never fabricates a position.
 */
export function deriveBreathFundingMarkerRatio(
  free: BreathMoney,
  ideal: BreathMoney,
): number | null {
  if (
    free.amount === null ||
    ideal.amount === null ||
    free.currency === null ||
    ideal.currency === null ||
    free.currency !== ideal.currency ||
    ideal.amount <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(1, free.amount / ideal.amount));
}

/** True only when both sides are published, currencies match, and free ≥ ideal. */
export function isBreathAnnualTargetMet(free: BreathMoney, ideal: BreathMoney): boolean {
  if (
    free.amount === null ||
    ideal.amount === null ||
    free.currency === null ||
    ideal.currency === null ||
    free.currency !== ideal.currency
  ) {
    return false;
  }
  return free.amount >= ideal.amount;
}

/**
 * Compact remaining-time label from millisecond delta.
 * Never negative; no seconds; format: `{d}d {h}h {m}m`.
 */
export function formatBreathCountdown(remainingMs: number): string {
  const clamped = Math.max(0, Math.floor(remainingMs));
  const totalMinutes = Math.floor(clamped / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
}
