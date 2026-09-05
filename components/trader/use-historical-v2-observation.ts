"use client";
import * as React from "react";
import type { HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

const POLL_MS = 2_000;
const CONTACT_TIMEOUT_MS = 30_000; // UI connectivity watchdog, not a market/risk threshold.
export function useHistoricalV2Observation({ endpoint, runId, accountId, expectedOrganizationId }: {
  endpoint: string; runId: string; accountId?: string; expectedOrganizationId?: string;
}) {
  const [projection, setProjection] = React.useState<HistoricalObservableProjectionV2 | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [transport, setTransport] = React.useState<"SSE" | "polling">("SSE");
  const [lastContact, setLastContact] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(0);
  const scope = JSON.stringify([endpoint, runId, accountId, expectedOrganizationId]);
  const [renderedScope, setRenderedScope] = React.useState(scope);
  // Reset before rendering a changed scope, rather than displaying another run
  // for one frame or resetting from an effect after paint.
  if (renderedScope !== scope) {
    setRenderedScope(scope); setProjection(null); setConnected(false);
    setError(null); setLastContact(null); setTransport("SSE"); setNow(0);
  }
  React.useEffect(() => {
    let stopped = false, refused = false, polling = false, inFlight = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let latestContact = Date.now();
    const touch = () => { latestContact = Date.now(); setLastContact(latestContact); setNow(latestContact); };
    const refuse = (message: string) => {
      refused = true; setProjection(null); setConnected(false); setError(message);
      source?.close(); source = null; controller?.abort();
      if (pollTimer) clearTimeout(pollTimer);
    };
    const accept = (next: HistoricalObservableProjectionV2) => {
      if (stopped || refused) return;
      if (next.runId !== runId || next.mode !== "HISTORICAL_SIMULATION" || next.capitalEligible !== false ||
          !Array.isArray(next.accounts) || !next.aggregate || !Number.isFinite(Date.parse(next.observedAt)) ||
          (expectedOrganizationId !== undefined && next.organizationId !== expectedOrganizationId)) {
        refuse("Historical stream identity mismatch. Connection closed safely."); return;
      }
      if (accountId && (next.accounts.length > 1 || next.accounts.some(a => a.accountId !== accountId))) {
        refuse("Account scope mismatch. Connection closed safely."); return;
      }
      touch(); setProjection(next); setConnected(true); setError(null);
    };
    const poll = async () => {
      if (stopped || refused || inFlight) return;
      inFlight = true; controller = new AbortController();
      const requestTimeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}transport=poll`,
          { cache: "no-store", credentials: "include", signal: controller.signal });
        if (!response.ok) throw new Error("Historical projection unavailable");
        accept(await response.json() as HistoricalObservableProjectionV2);
      } catch {
        if (!stopped && !refused) { setConnected(false); setError("Observation interrupted. Reconnecting automatically…"); }
      } finally {
        clearTimeout(requestTimeout); inFlight = false;
        if (!stopped && !refused && polling) pollTimer = setTimeout(poll, POLL_MS);
      }
    };
    const startPolling = () => {
      if (stopped || refused || polling) return;
      source?.close(); source = null; polling = true; setTransport("polling"); void poll();
    };
    if (typeof EventSource === "function") {
      source = new EventSource(endpoint, { withCredentials: true });
      // Opening a socket alone is not evidence of an observed run or fresh data.
      source.addEventListener("historical.snapshot", raw => {
        try { accept(JSON.parse((raw as MessageEvent<string>).data) as HistoricalObservableProjectionV2); }
        catch { if (!stopped && !refused) { setConnected(false); setError("Invalid historical event rejected."); startPolling(); } }
      });
      source.addEventListener("heartbeat", () => { if (!stopped && !refused) touch(); });
      source.onerror = () => {
        if (stopped || refused) return;
        setConnected(false); setError("Stream interrupted. Polling automatically…"); startPolling();
      };
    } else startPolling();
    const watchdog = setInterval(() => {
      if (stopped || refused) return;
      setNow(Date.now());
      if (Date.now() - latestContact >= CONTACT_TIMEOUT_MS) {
        setConnected(false); setError("No observation contact for 30 seconds. Last values may be stale."); startPolling();
      }
    }, 1_000);
    return () => {
      stopped = true; source?.close(); controller?.abort();
      clearInterval(watchdog); if (pollTimer) clearTimeout(pollTimer);
    };
  }, [endpoint, runId, accountId, expectedOrganizationId]);
  return { projection, connected, error, transport, lastContact, now };
}
