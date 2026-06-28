"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import {
  AdminErrorState,
  AdminLoadingState,
  AdminOrgSelector,
  adminFetch,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { ReadReviewActionShell } from "@/components/trader/admin/read-review-action-shell";

export default function AdminAuditPage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState(
    searchParams.get("organization_id") ?? "",
  );
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [auditLogs, setAuditLogs] = React.useState<Record<string, unknown> | null>(null);
  const [readLoading, setReadLoading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);

  const loadReadState = React.useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setReadLoading(true);
    setReadError(null);
    const result = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/audit?organization_id=${encodeURIComponent(organizationId)}&limit=50`,
    );
    if (!result.ok) {
      setReadError(result.message);
      setAuditLogs(null);
    } else {
      setAuditLogs(result.data);
    }
    setReadLoading(false);
  }, [organizationId]);

  return (
    <div className="space-y-6">
      {loading ? <AdminLoadingState /> : null}
      {error ? <AdminErrorState message={error} /> : null}
      {!loading && !error ? (
        <AdminOrgSelector
          organizations={organizations}
          value={organizationId}
          onChange={setSelectedOrganizationId}
        />
      ) : null}

      <ReadReviewActionShell
        title="Audit log"
        loading={readLoading}
        error={readError}
        onReload={() => void loadReadState()}
        readContent={
          <pre className="bg-muted/30 max-h-[32rem] overflow-auto rounded-md p-3 text-xs">
            {auditLogs ? JSON.stringify(auditLogs, null, 2) : "No audit entries"}
          </pre>
        }
      />
    </div>
  );
}
