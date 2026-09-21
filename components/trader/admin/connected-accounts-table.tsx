"use client";

import Link from "next/link";
import * as React from "react";

import {
  AdminErrorState,
  AdminLoadingState,
  adminFetch,
} from "@/components/trader/admin/admin-org-selector";
import { WaiaSurface } from "@/components/waia/waia-surface";
import {
  ACCOUNT_OBSERVATION_STALE_AFTER_MS,
  ageLabel,
  summarizeCabinetObservation,
} from "@/lib/trader/account-observation/cabinet-view";
import {
  observationBindingSchema,
  parseAccountObservation,
} from "@/lib/trader/account-observation/validation";
import type { ConnectedHtxAccountDto } from "@/lib/trader/credentials/connected-accounts.types";

type RowView = ConnectedHtxAccountDto & {
  observation: "loading" | "waiting" | "ready" | "unavailable";
  usdtFree: string | null;
  usdtLocked: string | null;
  openOrdersCount: number | null;
  lastTickMs: number | null;
};

/** Operator list refresh. Must stay slower than one HTX cabinet tick. */
export const ADMIN_CONNECTED_ACCOUNTS_POLL_MS = 60_000;

const EMPTY_OBSERVATION = {
  usdtFree: null,
  usdtLocked: null,
  openOrdersCount: null,
  lastTickMs: null,
} as const;

function freshnessLabel(row: RowView, nowMs: number): string {
  if (row.observation === "loading") return "Loading…";
  if (row.observation === "unavailable") return "Unavailable";
  if (row.observation === "waiting" || row.lastTickMs === null) return "Connecting";
  return nowMs - row.lastTickMs >= ACCOUNT_OBSERVATION_STALE_AFTER_MS ? "Last tick" : "Live";
}

function drillHref(account: ConnectedHtxAccountDto): string {
  const params = new URLSearchParams({
    organization_id: account.organizationId,
    credential_id: account.credentialId,
    exchange_account_id: account.exchangeAccountId,
  });
  return `/admin/account-observation?${params}`;
}

async function readObservationRow(
  account: ConnectedHtxAccountDto,
  signal: AbortSignal,
): Promise<
  Pick<RowView, "observation" | "usdtFree" | "usdtLocked" | "openOrdersCount" | "lastTickMs">
> {
  const empty = EMPTY_OBSERVATION;
  const bindingParams = new URLSearchParams({
    organizationId: account.organizationId,
    credentialId: account.credentialId,
    exchangeAccountId: account.exchangeAccountId,
  });
  const bindingResponse = await fetch(
    `/api/trader/admin/account-observation/binding?${bindingParams}`,
    { cache: "no-store", credentials: "same-origin", signal },
  );
  if (bindingResponse.status === 204) {
    return { observation: "waiting", ...empty };
  }
  if (!bindingResponse.ok) {
    return { observation: "unavailable", ...empty };
  }
  const binding = observationBindingSchema.parse(await bindingResponse.json());
  const observationParams = new URLSearchParams(binding);
  const observationResponse = await fetch(
    `/api/trader/admin/account-observation?${observationParams}`,
    { cache: "no-store", credentials: "same-origin", signal },
  );
  if (observationResponse.status === 204) {
    return { observation: "waiting", ...empty };
  }
  if (!observationResponse.ok) {
    return { observation: "unavailable", ...empty };
  }
  const summary = summarizeCabinetObservation(
    parseAccountObservation(await observationResponse.json()),
  );
  return {
    observation: "ready",
    usdtFree: summary.usdtFree,
    usdtLocked: summary.usdtLocked,
    openOrdersCount: summary.openOrdersCount,
    lastTickMs: summary.lastTickMs,
  };
}

export function ConnectedAccountsTable() {
  const [rows, setRows] = React.useState<RowView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const hasTicks = rows.some((row) => row.lastTickMs !== null);

  React.useEffect(() => {
    if (!hasTicks) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasTicks]);

  React.useEffect(() => {
    const controller = new AbortController();
    let generation = 0;
    async function load() {
      const ticket = ++generation;
      const first = ticket === 1;
      if (first) {
        setLoading(true);
        setError(null);
      }
      const result = await adminFetch<{ accounts?: ConnectedHtxAccountDto[] }>(
        "/api/trader/admin/connected-accounts",
      );
      if (controller.signal.aborted || ticket !== generation) return;
      if (!result.ok) {
        if (first) {
          setError(result.message);
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const accounts = result.data.accounts ?? [];
      setRows((current) => {
        const previous = new Map(current.map((row) => [row.credentialId, row]));
        return accounts.map((account) => {
          const prior = previous.get(account.credentialId);
          return prior
            ? { ...prior, accountName: account.accountName, updatedAt: account.updatedAt }
            : {
                ...account,
                observation: "loading" as const,
                ...EMPTY_OBSERVATION,
              };
        });
      });
      if (first) setLoading(false);
      const observed = await Promise.all(
        accounts.map(async (account) => {
          try {
            return {
              credentialId: account.credentialId,
              ...(await readObservationRow(account, controller.signal)),
            };
          } catch {
            return {
              credentialId: account.credentialId,
              observation: "unavailable" as const,
              ...EMPTY_OBSERVATION,
            };
          }
        }),
      );
      if (controller.signal.aborted || ticket !== generation) return;
      const byId = new Map(observed.map((row) => [row.credentialId, row]));
      setRows((current) =>
        current.map((row) => {
          const next = byId.get(row.credentialId);
          return next ? { ...row, ...next } : row;
        }),
      );
    }
    void load();
    const timer = window.setInterval(() => void load(), ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (loading) return <AdminLoadingState label="Loading HTX accounts…" />;
  if (error) return <AdminErrorState message={error} />;

  return (
    <WaiaSurface variant="raised" className="space-y-4 p-5">
      <div>
        <h1 className="text-xl font-semibold">HTX accounts</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Personal AI-TRADER cabinets with an active HTX connection. No PnL is calculated here.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No HTX-connected accounts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="admin-connected-accounts">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 pr-3 font-medium">HTX</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Age</th>
                <th className="py-2 pr-3 font-medium">USDT free</th>
                <th className="py-2 pr-3 font-medium">USDT locked</th>
                <th className="py-2 font-medium">Open orders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.credentialId} className="border-border border-b last:border-0">
                  <td className="py-2 pr-3">
                    <Link className="underline-offset-2 hover:underline" href={drillHref(row)}>
                      {row.accountName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 font-mono">{row.exchangeAccountId}</td>
                  <td className="py-2 pr-3">{freshnessLabel(row, nowMs)}</td>
                  <td className="py-2 pr-3">
                    {row.lastTickMs ? ageLabel(row.lastTickMs, nowMs) : "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono">{row.usdtFree ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">{row.usdtLocked ?? "—"}</td>
                  <td className="py-2 font-mono">
                    {row.openOrdersCount === null ? "—" : String(row.openOrdersCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WaiaSurface>
  );
}
