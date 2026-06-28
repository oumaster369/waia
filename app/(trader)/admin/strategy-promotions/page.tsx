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
import { REQUIRED_EFFECTIVE_ACK } from "@/lib/trader/validation-gate/operator-promotion-inputs";

const STRATEGY_IDS = ["mean_reversion_v0", "liquidity_sweep_reversal_v0"] as const;

export default function AdminStrategyPromotionsPage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState(
    searchParams.get("organization_id") ?? "",
  );
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [strategyId, setStrategyId] = React.useState<string>(STRATEGY_IDS[0]);
  const [recordId, setRecordId] = React.useState("");
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

    const effectiveResult = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/strategy-promotions?organization_id=${encodeURIComponent(organizationId)}&strategy_id=${encodeURIComponent(strategyId)}`,
    );
    if (!effectiveResult.ok) {
      setReadError(effectiveResult.message);
      setReadState(null);
      setPreviewState(null);
      setReadLoading(false);
      return;
    }
    setReadState(effectiveResult.data);

    const effectiveRecord = effectiveResult.data.effective as {
      id?: string;
      stateVersion?: number;
    } | null;
    if (effectiveRecord?.id) {
      setRecordId(effectiveRecord.id);
      if (effectiveRecord.stateVersion !== undefined) {
        setExpectedVersion(String(effectiveRecord.stateVersion));
      }
      const previewResult = await adminFetch<Record<string, unknown>>(
        `/api/trader/admin/strategy-promotions?organization_id=${encodeURIComponent(organizationId)}&record_id=${encodeURIComponent(effectiveRecord.id)}&view=preview`,
      );
      setPreviewState(previewResult.ok ? previewResult.data : null);
    } else {
      setPreviewState(null);
    }

    setReadLoading(false);
  }, [organizationId, strategyId]);

  async function runCommand(command: string) {
    if (!organizationId) {
      return;
    }
    setCommandMessage(null);
    const response = await adminFetch<Record<string, unknown>>(
      "/api/trader/admin/strategy-promotions/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          organization_id: organizationId,
          record_id: recordId || undefined,
          strategy_id: strategyId,
          expected_state_version: Number.parseInt(expectedVersion, 10),
          ack: command === "mark-effective" ? REQUIRED_EFFECTIVE_ACK : undefined,
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
          <span className="font-medium">Strategy</span>
          <select
            className="border-border bg-background rounded-md border px-3 py-2 text-sm"
            value={strategyId}
            onChange={(event) => setStrategyId(event.target.value)}
          >
            {STRATEGY_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Record id</span>
          <Input value={recordId} onChange={(event) => setRecordId(event.target.value)} />
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
        title="Strategy promotions"
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
            <p className="text-muted-foreground text-xs">
              No preview available for current record.
            </p>
          )
        }
        actions={
          <div className="flex flex-wrap gap-2">
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
              onClick={() => void runCommand("mark-effective")}
            >
              Mark effective
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("cancel")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void runCommand("demote")}
            >
              Demote
            </Button>
          </div>
        }
      />

      {commandMessage ? <p className="text-muted-foreground text-sm">{commandMessage}</p> : null}
    </div>
  );
}
