"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { FhvOperationsDashboard, type FhvChartSample } from "@/components/trader/admin/fhv-operations-dashboard";
import { AdminErrorState, AdminLoadingState, AdminOrgSelector, useAdminOrganizations } from "@/components/trader/admin/admin-org-selector";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { buildFhvAdminStatusPath, FHV_CAMPAIGN_RUN_ID_MAX_LENGTH, FHV_CAMPAIGN_RUN_ID_PATTERN } from "@/lib/trader/fhv-campaign-run-id";
import { buildAdminAccountRows, connectionState, parseFiniteDecimal, parseFhvStatus, reduceAdminAccountEvent, type FhvAdminAccountEvent, type FhvAdminAccountRow } from "@/lib/trader/fhv-admin-stream-view-model";

const LIVE_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 15_000;
const MAX_SAMPLES = 180;
const REALTIME_EVENT_KINDS = ["campaign.progress", "account.balance", "position.snapshot", "trade.snapshot", "decision.snapshot", "checkpoint", "risk", "gate", "error"] as const;

function validateRunId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Campaign run ID is required.";
  if (trimmed.length > FHV_CAMPAIGN_RUN_ID_MAX_LENGTH) return "Campaign run ID is too long.";
  return FHV_CAMPAIGN_RUN_ID_PATTERN.test(trimmed) ? null : "Campaign run ID format is invalid.";
}

function chartSample(status: Record<string, unknown>, at: number): FhvChartSample | null {
  const parsed = parseFhvStatus(status);
  if (!parsed) return null;
  return {
    at,
    equity: parseFiniteDecimal(parsed.tradingSimulation.equity),
    netPnl: parseFiniteDecimal(parsed.tradingSimulation.netPnl),
    drawdownBps: parsed.tradingSimulation.accountDrawdownBps,
    throughput: parsed.campaign.throughputRolling,
  };
}

export default function FhvOperationsAdminPage() {
  const searchParams = useSearchParams();
  const { organizations, loading, error } = useAdminOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("");
  const organizationId = selectedOrganizationId || organizations[0]?.id || "";
  const [campaignRunId, setCampaignRunId] = React.useState(() => searchParams.get("campaign_run_id")?.trim() ?? "");
  const [status, setStatus] = React.useState<Record<string, unknown> | null>(null);
  const [samples, setSamples] = React.useState<readonly FhvChartSample[]>([]);
  const [accountRows, setAccountRows] = React.useState<readonly FhvAdminAccountRow[]>([]);
  const [requestPending, setRequestPending] = React.useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = React.useState(0);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = React.useState<number | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const requestSequence = React.useRef(0);
  const trimmedRunId = campaignRunId.trim();
  const runError = validateRunId(campaignRunId);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const resetStream = React.useCallback(() => {
    setStatus(null);
    setSamples([]);
    setAccountRows([]);
    setPageError(null);
    setConsecutiveFailures(0);
    setLastReceivedAt(null);
    requestSequence.current += 1;
  }, []);

  const handleOrganizationChange = React.useCallback((value: string) => {
    setSelectedOrganizationId(value);
    resetStream();
  }, [resetStream]);

  const handleRunIdChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCampaignRunId(event.target.value);
    resetStream();
  }, [resetStream]);

  React.useEffect(() => {
    if (!organizationId || runError) return;
    let disposed = false;
    let timer: number | null = null;
    let source: EventSource | null = null;
    const sequence = requestSequence.current;

    const refreshSnapshot = async () => {
      if (disposed || document.visibilityState === "hidden") return false;
      setRequestPending(true);
      try {
        const response = await fetch(buildFhvAdminStatusPath(organizationId, trimmedRunId), {
          cache: "no-store",
          credentials: "include",
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json()) as { status?: Record<string, unknown>; error?: { message?: string } };
        if (!response.ok || !body.status) throw new Error(body.error?.message ?? "Observer stream unavailable.");
        const parsed = parseFhvStatus(body.status);
        if (!parsed || parsed.campaign.runId !== trimmedRunId || parsed.campaign.organizationId !== organizationId) throw new Error("Observer identity does not match the selected campaign.");
        if (disposed || sequence !== requestSequence.current) return;
        const receivedAt = Date.now();
        setStatus(body.status);
        setAccountRows((current) => current.length > 0 ? current : buildAdminAccountRows(parsed));
        setLastReceivedAt(receivedAt);
        setNowMs(receivedAt);
        setConsecutiveFailures(0);
        setPageError(null);
        const sample = chartSample(body.status, receivedAt);
        if (sample) setSamples((current) => [...current, sample].slice(-MAX_SAMPLES));
        return true;
      } catch (pollError) {
        if (disposed || sequence !== requestSequence.current) return;
        setConsecutiveFailures((current) => {
          const next = current + 1;
          if (!source) timer = window.setTimeout(fallbackPoll, Math.min(MAX_BACKOFF_MS, LIVE_INTERVAL_MS * 2 ** Math.min(next, 3)));
          return next;
        });
        setPageError(pollError instanceof Error ? pollError.message : "Observer stream unavailable.");
        return false;
      } finally {
        if (!disposed && sequence === requestSequence.current) setRequestPending(false);
      }
    };

    const fallbackPoll = async () => {
      await refreshSnapshot();
      if (!disposed && !source) timer = window.setTimeout(fallbackPoll, LIVE_INTERVAL_MS);
    };

    const scheduleSnapshot = (raw?: Event) => {
      if (raw instanceof MessageEvent && raw.type === "account.balance") {
        try {
          const event = JSON.parse(raw.data as string) as FhvAdminAccountEvent;
          if (event.organizationId === organizationId && event.campaignRunId === trimmedRunId) {
            setAccountRows((current) => reduceAdminAccountEvent(current, event));
          }
        } catch {
          setPageError("An invalid account stream event was rejected.");
        }
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshSnapshot(), 50);
    };

    void refreshSnapshot();
    if (typeof EventSource === "function") {
      const streamPath = `/api/trader/admin/fhv-operations/stream?organization_id=${encodeURIComponent(organizationId)}&campaign_run_id=${encodeURIComponent(trimmedRunId)}`;
      source = new EventSource(streamPath, { withCredentials: true });
      source.onopen = () => { if (!disposed) { setConsecutiveFailures(0); setPageError(null); } };
      source.onerror = () => { if (!disposed) { setConsecutiveFailures((current) => current + 1); setPageError("Realtime stream interrupted. Reconnecting automatically…"); } };
      for (const kind of REALTIME_EVENT_KINDS) source.addEventListener(kind, scheduleSnapshot);
    } else {
      timer = window.setTimeout(fallbackPoll, LIVE_INTERVAL_MS);
    }
    const resume = () => { if (document.visibilityState === "visible") scheduleSnapshot(); };
    document.addEventListener("visibilitychange", resume);
    return () => { disposed = true; source?.close(); if (timer !== null) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [organizationId, trimmedRunId, runError]);

  const observedAt = status && parseFhvStatus(status)?.observedAt || null;
  const streamState = connectionState({ hasStatus: Boolean(status), requestPending, consecutiveFailures, observedAt, nowMs });

  return <div className="space-y-5">
    <WaiaSurface variant="raised" className="space-y-4 p-5">
      <div><h1 className="text-lg font-semibold">Observation target</h1><p className="text-muted-foreground mt-1 text-sm">The console connects automatically and keeps itself current. No refresh or sync action is required.</p></div>
      {loading ? <AdminLoadingState label="Loading organizations…" /> : null}
      {error ? <AdminErrorState message={error} /> : null}
      {!loading && !error ? <AdminOrgSelector organizations={organizations} value={organizationId} onChange={handleOrganizationChange} /> : null}
      <label className="block space-y-1 text-sm"><span className="font-medium">Campaign run ID</span><input data-testid="fhv-campaign-run-id" className="border-border bg-background w-full max-w-xl rounded-md border px-3 py-2 font-mono text-sm" value={campaignRunId} onChange={handleRunIdChange} maxLength={FHV_CAMPAIGN_RUN_ID_MAX_LENGTH} placeholder="campaign-run-id" /></label>
      {runError ? <AdminErrorState message={runError} /> : null}
    </WaiaSurface>
    {pageError && !status ? <AdminErrorState message={`${pageError} Reconnecting automatically…`} /> : null}
    {status ? <FhvOperationsDashboard status={status} connectionState={streamState} lastReceivedAt={lastReceivedAt} samples={samples} accountRows={accountRows} /> : !runError && organizationId ? <AdminLoadingState label="Connecting to the historical-test observer…" /> : null}
  </div>;
}
