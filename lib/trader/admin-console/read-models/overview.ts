import { createHash } from "node:crypto";

import type { AdminFact, AdminMoney } from "@/lib/trader/admin-console/contracts";
import { adminFact } from "@/lib/trader/admin-console/data-state";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { addDecimal } from "@/lib/trader/risk/numeric";

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
  const pnl = pnlValues.length === included.length ? sum(pnlValues) : null;
  const partial = included.length < accounts.length;
  const state = partial ? "partial" : "ok";
  const reasons = accounts.flatMap((account) => (account.reason ? [account.reason] : []));
  const financeRevision = createHash("sha256")
    .update(
      canonicalizeSemanticJsonString({
        accounts: [...accounts]
          .map((account) => [account.id, account.valuationKey])
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
        value: money(equity, input.currency, input.method),
        reasons,
        breakdownRef: "accounts",
      }),
      free: adminFact({ state, value: money(free, input.currency, input.method), reasons }),
      holdings: adminFact({ state, value: money(holdings, input.currency, input.method), reasons }),
      reserved: adminFact({ state, value: money(reserved, input.currency, input.method), reasons }),
      pnl: adminFact({
        state: pnl === null ? "partial" : state,
        value: pnl === null ? null : money(pnl, input.currency, input.method),
        reasons,
      }),
    },
    coverageLabel: `По ${included.length} актуальным счетам из ${accounts.length}`,
    included: included.length,
    total: accounts.length,
    lastKnownEstimate: stale.length === 0 ? null : sum(stale.map((account) => account.equity!)),
    financeRevision,
  };
}
