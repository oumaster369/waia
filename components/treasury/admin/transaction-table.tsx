"use client";

import * as React from "react";
import Link from "next/link";

import { CanonicalSelect, FormField, MoreDetails } from "@/components/treasury/admin/form-controls";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { AccountingStatusPill } from "@/components/treasury/admin/status-pills";
import {
  ledgerCatalogItemLabel,
  useLedgerCatalog,
} from "@/components/treasury/admin/use-ledger-catalog";
import {
  EmptyState,
  LoadingState,
  UnavailableState,
} from "@/components/treasury/admin/unavailable-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { TREASURY_KIND_OPTIONS, TREASURY_PROVENANCE_OPTIONS } from "@/lib/treasury-admin/canonical";
import { formatOccurredAt, signedAmountLabel } from "@/lib/treasury-admin/ledger";
import { financeHref } from "@/lib/treasury-admin/org";
import {
  buildTransactionListQueryParams,
  emptyTransactionFilters,
  type TransactionFilterKey,
  type TransactionFilterState,
} from "@/lib/treasury-admin/tx-filter-query";
import type {
  TreasuryApiResult,
  TreasuryLedgerCatalogItem,
  TreasuryTransactionDto,
} from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import { cn } from "@/lib/utils";

function itemMap(items: TreasuryLedgerCatalogItem[]) {
  return new Map(items.map((item) => [item.id, ledgerCatalogItemLabel(item)]));
}

function TransactionTableInner() {
  const { organizationId } = useFinanceOrg();
  const [filters, setFilters] = React.useState<TransactionFilterState>(emptyTransactionFilters);
  const [applied, setApplied] = React.useState(filters);
  const [offset, setOffset] = React.useState(0);
  const limit = 50;

  const counterparties = useLedgerCatalog(organizationId, "counterparties");
  const categories = useLedgerCatalog(organizationId, "categories");
  const projects = useLedgerCatalog(organizationId, "projects");
  const labels = {
    counterparties: itemMap(counterparties.items),
    categories: itemMap(categories.items),
    projects: itemMap(projects.items),
  };

  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ transactions: TreasuryTransactionDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ transactions: TreasuryTransactionDto[] }>(
      "/api/admin/treasury/transactions",
      organizationId,
      { limit: String(limit), offset: String(offset), ...buildTransactionListQueryParams(applied) },
    );
  }, [applied, offset, organizationId]);
  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `tx-list:${organizationId ?? ""}:${offset}:${JSON.stringify(applied)}`,
    query,
  );
  const rows = data?.transactions ?? [];

  function setFilter(key: TransactionFilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...filters });
  }

  function clearFilters() {
    const empty = emptyTransactionFilters();
    setFilters(empty);
    setApplied(empty);
    setOffset(0);
  }

  return (
    <div className="space-y-5" data-testid="finance-transaction-table">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Transactions</h2>
          <p className="text-muted-foreground text-sm">
            The complete financial flow. Automated wallet entries wait for Human review.
          </p>
        </div>
        <Link
          className={cn(buttonVariants(), "inline-flex")}
          data-testid="add-manual-transaction"
          href={financeHref("/finance/transactions/new", organizationId)}
        >
          Add transaction
        </Link>
      </div>

      <form className="space-y-3" data-testid="tx-filter-panel" onSubmit={applyFilters}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <FormField label="Status" htmlFor="filter-status">
              <CanonicalSelect
                id="filter-status"
                testId="tx-filter-status"
                value={filters.status}
                onChange={(value) => setFilter("status", value)}
                options={[
                  { value: "NEEDS_REVIEW", label: "Requires review" },
                  { value: "VERIFIED", label: "Verified" },
                  { value: "PLANNED", label: "Planned" },
                ]}
                blankLabel="All statuses"
              />
            </FormField>
          </div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        </div>
        <MoreDetails summary="More filters" testId="tx-filter-advanced">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <FormField label="Kind" htmlFor="filter-kind">
              <CanonicalSelect
                id="filter-kind"
                value={filters.kind}
                onChange={(value) => setFilter("kind", value)}
                options={TREASURY_KIND_OPTIONS}
                blankLabel="Any kind"
              />
            </FormField>
            <FormField label="Source" htmlFor="filter-provenance">
              <CanonicalSelect
                id="filter-provenance"
                value={filters.provenance}
                onChange={(value) => setFilter("provenance", value)}
                options={TREASURY_PROVENANCE_OPTIONS}
                blankLabel="Any source"
              />
            </FormField>
            <FormField label="From" htmlFor="filter-occurred-from">
              <Input
                id="filter-occurred-from"
                type="date"
                value={filters.occurred_at_from}
                onChange={(event) => setFilter("occurred_at_from", event.target.value)}
              />
            </FormField>
            <FormField label="To" htmlFor="filter-occurred-to">
              <Input
                id="filter-occurred-to"
                type="date"
                value={filters.occurred_at_to}
                onChange={(event) => setFilter("occurred_at_to", event.target.value)}
              />
            </FormField>
          </div>
          <p className="text-muted-foreground text-xs">
            Catalog filters will appear only when the server contract can apply them to the full
            ledger; this page never filters a partial page locally.
          </p>
        </MoreDetails>
      </form>

      {loading ? <LoadingState /> : null}
      {error ? (
        <UnavailableState code={error.code} message={error.message} onRetry={reload} />
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState label="No transactions match these filters." />
      ) : null}
      {!loading && !error && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-muted/30">
              <tr className="border-b">
                <th className="p-3">Counterparty</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Date & time</th>
                <th className="p-3">Project</th>
                <th className="p-3">Notes</th>
                <th className="p-3">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const occurred = formatOccurredAt(row.occurredAt);
                return (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="p-3">
                      {(row.counterpartyId && labels.counterparties.get(row.counterpartyId)) ??
                        row.counterpartyDisplay ??
                        "—"}
                    </td>
                    <td className="p-3">
                      {(row.categoryId && labels.categories.get(row.categoryId)) ??
                        row.category ??
                        "—"}
                    </td>
                    <td
                      className={cn(
                        "p-3 text-right font-mono tabular-nums",
                        row.signedAmountMicros?.startsWith("-") ? "text-destructive" : "",
                      )}
                    >
                      {signedAmountLabel(row.signedAmountMicros)}
                      {row.nativeAsset ? (
                        <span className="text-muted-foreground ml-1 text-xs">
                          {row.nativeAsset}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <AccountingStatusPill status={row.status} />
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="block">{occurred.date}</span>
                      <span className="text-muted-foreground text-xs">{occurred.time}</span>
                    </td>
                    <td className="p-3">
                      {(row.projectId && labels.projects.get(row.projectId)) ??
                        row.projectModule ??
                        "—"}
                    </td>
                    <td
                      className="max-w-[16rem] truncate p-3"
                      title={row.internalNotes ?? undefined}
                    >
                      {row.internalNotes ?? "—"}
                    </td>
                    <td className="p-3">
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={financeHref(`/finance/transactions/${row.id}`, organizationId)}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
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
