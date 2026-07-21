"use client";

import * as React from "react";

import { FhvOperationsDashboard } from "@/components/trader/admin/fhv-operations-dashboard";
import {
  AdminErrorState,
  AdminLoadingState,
  AdminOrgSelector,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { FHV_ADMIN_CSRF_HEADER, FHV_ADMIN_CSRF_COOKIE } from "@/lib/trader/fhv-admin-csrf";

const APPROVED_ACTIONS = [
  "PAUSE_AT_CHECKPOINT",
  "RESUME_FROM_CHECKPOINT",
  "GRACEFUL_STOP",
  "EMERGENCY_STOP",
  "CREATE_DIAGNOSTIC_BUNDLE",
] as const;

export default function FhvOperationsAdminPage() {
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("");
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [status, setStatus] = React.useState<Record<string, unknown> | null>(null);
  const [csrfToken, setCsrfToken] = React.useState("");
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [pageLoading, setPageLoading] = React.useState(false);
  const [showRawJson, setShowRawJson] = React.useState(false);
  const [action, setAction] =
    React.useState<(typeof APPROVED_ACTIONS)[number]>("PAUSE_AT_CHECKPOINT");
  const [reason, setReason] = React.useState("Operator-requested campaign control");

  const loadStatus = React.useCallback(async () => {
    if (!organizationId) return;
    setPageLoading(true);
    setPageError(null);
    const response = await fetch(
      `/api/trader/admin/fhv-operations/status?organization_id=${encodeURIComponent(organizationId)}`,
      { cache: "no-store", credentials: "include" },
    );
    const body = (await response.json()) as {
      status?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (!response.ok) {
      setPageError(body.error?.message ?? "Request failed.");
      setStatus(null);
      setCsrfToken("");
    } else {
      setStatus(body.status ?? null);
      setCsrfToken(response.headers.get(FHV_ADMIN_CSRF_HEADER) ?? "");
    }
    setPageLoading(false);
  }, [organizationId]);

  const submitCommand = React.useCallback(async () => {
    if (!organizationId || !csrfToken) return;
    setPageLoading(true);
    setPageError(null);
    const response = await fetch(
      `/api/trader/admin/fhv-operations/commands?organization_id=${encodeURIComponent(organizationId)}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [FHV_ADMIN_CSRF_HEADER]: csrfToken,
        },
        body: JSON.stringify({
          organization_id: organizationId,
          action,
          reason,
          expected_phase:
            typeof status?.campaign === "object" &&
            status.campaign &&
            "phase" in (status.campaign as object)
              ? (status.campaign as { phase: string }).phase
              : "validation",
        }),
      },
    );
    const body = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      setPageError(body.error?.message ?? "Command failed.");
    } else {
      await loadStatus();
    }
    setPageLoading(false);
  }, [organizationId, csrfToken, action, reason, status, loadStatus]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">FHV Operations</h1>
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Campaign status</h2>
          <Button type="button" variant="outline" onClick={() => void loadStatus()}>
            Refresh
          </Button>
        </div>
        {pageLoading ? <AdminLoadingState label="Loading FHV status…" /> : null}
        {pageError ? <AdminErrorState message={pageError} /> : null}
        {status ? (
          <FhvOperationsDashboard
            status={status}
            showRawJson={showRawJson}
            onToggleRawJson={() => setShowRawJson((value) => !value)}
          />
        ) : null}
      </WaiaSurface>

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-lg font-medium">Operator actions</h2>
        <p className="text-muted-foreground text-xs">
          CSRF cookie ({FHV_ADMIN_CSRF_COOKIE}) is set by the server; only the matching header is
          sent from JavaScript.
        </p>
        <select
          className="border-border bg-background w-full max-w-md rounded-md border px-3 py-2 text-sm"
          value={action}
          onChange={(event) => setAction(event.target.value as (typeof APPROVED_ACTIONS)[number])}
        >
          {APPROVED_ACTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <textarea
          className="border-border bg-background min-h-20 w-full rounded-md border px-3 py-2 text-sm"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="button" onClick={() => void submitCommand()} disabled={!csrfToken}>
          Submit signed command
        </Button>
      </WaiaSurface>
    </div>
  );
}
