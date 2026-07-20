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
import { Textarea } from "@/components/ui/textarea";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { REQUIRED_EFFECTIVE_ACK } from "@/lib/trader/validation-gate/operator-promotion-inputs";

const STRATEGY_IDS = ["mean_reversion_v0", "liquidity_sweep_reversal_v0"] as const;

type PromotionRecordSummary = {
  id?: string;
  state?: string;
  stateVersion?: number;
  requestedAt?: string | null;
};

function parseJsonField(
  raw: string,
  label: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: `${label} must not be empty.` };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, message: `${label} must be valid JSON.` };
  }
}

async function readJsonFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read file."));
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

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
  const [evidenceJson, setEvidenceJson] = React.useState("");
  const [inputsJson, setInputsJson] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState("");
  const [requestLoading, setRequestLoading] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = React.useState<string | null>(null);

  const pendingRecord = (readState?.pending ?? null) as PromotionRecordSummary | null;
  const hasBlockingPending = Boolean(pendingRecord?.id);

  const loadReadState = React.useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setReadLoading(true);
    setReadError(null);

    const stateResult = await adminFetch<Record<string, unknown>>(
      `/api/trader/admin/strategy-promotions?organization_id=${encodeURIComponent(organizationId)}&strategy_id=${encodeURIComponent(strategyId)}`,
    );
    if (!stateResult.ok) {
      setReadError(stateResult.message);
      setReadState(null);
      setPreviewState(null);
      setReadLoading(false);
      return;
    }
    setReadState(stateResult.data);

    const effective = (stateResult.data.effective ?? null) as PromotionRecordSummary | null;
    const pending = (stateResult.data.pending ?? null) as PromotionRecordSummary | null;
    const activeRecord = effective?.id ? effective : pending;

    if (activeRecord?.id) {
      setRecordId(activeRecord.id);
      if (activeRecord.stateVersion !== undefined) {
        setExpectedVersion(String(activeRecord.stateVersion));
      }
      const previewResult = await adminFetch<Record<string, unknown>>(
        `/api/trader/admin/strategy-promotions?organization_id=${encodeURIComponent(organizationId)}&record_id=${encodeURIComponent(activeRecord.id)}&view=preview`,
      );
      setPreviewState(previewResult.ok ? previewResult.data : null);
    } else {
      setPreviewState(null);
    }

    setReadLoading(false);
  }, [organizationId, strategyId]);

  React.useEffect(() => {
    if (!organizationId) {
      return;
    }
    const handle = window.setTimeout(() => {
      void loadReadState();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [organizationId, strategyId, loadReadState]);

  async function submitRequest() {
    if (!organizationId || hasBlockingPending) {
      return;
    }
    setRequestError(null);
    setRequestSuccess(null);

    const evidenceParsed = parseJsonField(evidenceJson, "Evidence JSON");
    if (!evidenceParsed.ok) {
      setRequestError(evidenceParsed.message);
      return;
    }
    const inputsParsed = parseJsonField(inputsJson, "Operator inputs JSON");
    if (!inputsParsed.ok) {
      setRequestError(inputsParsed.message);
      return;
    }

    setRequestLoading(true);
    const response = await adminFetch<{ record?: PromotionRecordSummary }>(
      "/api/trader/admin/strategy-promotions/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "request",
          organization_id: organizationId,
          strategy_id: strategyId,
          evidence: evidenceParsed.value,
          inputs: inputsParsed.value,
          idempotency_key: idempotencyKey.trim() || undefined,
        }),
      },
    );
    setRequestLoading(false);

    if (!response.ok) {
      setRequestError(response.message);
      return;
    }

    const record = response.data.record;
    if (record?.id) {
      setRecordId(record.id);
    }
    if (record?.stateVersion !== undefined) {
      setExpectedVersion(String(record.stateVersion));
    }
    setRequestSuccess(
      record?.id
        ? `Request succeeded — record ${record.id} (${record.state ?? "unknown state"}).`
        : "Request succeeded.",
    );
    await loadReadState();
  }

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

  async function handleJsonFileLoad(
    event: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await readJsonFile(file);
      setter(text);
      setRequestError(null);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Failed to read file.");
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

      <WaiaSurface variant="raised" className="space-y-4 p-4">
        <h2 className="text-lg font-medium">Request promotion</h2>
        <p className="text-muted-foreground text-sm">
          Submit paper evaluation evidence and operator inputs to originate a governed promotion
          Request. Validation is fail-closed on the server; malformed input is rejected before POST.
        </p>

        {hasBlockingPending ? (
          <p className="text-muted-foreground text-sm">
            Pending promotion in flight ({pendingRecord?.state ?? "unknown"}) — complete Confirm →
            Cooling-off → Effective, or Cancel before submitting a new Request.
          </p>
        ) : null}

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Evidence JSON</span>
          <Textarea
            value={evidenceJson}
            onChange={(event) => setEvidenceJson(event.target.value)}
            rows={8}
            className="font-mono text-xs"
            placeholder="Paste paper evaluation export JSON (evidence.json)"
          />
          <input
            type="file"
            accept=".json,application/json"
            className="text-muted-foreground text-xs"
            onChange={(event) => void handleJsonFileLoad(event, setEvidenceJson)}
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Operator inputs JSON</span>
          <Textarea
            value={inputsJson}
            onChange={(event) => setInputsJson(event.target.value)}
            rows={8}
            className="font-mono text-xs"
            placeholder="Paste operator promotion inputs JSON (inputs.json)"
          />
          <input
            type="file"
            accept=".json,application/json"
            className="text-muted-foreground text-xs"
            onChange={(event) => void handleJsonFileLoad(event, setInputsJson)}
          />
        </label>

        <label className="block max-w-md space-y-1 text-sm">
          <span className="font-medium">Idempotency key (optional)</span>
          <Input
            value={idempotencyKey}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            placeholder="UUID"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={!organizationId || hasBlockingPending || requestLoading}
            onClick={() => void submitRequest()}
          >
            {requestLoading ? "Submitting…" : "Request"}
          </Button>
        </div>

        {requestError ? <p className="text-destructive text-sm">{requestError}</p> : null}
        {requestSuccess ? <p className="text-muted-foreground text-sm">{requestSuccess}</p> : null}
      </WaiaSurface>

      <ReadReviewActionShell
        title="Strategy promotions"
        loading={readLoading}
        error={readError}
        onReload={() => void loadReadState()}
        readContent={
          <div className="space-y-3">
            {pendingRecord?.id ? (
              <div className="border-border bg-muted/20 rounded-md border p-3 text-xs">
                <p className="font-medium">Pending promotion</p>
                <p>Record: {pendingRecord.id}</p>
                <p>State: {pendingRecord.state ?? "unknown"}</p>
                <p>State version: {pendingRecord.stateVersion ?? "unknown"}</p>
                {pendingRecord.requestedAt ? (
                  <p>Requested at: {pendingRecord.requestedAt}</p>
                ) : null}
              </div>
            ) : null}
            <pre className="bg-muted/30 overflow-x-auto rounded-md p-3 text-xs">
              {readState ? JSON.stringify(readState, null, 2) : "No data"}
            </pre>
          </div>
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
