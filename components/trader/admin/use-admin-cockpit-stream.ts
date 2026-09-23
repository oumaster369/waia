"use client";

import * as React from "react";

import { parseCockpitSnapshot, type CockpitSnapshot } from "@/lib/trader/admin/cockpit-client";

const RENEW_MS = 25_000;
const POLL_MS = 2_000;
const OVERFLOW_POLL_MS = 15_000;
const MAX_LIVE_STREAMS = 4;

let liveStreams = 0;

function tryAcquireStream(): boolean {
  if (liveStreams >= MAX_LIVE_STREAMS) return false;
  liveStreams += 1;
  return true;
}

function releaseStream() {
  liveStreams = Math.max(0, liveStreams - 1);
}

function overflowDelayMs(organizationId: string): number {
  let hash = 0;
  for (const char of organizationId) hash = (hash + char.charCodeAt(0)) % 15;
  return hash * 1_000;
}

export function resetCockpitStreamBudget() {
  liveStreams = 0;
}

export type CockpitConnection = "live" | "reconnecting" | "poll";

export function useAdminCockpitStream(
  organizationId: string,
  campaignRunId = "",
): {
  snapshot: CockpitSnapshot | null;
  connection: CockpitConnection;
  lastContactMs: number | null;
} {
  const scope = organizationId.trim();
  const campaign = campaignRunId.trim();
  const scopeKey = campaign ? `${scope}\n${campaign}` : scope;
  const [renderedScope, setRenderedScope] = React.useState(scopeKey);
  const [snapshot, setSnapshot] = React.useState<CockpitSnapshot | null>(null);
  const [connection, setConnection] = React.useState<CockpitConnection>("reconnecting");
  const [lastContactMs, setLastContactMs] = React.useState<number | null>(null);
  if (renderedScope !== scopeKey) {
    setRenderedScope(scopeKey);
    setSnapshot(null);
    setConnection("reconnecting");
    setLastContactMs(null);
  }

  React.useEffect(() => {
    if (!scope) return;
    let stopped = false;
    let polling = false;
    let held = tryAcquireStream();
    const overflow = !held;
    let source: EventSource | null = null;
    let failures = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const params = new URLSearchParams({ organization_id: scope });
    if (campaign) params.set("campaign_run_id", campaign);
    const endpoint = `/api/trader/admin/cockpit/stream?${params.toString()}`;
    const touch = () => setLastContactMs(Date.now());
    const accept = (raw: string) => {
      if (stopped) return;
      const next = parseCockpitSnapshot(raw, scope);
      if (!next) return;
      setSnapshot(next);
      setConnection(polling ? "poll" : "live");
      touch();
      failures = 0;
    };
    const poll = async () => {
      if (stopped || !polling) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`${endpoint}&transport=poll`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (stopped) return;
        if (response.status === 401 || response.status === 403) {
          setSnapshot(null);
          setConnection("poll");
          return;
        }
        if (!response.ok) return;
        accept(JSON.stringify(await response.json()));
      } catch {
        if (!stopped) setConnection("poll");
      } finally {
        if (!stopped && polling) {
          pollTimer = setTimeout(() => void poll(), overflow ? OVERFLOW_POLL_MS : POLL_MS);
        }
      }
    };
    const startPolling = (delayMs = 0) => {
      if (stopped || polling) return;
      polling = true;
      if (held) {
        releaseStream();
        held = false;
      }
      if (renewalTimer) clearTimeout(renewalTimer);
      source?.close();
      source = null;
      setConnection("poll");
      if (delayMs === 0) void poll();
      else pollTimer = setTimeout(() => void poll(), delayMs);
    };
    const openSource = () => {
      if (stopped || polling || typeof EventSource !== "function") {
        if (!polling) startPolling();
        return;
      }
      if (renewalTimer) clearTimeout(renewalTimer);
      source?.close();
      const current = new EventSource(endpoint, { withCredentials: true });
      source = current;
      const mine = () => source === current && !stopped && !polling;
      current.addEventListener("cockpit.snapshot", (event) => {
        if (!mine()) return;
        accept((event as MessageEvent<string>).data);
      });
      current.addEventListener("heartbeat", () => {
        if (!mine()) return;
        setConnection("live");
        touch();
      });
      current.onerror = () => {
        if (!mine()) return;
        failures += 1;
        current.close();
        if (source === current) source = null;
        if (failures >= 2) {
          startPolling();
          return;
        }
        setConnection("reconnecting");
        openSource();
      };
      renewalTimer = setTimeout(openSource, RENEW_MS);
    };
    if (held) openSource();
    else startPolling(overflowDelayMs(scope));
    return () => {
      stopped = true;
      polling = false;
      if (held) releaseStream();
      source?.close();
      controller?.abort();
      if (pollTimer) clearTimeout(pollTimer);
      if (renewalTimer) clearTimeout(renewalTimer);
    };
  }, [scope, campaign]);

  return { snapshot, connection, lastContactMs };
}
