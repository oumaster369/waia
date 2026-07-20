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

export default function AdminKillSwitchesPage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState(
    searchParams.get("organization_id") ?? "",
  );
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [switchType, setSwitchType] = React.useState("EMERGENCY_STOP");
  const [readState, setReadState] = React.useState<Record<string, unknown> | null>(null);
  const [previewState, setPreviewState] = React.useState<Record<string, unknown> | null>(null);
  const [readLoading, setReadLoading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [expectedVersion, setExpectedVersion] = React.useState("0");
  const [commandMessage, setCommandMessage] = React.useState<string | null>(null);

  const loadReadState = React.useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setReadLoading(true);
    setReadError(null);
    const listResult = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/kill-switches?organization_id=${encodeURIComponent(organizationId)}`,
    );
    if (!listResult.ok) {
      setReadError(listResult.message);
      setReadState(null);
      setPreviewState(null);
      setReadLoading(false);
      return;
    }
    setReadState(listResult.data);

    const previewResult = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/kill-switches?organization_id=${encodeURIComponent(organizationId)}&switch_type=${encodeURIComponent(switchType)}&preview=recovery`,
    );
    setPreviewState(previewResult.ok ? previewResult.data : null);
    setReadLoading(false);
  }, [organizationId, switchType]);

  async function runCommand(command: string) {
    if (!organizationId) {
      return;
    }
    setCommandMessage(null);
    const response = await adminFetch<Record<string, unknown>>(
      "/api/trader/admin/kill-switches/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          organization_id: organizationId,
          switch_type: switchType,
          expected_state_version: Number.parseInt(expectedVersion, 10),
          enforcement_mode: "STOP_ACCOUNT",
          origin: "MANUAL",
          reason: "Admin console action",
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
          <span className="font-medium">Switch type</span>
          <Input value={switchType} onChange={(event) => setSwitchType(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Expected state version</span>
          <Input
            value={expectedVersion}
            onChange={(event) => setExpectedVersion(event.target.value)}
          />
        </label>
      </div>

      <ReadReviewActionShell
        title="Kill switches"
        loading={readLoading}
        error={readError}
        onReload={() => void loadReadState()}
        readContent={
          <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
            {readState ? JSON.stringify(readState, null, 2) : "No data"}
          </pre>
        }
        reviewContent={
          previewState ? (
            <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
              {JSON.stringify(previewState, null, 2)}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">No recovery preview for this switch.</p>
          )
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void runCommand("trip")}>
              Trip
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("request-clear")}
            >
              Request clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("confirm-clear")}
            >
              Confirm clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("cancel-clear")}
            >
              Cancel clear
            </Button>
          </div>
        }
      />

      {commandMessage ? <p className="text-muted-foreground text-sm">{commandMessage}</p> : null}
    </div>
  );
}
