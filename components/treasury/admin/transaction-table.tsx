"use client";

import * as React from "react";
import Link from "next/link";

import { MoneyText } from "@/components/treasury/admin/money-text";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { AccountingStatusPill, PublicationPill } from "@/components/treasury/admin/status-pills";
import {
  LoadingState,
  UnavailableState,
  EmptyState,
} from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { financeHref } from "@/lib/treasury-admin/org";
import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type { TreasuryApiResult, TreasuryTransactionDto } from "@/lib/treasury-admin/types";

const FILTER_KEYS = [
  "status",
  "detail_publication",
  "kind",
  "direction",
  "network",
  "token_contract",
  "asset",
  "project_module",
  "budget_id",
  "category",
  "occurred_at_from",
  "occurred_at_to",
  "provenance",
  "needs_reconciliation",
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

function TransactionTableInner() {
  const { organizationId } = useFinanceOrg();
  const [filters, setFilters] = React.useState<Record<FilterKey, string>>(
    Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])) as Record<FilterKey, string>,
  );
  const [applied, setApplied] = React.useState(filters);
  const [offset, setOffset] = React.useState(0);
  const limit = 50;

  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ transactions: TreasuryTransactionDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    const extra: Record<string, string> = { limit: String(limit), offset: String(offset) };
    for (const key of FILTER_KEYS) {
      if (applied[key]) extra[key] = applied[key];
    }
    return treasuryGet<{ transactions: TreasuryTransactionDto[] }>(
      "/api/admin/treasury/transactions",
      organizationId,
      extra,
    );
  }, [applied, offset, organizationId]);

  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `tx-list:${organizationId ?? ""}:${offset}:${JSON.stringify(applied)}`,
    query,
  );
  const rows = data?.transactions ?? [];

  return (
    <div className="space-y-4" data-testid="finance-transaction-table">
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setApplied({ ...filters });
        }}
      >
        {FILTER_KEYS.map((key) => (
          <div key={key} className="space-y-1">
            <label htmlFor={`filter-${key}`} className="text-xs font-medium">
              {key.replaceAll("_", " ")}
            </label>
            <Input
              id={`filter-${key}`}
              data-testid={`tx-filter-${key}`}
              value={filters[key]}
              onChange={(event) =>
                setFilters((current) => ({ ...current, [key]: event.target.value }))
              }
            />
          </div>
        ))}
        <div className="flex items-end gap-2">
          <Button type="submit">Apply server filters</Button>
          <Link
            className="border-border inline-flex h-8 items-center rounded-lg border px-2.5 text-sm"
            href={financeHref("/finance/transactions/new", organizationId)}
          >
            New manual
          </Link>
        </div>
      </form>
      <p className="text-muted-foreground text-xs">
        Filters are sent to the server. This page does not treat one paginated result as the full
        ledger.
      </p>
      {loading ? <LoadingState /> : null}
      {error ? (
        <UnavailableState code={error.code} message={error.message} onRetry={reload} />
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState label="No transactions match these server filters." />
      ) : null}
      {!loading && !error && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Occurred</th>
                <th className="p-2">Direction</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Accounting</th>
                <th className="p-2">Status</th>
                <th className="p-2">Publication</th>
                <th className="p-2">Provenance</th>
                <th className="p-2">Network / token</th>
                <th className="p-2">Hash</th>
                <th className="p-2">Budget / category / module</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="p-2">
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={financeHref(`/finance/transactions/${row.id}`, organizationId)}
                    >
                      {row.occurredAt ?? row.id}
                    </Link>
                  </td>
                  <td className="p-2">{row.direction}</td>
                  <td className="p-2">{row.kind ?? "—"}</td>
                  <td className="p-2">
                    <MoneyText micros={row.accountingAmountMicros} />
                  </td>
                  <td className="p-2">
                    <AccountingStatusPill status={row.status} />
                  </td>
                  <td className="p-2">
                    <PublicationPill state={row.detailPublication} />
                  </td>
                  <td className="p-2">{row.provenance}</td>
                  <td className="p-2">
                    {row.canonicalNetwork ?? "—"} /{" "}
                    {row.canonicalTokenContract ?? row.nativeAsset ?? "—"}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {row.canonicalTxHash ?? row.txHash ?? "—"}
                  </td>
                  <td className="p-2">
                    {row.budgetId ?? "—"} / {row.category ?? "—"} / {row.projectModule ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={rows.length < limit}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function TransactionTablePanel() {
  return (
    <OrgGate>
      <TransactionTableInner />
    </OrgGate>
  );
}
