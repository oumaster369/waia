"use client";

import * as React from "react";

import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { formatAtomicToHumanDecimal } from "@/lib/treasury-admin/parse-human-amount";
import type {
  TreasuryApiResult,
  TreasuryCategoryBudgetAnnualDto,
} from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import { cn } from "@/lib/utils";

function AnnualAmount({ micros, currency }: { micros: string; currency: string }) {
  return (
    <span
      className={cn("font-mono tabular-nums", micros.startsWith("-") && "text-destructive")}
      data-testid={micros.startsWith("-") ? "money-negative" : "money-value"}
    >
      {formatAtomicToHumanDecimal(micros, 6)} {currency}
    </span>
  );
}

export function BudgetsPanel() {
  const { organizationId } = useFinanceOrg();
  const [year, setYear] = React.useState(() => new Date().getFullYear());
  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ annual: TreasuryCategoryBudgetAnnualDto }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ annual: TreasuryCategoryBudgetAnnualDto }>(
      "/api/admin/treasury/category-budgets",
      organizationId,
      { year: String(year) },
    );
  }, [organizationId, year]);
  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `category-budget-annual:${organizationId ?? ""}:${year}`,
    query,
  );

  if (loading) return <LoadingState label="Loading annual budget…" />;
  if (error) return <UnavailableState code={error.code} message={error.message} onRetry={reload} />;
  const annual = data?.annual;

  return (
    <div className="space-y-4" data-testid="finance-annual-budget">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs tracking-wide uppercase">Annual budget</p>
          <h3 className="text-lg font-medium">Automatically derived from monthly history</h3>
        </div>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Year</span>
          <Input
            aria-label="Annual budget year"
            className="w-28"
            type="number"
            min="2000"
            max="2200"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </label>
      </div>
      {annual?.totals.map((total) => (
        <WaiaSurface key={total.currency} variant="elevated" className="p-4">
          <p className="text-muted-foreground text-xs">{annual.year} · {total.currency}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["Budget", total.budgetMicros],
              ["Spent", total.spentMicros],
              ["Remaining", total.remainingMicros],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="mt-1 text-lg">
                  <AnnualAmount micros={value} currency={total.currency} />
                </dd>
              </div>
            ))}
          </dl>
        </WaiaSurface>
      ))}
      {annual && annual.totals.length === 0 ? (
        <p className="text-muted-foreground text-sm">No category budget has been set for this year.</p>
      ) : null}
      <WaiaSurface variant="raised" className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm" data-testid="annual-budget-history">
          <thead className="bg-muted/30">
            <tr className="border-b">
              <th className="p-3">Month</th>
              <th className="p-3 text-right">Budget</th>
              <th className="p-3 text-right">Spent</th>
              <th className="p-3 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {annual?.months.flatMap((month) =>
              month.totals.length === 0 ? [
                <tr key={month.month} className="border-b last:border-0">
                  <td className="p-3 font-medium">{month.month}</td>
                  <td className="text-muted-foreground p-3 text-right">—</td>
                  <td className="text-muted-foreground p-3 text-right">—</td>
                  <td className="text-muted-foreground p-3 text-right">—</td>
                </tr>,
              ] : month.totals.map((total) => (
                <tr key={`${month.month}:${total.currency}`} className="border-b last:border-0">
                  <td className="p-3 font-medium">{month.month}</td>
                  <td className="p-3 text-right"><AnnualAmount micros={total.budgetMicros} currency={total.currency} /></td>
                  <td className="p-3 text-right"><AnnualAmount micros={total.spentMicros} currency={total.currency} /></td>
                  <td className="p-3 text-right"><AnnualAmount micros={total.remainingMicros} currency={total.currency} /></td>
                </tr>
              )),
            ) ?? null}
          </tbody>
        </table>
      </WaiaSurface>
      <p className="text-muted-foreground text-xs">
        Every row is a server-owned snapshot for that month. Adding or verifying a transaction is
        reflected on the next fresh read.
      </p>
    </div>
  );
}
