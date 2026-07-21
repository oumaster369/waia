"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { FhvOperationsDashboard } from "@/components/trader/admin/fhv-operations-dashboard";
import {
  AdminErrorState,
  AdminLoadingState,
  AdminOrgSelector,
  useAdminOrganizations,
} from "@/components/trader/admin/admin-org-selector";
import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import {
  buildFhvAdminCommandPath,
  buildFhvAdminStatusPath,
  FHV_CAMPAIGN_RUN_ID_MAX_LENGTH,
  FHV_CAMPAIGN_RUN_ID_PATTERN,
} from "@/lib/trader/fhv-campaign-run-id";
import { buildRequiredConfirmationPhrase } from "@/lib/trader/observability/fhv-command-confirmation";
import { FHV_ADMIN_CSRF_HEADER, FHV_ADMIN_CSRF_COOKIE } from "@/lib/trader/fhv-admin-csrf";

const APPROVED_ACTIONS = [
  "PAUSE_AT_CHECKPOINT",
  "RESUME_FROM_CHECKPOINT",
  "GRACEFUL_STOP",
  "EMERGENCY_STOP",
  "CREATE_DIAGNOSTIC_BUNDLE",
] as const;

type CommandCapabilities = Readonly<{
  commandContractFailClosed: boolean;
  commandsActuallyEnforced: boolean;
  supervisorExecutorImplemented: boolean;
  supervisorQualificationRequired: boolean;
}>;

const DEFAULT_CAPABILITIES: CommandCapabilities = {
  commandContractFailClosed: true,
  commandsActuallyEnforced: false,
  supervisorExecutorImplemented: true,
  supervisorQualificationRequired: true,
};

function validateRunIdInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Campaign run ID is required.";
  }
  if (trimmed.length > FHV_CAMPAIGN_RUN_ID_MAX_LENGTH) {
    return "Campaign run ID is too long.";
  }
  if (!FHV_CAMPAIGN_RUN_ID_PATTERN.test(trimmed)) {
    return "Campaign run ID format is invalid.";
  }
  return null;
}

export default function FhvOperationsAdminPage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("");
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [campaignRunId, setCampaignRunId] = React.useState(
    () => searchParams.get("campaign_run_id")?.trim() ?? "",
  );
  const [status, setStatus] = React.useState<Record<string, unknown> | null>(null);
  const [capabilities, setCapabilities] = React.useState<CommandCapabilities>(DEFAULT_CAPABILITIES);
  const [csrfToken, setCsrfToken] = React.useState("");
  const [confirmationInput, setConfirmationInput] = React.useState("");
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [pageLoading, setPageLoading] = React.useState(false);
  const [showRawJson, setShowRawJson] = React.useState(false);
  const [action, setAction] =
    React.useState<(typeof APPROVED_ACTIONS)[number]>("PAUSE_AT_CHECKPOINT");
  const [reason, setReason] = React.useState("Operator-requested campaign control");

  const runValidationError = validateRunIdInput(campaignRunId);
  const trimmedRunId = campaignRunId.trim();
  const requiredConfirmationPhrase =
    !runValidationError && trimmedRunId
      ? buildRequiredConfirmationPhrase(trimmedRunId, action)
      : "";
  const confirmationMatches =
    requiredConfirmationPhrase.length > 0 && confirmationInput === requiredConfirmationPhrase;
  const commandsAvailable =
    capabilities.commandsActuallyEnforced && capabilities.supervisorExecutorImplemented;

  const clearLoadedState = React.useCallback(() => {
    setStatus(null);
    setCsrfToken("");
    setPageError(null);
    setConfirmationInput("");
  }, []);

  const handleOrganizationChange = React.useCallback(
    (value: string) => {
      setSelectedOrganizationId(value);
      clearLoadedState();
    },
    [clearLoadedState],
  );

  const handleRunIdChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCampaignRunId(event.target.value);
      clearLoadedState();
    },
    [clearLoadedState],
  );

  const handleActionChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setAction(event.target.value as (typeof APPROVED_ACTIONS)[number]);
    setConfirmationInput("");
  }, []);

  const loadStatus = React.useCallback(async () => {
    if (!organizationId) return;
    const validationError = validateRunIdInput(campaignRunId);
    if (validationError) {
      setPageError(validationError);
      return;
    }
    setPageLoading(true);
    setPageError(null);
    const path = buildFhvAdminStatusPath(organizationId, trimmedRunId);
    const response = await fetch(path, { cache: "no-store", credentials: "include" });
    const body = (await response.json()) as {
      status?: Record<string, unknown>;
      capabilities?: CommandCapabilities;
      error?: { message?: string };
    };
    if (!response.ok) {
      setPageError(body.error?.message ?? "Request failed.");
      setStatus(null);
      setCsrfToken("");
    } else {
      const returnedStatus = body.status ?? null;
      const returnedRunId =
        returnedStatus &&
        typeof returnedStatus.campaign === "object" &&
        returnedStatus.campaign &&
        "runId" in (returnedStatus.campaign as object)
          ? (returnedStatus.campaign as { runId: string }).runId
          : null;
      if (returnedRunId && returnedRunId !== trimmedRunId) {
        setPageError("Returned status run ID does not match selection.");
        setStatus(null);
        setCsrfToken("");
      } else {
        setStatus(returnedStatus);
        setCapabilities(body.capabilities ?? DEFAULT_CAPABILITIES);
        setCsrfToken(response.headers.get(FHV_ADMIN_CSRF_HEADER) ?? "");
      }
    }
    setPageLoading(false);
  }, [organizationId, campaignRunId, trimmedRunId]);

  const submitCommand = React.useCallback(async () => {
    if (!organizationId || !csrfToken || runValidationError || !confirmationMatches) return;
    setPageLoading(true);
    setPageError(null);
    const path = buildFhvAdminCommandPath(organizationId, trimmedRunId);
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [FHV_ADMIN_CSRF_HEADER]: csrfToken,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        campaign_run_id: trimmedRunId,
        action,
        reason,
        confirmation_phrase: confirmationInput,
        expected_phase:
          typeof status?.campaign === "object" &&
          status.campaign &&
          "phase" in (status.campaign as object)
            ? (status.campaign as { phase: string }).phase
            : "validation",
      }),
    });
    const body = (await response.json()) as { error?: { message?: string } };
    setConfirmationInput("");
    if (!response.ok) {
      setPageError(body.error?.message ?? "Command failed.");
    } else {
      await loadStatus();
    }
    setPageLoading(false);
  }, [
    organizationId,
    csrfToken,
    action,
    reason,
    status,
    loadStatus,
    trimmedRunId,
    runValidationError,
    confirmationMatches,
    confirmationInput,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">FHV Operations</h1>
      {loading ? <AdminLoadingState label="Loading organizations…" /> : null}
      {error ? <AdminErrorState message={error} /> : null}
      {!loading && !error ? (
        <AdminOrgSelector
          organizations={organizations}
          value={organizationId}
          onChange={handleOrganizationChange}
        />
      ) : null}

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <h2 className="text-lg font-medium">Campaign selection</h2>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Campaign run ID</span>
          <input
            data-testid="fhv-campaign-run-id"
            className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono text-sm"
            value={campaignRunId}
            onChange={handleRunIdChange}
            maxLength={FHV_CAMPAIGN_RUN_ID_MAX_LENGTH}
            placeholder="dee-416-rehearsal-run"
          />
        </label>
        {runValidationError ? <AdminErrorState message={runValidationError} /> : null}
        <p className="text-muted-foreground text-xs">
          Selected org: <span className="font-mono">{organizationId || "—"}</span> · run:{" "}
          <span className="font-mono">{trimmedRunId || "—"}</span>
        </p>
      </WaiaSurface>

      <WaiaSurface variant="raised" className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Campaign status</h2>
          <Button
            type="button"
            variant="outline"
            data-testid="fhv-refresh-status"
            onClick={() => void loadStatus()}
            disabled={Boolean(runValidationError)}
          >
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
        {!commandsAvailable ? (
          <p className="text-muted-foreground text-sm" data-testid="fhv-executor-unavailable">
            Control executor unavailable — supervisor qualification required (T4). Commands are
            disabled until HOST_OS rehearsal completes.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          CSRF cookie ({FHV_ADMIN_CSRF_COOKIE}) is set by the server; only the matching header is
          sent from JavaScript.
        </p>
        <select
          data-testid="fhv-action-select"
          className="border-border bg-background w-full max-w-md rounded-md border px-3 py-2 text-sm"
          value={action}
          onChange={handleActionChange}
          disabled={!commandsAvailable}
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
          disabled={!commandsAvailable}
        />
        {requiredConfirmationPhrase ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="fhv-required-confirmation-phrase"
          >
            Type exactly: <span className="font-mono">{requiredConfirmationPhrase}</span>
          </p>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Confirmation phrase</span>
          <input
            data-testid="fhv-confirmation-input"
            className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono text-sm"
            value={confirmationInput}
            onChange={(event) => setConfirmationInput(event.target.value)}
            disabled={!commandsAvailable}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <Button
          type="button"
          data-testid="fhv-submit-command"
          onClick={() => void submitCommand()}
          disabled={
            !csrfToken || Boolean(runValidationError) || !commandsAvailable || !confirmationMatches
          }
        >
          Submit signed command
        </Button>
      </WaiaSurface>
    </div>
  );
}
