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
import { CanonicalSelect, FormField } from "@/components/treasury/admin/form-controls";
import { BudgetSelect, CatalogStatus } from "@/components/treasury/admin/org-entity-select";
import { useOrgBudgets } from "@/components/treasury/admin/use-org-catalog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { cn } from "@/lib/utils";
import { financeHref } from "@/lib/treasury-admin/org";
import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type { TreasuryApiResult, TreasuryTransactionDto } from "@/lib/treasury-admin/types";
import {
  TREASURY_DIRECTION_OPTIONS,
  TREASURY_KIND_OPTIONS,
  TREASURY_PROVENANCE_OPTIONS,
  TREASURY_PUBLICATION_OPTIONS,
  TREASURY_STATUS_OPTIONS,
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_ASSET_OPTIONS,
} from "@/lib/treasury-admin/canonical";
import {
  buildTransactionListQueryParams,
  emptyTransactionFilters,
  type TransactionFilterKey,
  type TransactionFilterState,
} from "@/lib/treasury-admin/tx-filter-query";

function TransactionTableInner() {
  const { organizationId } = useFinanceOrg();
  const [filters, setFilters] = React.useState<TransactionFilterState>(emptyTransactionFilters);
  const [applied, setApplied] = React.useState(filters);
  const [offset, setOffset] = React.useState(0);
  const limit = 50;
  const { budgets, loading: budgetsLoading, error: budgetsError } = useOrgBudgets(organizationId);

  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ transactions: TreasuryTransactionDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ transactions: TreasuryTransactionDto[] }>(
      "/api/admin/treasury/transactions",
      organizationId,
      {
        limit: String(limit),
        offset: String(offset),
        ...buildTransactionListQueryParams(applied),
      },
    );
  }, [applied, offset, organizationId]);

  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `tx-list:${organizationId ?? ""}:${offset}:${JSON.stringify(applied)}`,
    query,
  );
  const rows = data?.transactions ?? [];

  function setFilter(key: TransactionFilterKey, value: string) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "needs_reconciliation" && value === "true") next.status = "";
      if (key === "status" && value) next.needs_reconciliation = "";
      return next;
    });
  }

  return (
    <div className="space-y-4" data-testid="finance-transaction-table">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Transactions</h2>
          <p className="text-muted-foreground text-sm">
            Ledger records for the selected organization. Filtering never creates a transaction.
          </p>
        </div>
        <Link
          className={cn(buttonVariants(), "inline-flex")}
          data-testid="add-manual-transaction"
          href={financeHref("/finance/transactions/new", organizationId)}
        >
          Add manual transaction
        </Link>
      </div>

      <WaiaSurface variant="raised" className="p-3">
        <details className="space-y-3" data-testid="tx-filter-panel" open>
          <summary className="cursor-pointer text-sm font-medium">Filter transactions</summary>
          <p className="text-muted-foreground text-xs">
            These controls search existing ledger records on the server. They are not a transaction
            entry form.
          </p>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setApplied({ ...filters });
            }}
          >
            <FormField label="Accounting status" htmlFor="filter-status">
              <CanonicalSelect
                id="filter-status"
                testId="tx-filter-status"
                value={filters.status}
                onChange={(value) => setFilter("status", value)}
                options={TREASURY_STATUS_OPTIONS}
                blankLabel="Any"
              />
            </FormField>
            <FormField
              label="Needs reconciliation"
              htmlFor="filter-needs-reconciliation"
              help="Submits the existing needs_reconciliation=true alias. Do not combine with a conflicting status."
            >
              <CanonicalSelect
                id="filter-needs-reconciliation"
                testId="tx-filter-needs_reconciliation"
                value={filters.needs_reconciliation}
                onChange={(value) => setFilter("needs_reconciliation", value)}
                options={[{ value: "true", label: "Needs reconciliation" }]}
                blankLabel="Any"
              />
            </FormField>
            <FormField label="Detail publication" htmlFor="filter-detail-publication">
              <CanonicalSelect
                id="filter-detail-publication"
                testId="tx-filter-detail_publication"
                value={filters.detail_publication}
                onChange={(value) => setFilter("detail_publication", value)}
                options={TREASURY_PUBLICATION_OPTIONS}
                blankLabel="Any"
              />
            </FormField>
            <FormField label="Kind" htmlFor="filter-kind">
              <CanonicalSelect
                id="filter-kind"
                testId="tx-filter-kind"
                value={filters.kind}
                onChange={(value) => setFilter("kind", value)}
                options={TREASURY_KIND_OPTIONS}
                blankLabel="Any"
              />
            </FormField>
            <FormField label="Direction" htmlFor="filter-direction">
              <CanonicalSelect
                id="filter-direction"
                testId="tx-filter-direction"
                value={filters.direction}
                onChange={(value) => setFilter("direction", value)}
                options={TREASURY_DIRECTION_OPTIONS}
                blankLabel="Any"
              />
            </FormField>
            <FormField label="Provenance" htmlFor="filter-provenance">
              <CanonicalSelect
                id="filter-provenance"
                testId="tx-filter-provenance"
                value={filters.provenance}
                onChange={(value) => setFilter("provenance", value)}
                options={TREASURY_PROVENANCE_OPTIONS}
                blankLabel="Any"
              />
            </FormField>
            <BudgetSelect
              id="filter-budget"
              testId="tx-filter-budget_id"
              value={filters.budget_id}
              onChange={(value) => setFilter("budget_id", value)}
              budgets={budgets}
              blankLabel="Any"
              help="Organization-scoped. Submits budget_id, not the displayed title."
            />
            <FormField
              label="Category"
              htmlFor="filter-category"
              help="Free-form semantic text. This is not a closed WAIA taxonomy."
            >
              <Input
                id="filter-category"
                data-testid="tx-filter-category"
                value={filters.category}
                onChange={(event) => setFilter("category", event.target.value)}
              />
            </FormField>
            <FormField
              label="Project / module"
              htmlFor="filter-project-module"
              help="Free-form semantic text. This is not a closed WAIA taxonomy."
            >
              <Input
                id="filter-project-module"
                data-testid="tx-filter-project_module"
                value={filters.project_module}
                onChange={(event) => setFilter("project_module", event.target.value)}
              />
            </FormField>
            <FormField
              label="Asset"
              htmlFor="filter-asset"
              help={`Treasury V1 native asset is ${TREASURY_USDT_V1_ASSET}.`}
            >
              <CanonicalSelect
                id="filter-asset"
                testId="tx-filter-asset"
                value={filters.asset}
                onChange={(value) => setFilter("asset", value)}
                options={[...TREASURY_USDT_V1_ASSET_OPTIONS]}
                blankLabel="Any"
              />
            </FormField>
            <FormField label="Network" htmlFor="filter-network">
              <Input
                id="filter-network"
                data-testid="tx-filter-network"
                value={filters.network}
                onChange={(event) => setFilter("network", event.target.value)}
              />
            </FormField>
            <FormField label="Token contract" htmlFor="filter-token-contract">
              <Input
                id="filter-token-contract"
                data-testid="tx-filter-token_contract"
                value={filters.token_contract}
                onChange={(event) => setFilter("token_contract", event.target.value)}
              />
            </FormField>
            <FormField
              label="Occurred from"
              htmlFor="filter-occurred-from"
              help="Date-only filters are sent as an exact ISO timestamp at local midnight."
            >
              <Input
                id="filter-occurred-from"
                type="date"
                data-testid="tx-filter-occurred_at_from"
                value={filters.occurred_at_from}
                onChange={(event) => setFilter("occurred_at_from", event.target.value)}
              />
            </FormField>
            <FormField label="Occurred to" htmlFor="filter-occurred-to">
              <Input
                id="filter-occurred-to"
                type="date"
                data-testid="tx-filter-occurred_at_to"
                value={filters.occurred_at_to}
                onChange={(event) => setFilter("occurred_at_to", event.target.value)}
              />
            </FormField>
            <div className="flex items-end gap-2">
              <Button type="submit">Apply server filters</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const empty = emptyTransactionFilters();
                  setFilters(empty);
                  setApplied(empty);
                  setOffset(0);
                }}
              >
                Clear filters
              </Button>
            </div>
          </form>
          <CatalogStatus loading={budgetsLoading} error={budgetsError} />
          <p className="text-muted-foreground text-xs">
            Filters are sent to the server. This page does not treat one paginated result as the
            full ledger. Funding-need list filtering is not offered because that query parameter is
            not in the current Admin Treasury contract.
          </p>
        </details>
      </WaiaSurface>

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
