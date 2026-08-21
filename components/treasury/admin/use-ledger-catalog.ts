"use client";

import * as React from "react";

import { missingOrganizationResult, treasuryGet } from "@/lib/treasury-admin/api";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import type {
  TreasuryApiResult,
  TreasuryLedgerCatalogItem,
  TreasuryLedgerCatalogKind,
  TreasuryLedgerCatalogPage,
} from "@/lib/treasury-admin/types";

export function useLedgerCatalog(
  organizationId: string | null,
  kind: TreasuryLedgerCatalogKind,
  search = "",
  enabled = true,
) {
  const deferredSearch = React.useDeferredValue(search.trim());
  const query = React.useCallback((): Promise<
    TreasuryApiResult<TreasuryLedgerCatalogPage<TreasuryLedgerCatalogItem>>
  > => {
    if (!organizationId) return Promise.resolve(missingOrganizationResult());
    return treasuryGet<TreasuryLedgerCatalogPage<TreasuryLedgerCatalogItem>>(
      `/api/admin/treasury/${kind}`,
      organizationId,
      { q: deferredSearch, active: "true", limit: "100" },
    );
  }, [deferredSearch, kind, organizationId]);
  const result = useTreasuryQuery(
    Boolean(organizationId) && enabled,
    `ledger-catalog:${kind}:${organizationId ?? ""}:${deferredSearch}`,
    query,
  );
  return {
    items: (result.data?.[kind] ?? []) as TreasuryLedgerCatalogItem[],
    loading: result.loading,
    error: result.error,
    reload: result.reload,
    isSearchPending: search.trim() !== deferredSearch,
  };
}

export function ledgerCatalogItemLabel(item: TreasuryLedgerCatalogItem): string {
  if ("displayName" in item && "currency" in item) {
    return `${item.displayName} · ${item.currency}`;
  }
  if ("displayName" in item) {
    return item.waiaUsername ? `${item.displayName} · @${item.waiaUsername}` : item.displayName;
  }
  if ("code" in item) return `${item.name} · ${item.code}`;
  return item.name;
}
