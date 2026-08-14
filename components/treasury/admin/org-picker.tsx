"use client";

import * as React from "react";

import { WaiaSurface } from "@/components/waia/waia-surface";
import { treasuryRequest } from "@/lib/treasury-admin/api";
import type { TreasuryOrganization } from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";
import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";

export function FinanceOrgPicker() {
  const { organizationId, setOrganizationId } = useFinanceOrg();
  const { data, error, loading, reload } = useTreasuryQuery(
    true,
    "organizations",
    React.useCallback(
      () =>
        treasuryRequest<{ organizations: TreasuryOrganization[] }>(
          "/api/admin/treasury/organizations",
        ),
      [],
    ),
  );

  if (loading) return <LoadingState label="Loading organizations…" />;
  if (error) return <UnavailableState code={error.code} message={error.message} onRetry={reload} />;

  const organizations = data?.organizations ?? [];

  return (
    <WaiaSurface variant="raised" className="p-4">
      <label htmlFor="finance-org-select" className="text-sm font-medium">
        Organization
      </label>
      <select
        id="finance-org-select"
        data-testid="finance-org-select"
        className="border-border bg-background mt-2 w-full max-w-md rounded-md border px-3 py-2 text-sm"
        value={organizationId ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value) setOrganizationId(value);
        }}
      >
        <option value="">
          {organizations.length === 0 ? "No organizations" : "Select an organization"}
        </option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name ?? org.id} ({org.kind})
          </option>
        ))}
      </select>
      {!organizationId ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Select an organization before reading Treasury facts. Finance never uses a personal org,
          Org-0, or a default first row.
        </p>
      ) : null}
    </WaiaSurface>
  );
}
