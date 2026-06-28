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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REQUIRED_ORG_LIVE_ENABLE_ACK } from "@/lib/trader/live/config";

export default function AdminLiveEnablePage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState(
    searchParams.get("organization_id") ?? "",
  );
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [state, setState] = React.useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = React.useState<Record<string, unknown> | null>(null);
  const [readLoading, setReadLoading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [expectedVersion, setExpectedVersion] = React.useState("0");
  const [maxNotionalCap, setMaxNotionalCap] = React.useState("1000");
  const [commandMessage, setCommandMessage] = React.useState<string | null>(null);

  const loadReadState = React.useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setReadLoading(true);
    setReadError(null);
    const [stateResult, previewResult] = await Promise.all([
      adminFetch<Record<string, unknown>>(
        `/api/trader/admin/org-live-enable?organization_id=${encodeURIComponent(organizationId)}`,
      ),
      adminFetch<Record<string, unknown>>(
        `/api/trader/admin/org-live-enable?organization_id=${encodeURIComponent(organizationId)}&view=preview`,
      ),
    ]);
    if (!stateResult.ok) {
      setReadError(stateResult.message);
      setState(null);
      setPreview(null);
    } else {
      setState(stateResult.data);
      setPreview(previewResult.ok ? previewResult.data : null);
      const stateVersion = (stateResult.data.state as { stateVersion?: number } | null)
        ?.stateVersion;
      if (stateVersion !== undefined) {
        setExpectedVersion(String(stateVersion));
      }
    }
    setReadLoading(false);
  }, [organizationId]);

  async function runCommand(command: string, extra: Record<string, unknown> = {}) {
    if (!organizationId) {
      return;
    }
    setCommandMessage(null);
    const response = await adminFetch<Record<string, unknown>>(
      "/api/trader/admin/org-live-enable/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          organization_id: organizationId,
          expected_state_version: Number.parseInt(expectedVersion, 10),
          max_notional_cap: maxNotionalCap,
          ack_phrase: REQUIRED_ORG_LIVE_ENABLE_ACK,
          ...extra,
        }),
      },
    );
    setCommandMessage(response.ok ? `${command} succeeded.` : response.message);
    if (response.ok) {
      await loadReadState();
    }
  }

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

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Expected state version</span>
          <Input
            value={expectedVersion}
            onChange={(event) => setExpectedVersion(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Max notional cap</span>
          <Input
            value={maxNotionalCap}
            onChange={(event) => setMaxNotionalCap(event.target.value)}
          />
        </label>
      </div>

      <ReadReviewActionShell
        title="Org live enable"
        loading={readLoading}
        error={readError}
        onReload={() => void loadReadState()}
        readContent={
          <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
            {state ? JSON.stringify(state, null, 2) : "No data"}
          </pre>
        }
        reviewContent={
          preview ? (
            <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
              {JSON.stringify(preview, null, 2)}
            </pre>
          ) : null
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void runCommand("request")}>
              Request
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("confirm")}
            >
              Confirm
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("mark-enabled")}
            >
              Mark enabled
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("disable")}
            >
              Disable
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("cancel")}
            >
              Cancel
            </Button>
          </div>
        }
      />

      {commandMessage ? <p className="text-muted-foreground text-sm">{commandMessage}</p> : null}
    </div>
  );
}
