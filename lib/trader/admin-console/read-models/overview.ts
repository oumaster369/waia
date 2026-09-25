import { createHash } from "node:crypto";

import type { AdminFact, AdminMoney } from "@/lib/trader/admin-console/contracts";
import { adminFact } from "@/lib/trader/admin-console/data-state";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { addDecimal } from "@/lib/trader/risk/numeric";
import type { PeriodResult } from "@/lib/trader/admin-console/money/period-result";

export type OverviewAccount = {
  id: string;
  valuationKey: string;
  included: boolean;
  reason: string | null;
  stale: boolean;
  equity: string | null;
  freeQuote: string | null;
  lockedQuote: string | null;
  holdingsValue: string | null;
  traderPnl: string | null;
  observedAt?: string | null;
  reasons?: string[];
  periodResult?: PeriodResult;
  pnlRevision?: string;
  pnlMethod?: string;
};

export type OverviewSnapshot = {
  finance: {
    equity: AdminFact<AdminMoney>;
    free: AdminFact<AdminMoney>;
    holdings: AdminFact<AdminMoney>;
    reserved: AdminFact<AdminMoney>;
    pnl: AdminFact<AdminMoney>;
  };
  coverageLabel: string;
  included: number;
  total: number;
  lastKnownEstimate: string | null;
  financeRevision: string;
};

function money(amount: string, currency: string, method: string): AdminMoney {
  return { amount, currency, method };
}

function sum(values: readonly string[]): string {
  return values.reduce((total, value) => addDecimal(total, value), "0");
}

export function buildOverview(
  accounts: readonly OverviewAccount[],
  input: {
    currency: string;
    method: string;
    periodBounds: { start: string; end: string };
    mode: string;
  },
): OverviewSnapshot {
  const included = accounts.filter(
    (account) => account.included && !account.stale && account.equity !== null,
  );
  const stale = accounts.filter((account) => account.stale && account.equity !== null);
  const equity = sum(included.map((account) => account.equity!));
  const free = sum(
    included.flatMap((account) => (account.freeQuote === null ? [] : [account.freeQuote])),
  );
  const holdings = sum(
    included.flatMap((account) => (account.holdingsValue === null ? [] : [account.holdingsValue])),
  );
  const reserved = sum(
    included.flatMap((account) => (account.lockedQuote === null ? [] : [account.lockedQuote])),
  );
  const pnlValues = included.flatMap((account) =>
    account.traderPnl === null ? [] : [account.traderPnl],
  );
  const pnl = included.length > 0 && pnlValues.length === included.length ? sum(pnlValues) : null;
  const partial =
    included.length < accounts.length ||
    included.some((account) => account.reasons?.some((reason) => reason !== "COST_BASIS_UNKNOWN"));
  const state =
    accounts.length === 0
      ? "empty"
      : included.length === 0
        ? "unavailable"
        : partial
          ? "partial"
          : "ok";
  const reasons = [
    ...new Set(
      accounts.flatMap((account) => account.reasons ?? (account.reason ? [account.reason] : [])),
    ),
  ];
  if (accounts.length === 0) reasons.push("NO_ACCOUNTS_IN_SCOPE");
  const dates = included
    .flatMap((account) => (account.observedAt ? [account.observedAt] : []))
    .sort();
  const observedAt = dates[0] ?? null;
  const times = { sourceAt: observedAt, observedAt, effectiveAt: observedAt };
  const value = (amount: string) =>
    included.length === 0 ? null : money(amount, input.currency, input.method);
  const financeRevision = createHash("sha256")
    .update(
      canonicalizeSemanticJsonString({
        accounts: [...accounts]
          .map((account) => [
            account.id,
            account.valuationKey,
            String(account.included),
            String(account.stale),
            account.reason ?? "",
            account.pnlRevision ?? "",
          ])
          .sort((left, right) => left[0]!.localeCompare(right[0]!)),
        periodBounds: input.periodBounds,
        currency: input.currency,
        mode: input.mode,
      }),
    )
    .digest("hex");
  return {
    finance: {
      equity: adminFact({
        state,
        value: value(equity),
        reasons,
        times,
        breakdownRef: "accounts",
      }),
      free: adminFact({ state, value: value(free), reasons, times }),
      holdings: adminFact({ state, value: value(holdings), reasons, times }),
      reserved: adminFact({ state, value: value(reserved), reasons, times }),
      pnl: adminFact({
        state:
          pnl === null
            ? accounts.length === 0
              ? "empty"
              : "unavailable"
            : included.some((account) => account.periodResult?.state !== "ok")
              ? "partial"
              : state,
        value:
          pnl === null
            ? null
            : money(
                pnl,
                input.currency,
                included.find((account) => account.pnlMethod)?.pnlMethod ??
                  "operational_legs_plus_unrealized_delta:usdt",
              ),
        reasons: [
          ...new Set([
            ...reasons,
            ...included.flatMap((account) => account.periodResult?.reasons ?? []),
            ...(pnl === null ? ["PNL_PERIOD_EVIDENCE_MISSING"] : []),
          ]),
        ],
        times,
      }),
    },
    coverageLabel: `По ${included.length} актуальным счетам из ${accounts.length}`,
    included: included.length,
    total: accounts.length,
    lastKnownEstimate: stale.length === 0 ? null : sum(stale.map((account) => account.equity!)),
    financeRevision,
  };
}
