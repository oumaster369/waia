"use client";

import Link from "next/link";
import * as React from "react";

import {
  AdminErrorState,
  AdminLoadingState,
  AdminOrgSelector,
  adminFetch,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { WaiaSurface } from "@/components/waia/waia-surface";

const SECTIONS = [
  { href: "/admin/runtime-authority", label: "Runtime Authority" },
  { href: "/admin/fhv-operations", label: "FHV operations" },
  { href: "/admin/kill-switches", label: "Kill switches" },
  { href: "/admin/live-enable", label: "Live enable" },
  { href: "/admin/strategy-promotions", label: "Strategy promotions" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/audit", label: "Audit" },
] as const;

export default function AdminDashboardPage() {
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("");
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [overview, setOverview] = React.useState<Record<string, unknown> | null>(null);
  const [overviewError, setOverviewError] = React.useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = React.useState(false);

  const loadOverview = React.useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setOverviewLoading(true);
    setOverviewError(null);
    const result = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/overview?organization_id=${encodeURIComponent(organizationId)}`,
    );
    if (!result.ok) {
      setOverviewError(result.message);
      setOverview(null);
    } else {
      setOverview(result.data);
    }
    setOverviewLoading(false);
  }, [organizationId]);

  return (
    <div className="space-y-6">
      {loading ? <AdminLoadingState label="Loading organizations…" /> : null}
      {error ? <AdminErrorState message={error} /> : null}

      {!loading && !error ? (
        <AdminOrgSelector
          organizations={organizations}
          value={organizationId}
          onChange={setSelectedOrganizationId}
        />
      ) : null}

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-lg font-medium">Sections</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Link
                href={`${section.href}?organization_id=${encodeURIComponent(organizationId)}`}
                className="hover:bg-muted/40 border-border block rounded-md border px-3 py-2 text-sm"
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </WaiaSurface>

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Overview snapshot</h2>
          <button
            type="button"
            className="border-border hover:bg-muted/40 rounded-md border px-3 py-1.5 text-sm"
            onClick={() => void loadOverview()}
            disabled={!organizationId || overviewLoading}
          >
            Load overview
          </button>
        </div>
        {overviewLoading ? <AdminLoadingState /> : null}
        {overviewError ? (
          <AdminErrorState message={overviewError} onRetry={() => void loadOverview()} />
        ) : null}
        {overview ? (
          <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
            {JSON.stringify(overview, null, 2)}
          </pre>
        ) : null}
      </WaiaSurface>
    </div>
  );
}
