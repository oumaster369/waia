"use client";

import * as React from "react";

import { CanonicalSelect, FieldHelp, FormField } from "@/components/treasury/admin/form-controls";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { TREASURY_USDT_V1_DECIMALS } from "@/lib/treasury-admin/canonical";
import { formatAtomicToHumanDecimal } from "@/lib/treasury-admin/parse-human-amount";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type { TreasuryApiResult, TreasuryTransactionDto } from "@/lib/treasury-admin/types";

const PAGE_SIZE = 50;

export function transactionRefLabel(tx: TreasuryTransactionDto): string {
  const occurred = tx.occurredAt ?? "unknown date";
  const amountSource = tx.accountingAmountMicros ?? tx.nativeAmountAtomic;
  const decimals = tx.nativeDecimals > 0 ? tx.nativeDecimals : TREASURY_USDT_V1_DECIMALS;
  const amount = amountSource
    ? formatAtomicToHumanDecimal(amountSource, decimals)
    : "amount unknown";
  const shortId = tx.id.slice(0, 8);
  return `${occurred} · ${tx.direction} · ${amount} · ${shortId}`;
}

export function TransactionRefSelect(props: {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  emphasizeCorrection?: boolean;
}) {
  return <TransactionRefSelectInner key={props.organizationId} {...props} />;
}

function TransactionRefSelectInner({
  organizationId,
  value,
  onChange,
  disabled,
  emphasizeCorrection,
}: {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  emphasizeCorrection?: boolean;
}) {
  const [extra, setExtra] = React.useState<TreasuryTransactionDto[]>([]);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [exactId, setExactId] = React.useState("");
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);

  const query = React.useCallback((): Promise<
    TreasuryApiResult<{ transactions: TreasuryTransactionDto[] }>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<{ transactions: TreasuryTransactionDto[] }>(
      "/api/admin/treasury/transactions",
      organizationId,
      { limit: String(PAGE_SIZE), offset: "0" },
    );
  }, [organizationId]);

  const { data, error, loading } = useTreasuryQuery(
    Boolean(organizationId),
    `tx-ref:${organizationId}`,
    query,
  );

  const firstPage = data?.transactions ?? [];
  const rows = [...firstPage, ...extra];
  const lastBatch = extra.length === 0 ? firstPage : extra.slice(-PAGE_SIZE);
  const hasMore = lastBatch.length === PAGE_SIZE;

  async function loadMore() {
    setLoadingMore(true);
    const result = await treasuryGet<{ transactions: TreasuryTransactionDto[] }>(
      "/api/admin/treasury/transactions",
      organizationId,
      { limit: String(PAGE_SIZE), offset: String(rows.length) },
    );
    setLoadingMore(false);
    if (!result.ok) {
      setLoadMoreError(result.message);
      return;
    }
    setLoadMoreError(null);
    setExtra((current) => [...current, ...(result.data.transactions ?? [])]);
  }

  const options = rows.map((tx) => ({ value: tx.id, label: transactionRefLabel(tx) }));
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: `Exact id ${value}` });
  }

  return (
    <div className="space-y-2" data-testid="transaction-ref-select">
      <FormField
        label={emphasizeCorrection ? "Corrects transaction" : "Related transaction"}
        htmlFor="corrects-transaction"
        help={
          emphasizeCorrection
            ? "Kind is Correction. Choose the original organization-scoped transaction this draft corrects. Linking remains a later Human command."
            : "Optional. Choose an existing organization-scoped transaction if this draft corrects another record."
        }
      >
        <CanonicalSelect
          id="corrects-transaction"
          value={value && options.some((option) => option.value === value) ? value : ""}
          onChange={onChange}
          options={options}
          blankLabel="None"
          disabled={disabled || loading || loadingMore}
          testId="manual-corrects-transaction"
        />
      </FormField>
      <p className="text-muted-foreground text-xs" data-testid="transaction-ref-pagination-note">
        Showing {rows.length} loaded ledger row{rows.length === 1 ? "" : "s"} for this organization.
        This is a paginated list, not the complete ledger. There is no transaction search API.
      </p>
      {error ? <p className="text-destructive text-xs">{error.message}</p> : null}
      {loadMoreError ? <p className="text-destructive text-xs">{loadMoreError}</p> : null}
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          disabled={loading || loadingMore || disabled}
          onClick={() => void loadMore()}
        >
          Load more transactions
        </Button>
      ) : null}
      <FormField
        label="Exact transaction id (fallback)"
        htmlFor="corrects-transaction-exact"
        help="Use only when the needed row is not in the loaded pages. Submits the canonical transaction id."
      >
        <Input
          id="corrects-transaction-exact"
          data-testid="manual-corrects-transaction-exact"
          value={exactId}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.trim();
            setExactId(event.target.value);
            if (next) onChange(next);
          }}
        />
      </FormField>
      <FieldHelp>
        DEE_616_BACKEND_CONTRACT_GAP: Admin Treasury list is paginated and has no search contract.
      </FieldHelp>
    </div>
  );
}
