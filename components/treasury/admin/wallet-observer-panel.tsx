"use client";

import * as React from "react";

import { useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { FormField } from "@/components/treasury/admin/form-controls";
import { OrgGate } from "@/components/treasury/admin/org-gate";
import { LoadingState, UnavailableState } from "@/components/treasury/admin/unavailable-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";
import {
  missingOrganizationResult,
  treasuryGet,
  treasuryJson,
  treasuryRequest,
} from "@/lib/treasury-admin/api";
import {
  isValidTronAddress,
  TRC20_USDT_CONTRACT,
  tronScanAddressUrl,
} from "@/lib/treasury-admin/explorer";
import type { TreasuryApiResult, TreasuryWatchedAddressDto } from "@/lib/treasury-admin/types";
import { useTreasuryQuery } from "@/lib/treasury-admin/use-treasury-query";

type TreasuryWatcherHealth = {
  state: "DARK" | "NOT_READY" | "READY_DARK" | "ENABLED";
  enabled: boolean;
  organizationIdPresent: boolean;
  databasePresent: boolean;
  primaryKeyPresent: boolean;
  secondaryConfigured: boolean;
  checkpoint: { lastScannedAt: string; cycleCount: number; hasError: boolean } | null;
};

function WalletObserverInner() {
  const { organizationId } = useFinanceOrg();
  const [label, setLabel] = React.useState("WAIA USDT wallet");
  const [address, setAddress] = React.useState("");
  const [directionScope, setDirectionScope] = React.useState<"INBOUND" | "OUTBOUND" | "BOTH">(
    "BOTH",
  );
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [commandError, setCommandError] = React.useState<string | null>(null);

  const query = React.useCallback(async (): Promise<
    TreasuryApiResult<{
      watchedAddresses: TreasuryWatchedAddressDto[];
      health: TreasuryWatcherHealth;
    }>
  > => {
    if (!organizationId) return missingOrganizationResult();
    const [addresses, health] = await Promise.all([
      treasuryGet<{ watchedAddresses: TreasuryWatchedAddressDto[] }>(
        "/api/admin/treasury/watched-addresses",
        organizationId,
      ),
      treasuryRequest<TreasuryWatcherHealth>("/api/health/treasury-watcher"),
    ]);
    if (!addresses.ok) return addresses;
    if (!health.ok) return health;
    return { ok: true, data: { ...addresses.data, health: health.data } };
  }, [organizationId]);
  const { data, error, loading, reload } = useTreasuryQuery(
    Boolean(organizationId),
    `wallet-observer:${organizationId ?? ""}`,
    query,
  );

  async function addAddress(event: React.FormEvent) {
    event.preventDefault();
    if (!organizationId || !isValidTronAddress(address) || !reason.trim()) return;
    setBusy(true);
    setCommandError(null);
    const result = await treasuryJson("/api/admin/treasury/watched-addresses", "POST", {
      organization_id: organizationId,
      network: "TRC-20",
      address: address.trim(),
      token_contract: TRC20_USDT_CONTRACT,
      asset_code: "USDT",
      direction_scope: directionScope,
      include_in_balance_recon: true,
      label: label.trim(),
      reason: reason.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setCommandError(result.message);
      return;
    }
    setAddress("");
    setReason("");
    reload();
  }

  if (loading) return <LoadingState label="Loading wallet observer…" />;
  if (error) return <UnavailableState code={error.code} message={error.message} onRetry={reload} />;

  const rows = data?.watchedAddresses ?? [];
  const health = data?.health;
  return (
    <div className="space-y-5" data-testid="finance-wallet-observer">
      <div>
        <h2 className="text-lg font-medium">Wallet observer</h2>
        <p className="text-muted-foreground text-sm">
          Read-only observation of public USDT TRC-20 addresses through TronGrid. WAIA never asks
          for a private key and cannot sign or send a transaction from this screen.
        </p>
      </div>
      {health ? (
        <WaiaSurface variant="raised" className="grid gap-3 p-5 sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs uppercase">Observer state</p>
            <p className="mt-1 font-medium">{health.state.replace("_", " ")}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase">TronGrid</p>
            <p className="mt-1 text-sm">
              {health.primaryKeyPresent ? "Primary ready" : "Primary key missing"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase">Independent check</p>
            <p className="mt-1 text-sm">
              {health.secondaryConfigured ? "Secondary ready" : "Secondary missing"}
            </p>
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-3">
            {health.checkpoint
              ? `Last scan ${new Date(health.checkpoint.lastScannedAt).toLocaleString()} · ${health.checkpoint.cycleCount} cycles${health.checkpoint.hasError ? " · attention required" : ""}`
              : "No scan checkpoint yet. Address registration alone never starts observation."}
          </p>
        </WaiaSurface>
      ) : null}
      <WaiaSurface variant="raised" className="space-y-3 p-5">
        <h3 className="text-sm font-medium">Observed addresses</h3>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No Treasury wallet is registered yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const explorer = tronScanAddressUrl(row.address);
              return (
                <li key={row.id} className="border-border rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{row.label}</p>
                    <span className="text-muted-foreground text-xs">
                      {row.isActive ? "Active address" : "Inactive"} · {row.directionScope}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs break-all">{row.address}</p>
                  <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
                    <span>
                      {row.assetCode} · {row.network}
                    </span>
                    {explorer ? (
                      <a href={explorer} target="_blank" rel="noreferrer" className="underline">
                        Open in TronScan
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </WaiaSurface>
      <WaiaSurface variant="elevated" className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-medium">Add a public wallet address</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Registration does not enable the watcher. Production activation remains a separate
            Human-only operation.
          </p>
        </div>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void addAddress(event)}>
          <FormField label="Label" htmlFor="wallet-label">
            <Input
              id="wallet-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
          <FormField label="Direction" htmlFor="wallet-direction">
            <select
              id="wallet-direction"
              className="border-border bg-background rounded-md border px-3 py-2 text-sm"
              value={directionScope}
              onChange={(event) =>
                setDirectionScope(event.target.value as "INBOUND" | "OUTBOUND" | "BOTH")
              }
            >
              <option value="BOTH">Incoming and outgoing</option>
              <option value="INBOUND">Incoming only</option>
              <option value="OUTBOUND">Outgoing only</option>
            </select>
          </FormField>
          <FormField
            label="Public TRC-20 address"
            htmlFor="wallet-address"
            error={address && !isValidTronAddress(address) ? "Enter a valid Tron address." : null}
          >
            <Input
              id="wallet-address"
              autoComplete="off"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </FormField>
          <FormField label="Audit reason" htmlFor="wallet-reason">
            <Input
              id="wallet-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this address belongs to Treasury"
            />
          </FormField>
          {commandError ? (
            <p className="text-destructive text-sm md:col-span-2">{commandError}</p>
          ) : null}
          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={busy || !label.trim() || !reason.trim() || !isValidTronAddress(address)}
            >
              {busy ? "Adding…" : "Add public address"}
            </Button>
          </div>
        </form>
      </WaiaSurface>
    </div>
  );
}

export function WalletObserverPanel() {
  return (
    <OrgGate>
      <WalletObserverInner />
    </OrgGate>
  );
}
