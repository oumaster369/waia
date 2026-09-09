"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AdminErrorState,
  AdminLoadingState,
  AdminOrgSelector,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import { WaiaSurface } from "@/components/waia/waia-surface";

/** Parent admin layout enforces verified operator admission; each API request
 * independently enforces organization/account authorization. No credentials here. */
export default function AdminAccountObservationPage() {
  const params = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selected, setSelected] = useState("");
  const [credentialId, setCredentialId] = useState(() => params.get("credential_id")?.trim() ?? "");
  const [exchangeAccountId, setExchangeAccountId] = useState(
    () => params.get("exchange_account_id")?.trim() ?? "",
  );
  const requested = selected || params.get("organization_id")?.trim() || "";
  const organizationId = requested
    ? (organizations.find((org) => org.id === requested)?.id ?? "")
    : (organizations[0]?.id ?? "");
  const validCredential = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    credentialId.trim(),
  );
  const target =
    !loading && !error && organizationId && validCredential && exchangeAccountId.trim()
      ? {
          organizationId,
          credentialId: credentialId.trim(),
          exchangeAccountId: exchangeAccountId.trim(),
        }
      : null;
  return (
    <main className="space-y-5">
      <WaiaSurface variant="raised" className="space-y-4 p-5">
        <h1 className="text-xl font-semibold">Account observation operations</h1>
        <p className="text-waia-fg-muted text-sm">
          The same stored observation shown in the tenant workspace updates automatically. This page
          neither connects an HTX account nor enables trading.
        </p>
        {loading && <AdminLoadingState label="Loading authorized organizations…" />}
        {error && <AdminErrorState message="Authorized organizations are unavailable." />}
        {!loading && !error && (
          <AdminOrgSelector
            organizations={organizations}
            value={organizationId}
            onChange={(value) => {
              setSelected(value);
              setCredentialId("");
              setExchangeAccountId("");
            }}
          />
        )}
        <label className="block space-y-1 text-sm">
          <span>Credential record ID (not an API key)</span>
          <input
            className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono"
            value={credentialId}
            onChange={(event) => setCredentialId(event.target.value)}
            maxLength={36}
            autoComplete="off"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Exchange account ID</span>
          <input
            className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono"
            value={exchangeAccountId}
            onChange={(event) => setExchangeAccountId(event.target.value)}
            maxLength={256}
            autoComplete="off"
          />
        </label>
        {!target && (
          <p className="text-waia-fg-muted text-sm">
            Select an authorized organization and provide the exact account and credential record
            IDs. No account values are inferred.
          </p>
        )}
      </WaiaSurface>
      <ConnectedAccountObservationPanel target={target} mode="admin" />
    </main>
  );
}
