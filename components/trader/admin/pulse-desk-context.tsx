"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import {
  useAdminOrganizations,
  type AdminOrganization,
} from "@/components/trader/admin/admin-org-selector";
import {
  useAdminCockpitStream,
  type CockpitConnection,
} from "@/components/trader/admin/use-admin-cockpit-stream";
import { cockpitStreamIsStale, type CockpitSnapshot } from "@/lib/trader/admin/cockpit-client";
import {
  campaignRunIdForCockpit,
  derivePulseLedState,
  type PulseLedState,
} from "@/lib/trader/admin/pulse-desk";
import type { ConnectedHtxAccountDto } from "@/lib/trader/credentials/connected-accounts.types";

export type PulseFactKey = "releaseIdentity" | "runtimeAuthority" | "observationFreshness" | "c3";

export type PulseSelection =
  | { readonly kind: "none" }
  | { readonly kind: "reason"; readonly code: string }
  | { readonly kind: "account"; readonly credentialId: string }
  | { readonly kind: "fact"; readonly factKey: PulseFactKey };

export type PulseDeskValue = {
  organizations: readonly AdminOrganization[];
  organizationsLoading: boolean;
  organizationsError: string | null;
  organizationId: string;
  organizationName: string;
  setOrganizationId: (organizationId: string) => void;
  accounts: readonly ConnectedHtxAccountDto[];
  accountsLoading: boolean;
  accountsError: string | null;
  accountId: string;
  setAccountId: (accountId: string) => void;
  scopedAccounts: readonly ConnectedHtxAccountDto[];
  campaignRunId: string;
  setCampaignRunId: (campaignRunId: string) => void;
  snapshot: CockpitSnapshot | null;
  connection: CockpitConnection;
  lastContactMs: number | null;
  nowMs: number;
  stale: boolean;
  led: PulseLedState;
  selection: PulseSelection;
  select: (selection: PulseSelection) => void;
};

const PulseDeskContext = React.createContext<PulseDeskValue | null>(null);

export function usePulseDesk(): PulseDeskValue {
  const value = React.useContext(PulseDeskContext);
  if (!value) {
    throw new Error("Pulse desk is only available inside PulseShell.");
  }
  return value;
}

function hrefWithQuery(
  pathname: string,
  current: { toString(): string },
  mutate: (params: URLSearchParams) => void,
): string {
  const params = new URLSearchParams(current.toString());
  mutate(params);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function PulseDeskProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/admin";
  const searchParams = useSearchParams();
  const requestedOrg = searchParams.get("organization_id")?.trim() ?? "";
  const requestedCampaign = searchParams.get("campaign_run_id")?.trim() ?? "";
  const {
    organizations,
    loading: organizationsLoading,
    error: organizationsError,
  } = useAdminOrganizations();
  const organizationId = requestedOrg || organizations[0]?.id || "";
  const organizationName =
    organizations.find((organization) => organization.id === organizationId)?.name ??
    organizationId;
  const cockpitCampaign = campaignRunIdForCockpit(requestedCampaign);
  const { snapshot, connection, lastContactMs } = useAdminCockpitStream(
    organizationId,
    cockpitCampaign,
  );
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [accounts, setAccounts] = React.useState<ConnectedHtxAccountDto[]>([]);
  const [accountsLoading, setAccountsLoading] = React.useState(true);
  const [accountsError, setAccountsError] = React.useState<string | null>(null);
  const [accountId, setAccountId] = React.useState("");
  const [selection, setSelection] = React.useState<PulseSelection>({ kind: "none" });

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/trader/admin/connected-accounts", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setAccountsError("Connected accounts are unavailable.");
            setAccountsLoading(false);
          }
          return;
        }
        const body = (await response.json()) as { accounts?: ConnectedHtxAccountDto[] };
        if (!controller.signal.aborted) {
          setAccounts(body.accounts ?? []);
          setAccountsError(null);
          setAccountsLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setAccountsError("Connected accounts are unavailable.");
          setAccountsLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  const scopedAccounts = React.useMemo(
    () =>
      organizationId
        ? accounts.filter((account) => account.organizationId === organizationId)
        : accounts,
    [accounts, organizationId],
  );
  const resolvedAccountId = scopedAccounts.some((account) => account.credentialId === accountId)
    ? accountId
    : "";

  const stale = cockpitStreamIsStale(lastContactMs, nowMs);
  const led = derivePulseLedState(connection, stale);

  const setOrganizationId = React.useCallback(
    (next: string) => {
      setAccountId("");
      setSelection({ kind: "none" });
      router.replace(
        hrefWithQuery(pathname, searchParams, (params) => {
          const id = next.trim();
          if (id) params.set("organization_id", id);
          else params.delete("organization_id");
        }),
        { scroll: false },
      );
    },
    [pathname, router, searchParams],
  );

  const setCampaignRunId = React.useCallback(
    (next: string) => {
      const campaign = campaignRunIdForCockpit(next);
      if (next.trim() && !campaign) return;
      router.replace(
        hrefWithQuery(pathname, searchParams, (params) => {
          if (campaign) params.set("campaign_run_id", campaign);
          else params.delete("campaign_run_id");
        }),
        { scroll: false },
      );
    },
    [pathname, router, searchParams],
  );

  const value = React.useMemo<PulseDeskValue>(
    () => ({
      organizations,
      organizationsLoading,
      organizationsError,
      organizationId,
      organizationName,
      setOrganizationId,
      accounts,
      accountsLoading,
      accountsError,
      accountId: resolvedAccountId,
      setAccountId,
      scopedAccounts,
      campaignRunId: requestedCampaign,
      setCampaignRunId,
      snapshot,
      connection,
      lastContactMs,
      nowMs,
      stale,
      led,
      selection,
      select: setSelection,
    }),
    [
      organizations,
      organizationsLoading,
      organizationsError,
      organizationId,
      organizationName,
      setOrganizationId,
      accounts,
      accountsLoading,
      accountsError,
      resolvedAccountId,
      scopedAccounts,
      requestedCampaign,
      setCampaignRunId,
      snapshot,
      connection,
      lastContactMs,
      nowMs,
      stale,
      led,
      selection,
    ],
  );

  return <PulseDeskContext.Provider value={value}>{children}</PulseDeskContext.Provider>;
}
