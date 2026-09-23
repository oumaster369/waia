"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { AdminCockpitFacts } from "@/components/trader/admin/admin-cockpit-facts";
import { OverviewLoader } from "@/components/trader/admin-console/sections/overview/overview-loader";
import {
  AdminErrorState,
  AdminLoadingState,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { adminScopedHref } from "@/lib/trader/admin/cockpit-client";
import type { ConnectedHtxAccountDto } from "@/lib/trader/credentials/connected-accounts.types";

const SECTIONS = [
  { href: "/admin/account-observation", label: "Accounts" },
  { href: "/admin/runtime-authority", label: "Runtime Authority" },
  { href: "/admin/fhv-operations", label: "FHV operations" },
  { href: "/admin/kill-switches", label: "Kill switches" },
  { href: "/admin/live-enable", label: "Live enable" },
  { href: "/admin/strategy-promotions", label: "Strategy promotions" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/audit", label: "Audit" },
] as const;

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organization_id")?.trim() ?? "";
  const { organizations, loading, error } = useAdminOrganizations();
  const [accounts, setAccounts] = React.useState<ConnectedHtxAccountDto[]>([]);
  const [accountsError, setAccountsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/trader/admin/connected-accounts", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!controller.signal.aborted) setAccountsError("Connected accounts are unavailable.");
          return;
        }
        const body = (await response.json()) as { accounts?: ConnectedHtxAccountDto[] };
        if (!controller.signal.aborted) setAccounts(body.accounts ?? []);
      } catch {
        if (!controller.signal.aborted) setAccountsError("Connected accounts are unavailable.");
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-6">
      <OverviewLoader />
      {loading ? <AdminLoadingState label="Loading organizations…" /> : null}
      {error ? <AdminErrorState message={error} /> : null}

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-lg font-medium">Sections</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Link
                href={adminScopedHref(section.href, organizationId)}
                className="hover:bg-muted/40 border-border block rounded-md border px-3 py-2 text-sm"
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </WaiaSurface>

      {organizations.map((organization) => (
        <AdminCockpitFacts
          key={organization.id}
          organizationId={organization.id}
          organizationName={organization.name}
        />
      ))}

      {accountsError ? <AdminErrorState message={accountsError} /> : null}
      {accounts.map((account) => (
        <ConnectedAccountObservationPanel
          key={account.credentialId}
          mode="admin"
          target={{
            organizationId: account.organizationId,
            credentialId: account.credentialId,
            exchangeAccountId: account.exchangeAccountId,
          }}
        />
      ))}
    </div>
  );
}
