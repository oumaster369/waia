"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { WaiaSurface } from "@/components/waia/waia-surface";

const KINDS = ["campaign.progress", "account.balance", "position.snapshot", "trade.snapshot", "decision.snapshot", "checkpoint", "risk", "gate"] as const;
type Kind = (typeof KINDS)[number];
type RealtimeEvent = { schemaVersion: "fhv-realtime-event/v1"; eventId: string; kind: Kind; observedAt: string; organizationId: string; campaignRunId: string; source: "HISTORICAL_SIMULATION"; payload: Record<string, unknown> };
type Summary = { id?: string; label?: string; atUtc?: string };
export type UserStreamView = { observedAt: string | null; progress: Record<string, unknown>; balance: Record<string, unknown>; positions: readonly Summary[]; trades: readonly Summary[]; orders: readonly Summary[]; decision: Record<string, unknown>; checkpoint: Record<string, unknown>; risk: Record<string, unknown>; gate: Record<string, unknown> };
export const EMPTY_USER_STREAM_VIEW: UserStreamView = { observedAt: null, progress: {}, balance: {}, positions: [], trades: [], orders: [], decision: {}, checkpoint: {}, risk: {}, gate: {} };

function rows(value: unknown): readonly Summary[] { return Array.isArray(value) ? value.filter((v): v is Summary => Boolean(v) && typeof v === "object") : []; }
export function reduceFhvUserStreamEvent(state: UserStreamView, event: RealtimeEvent): UserStreamView {
  if (event.schemaVersion !== "fhv-realtime-event/v1" || event.source !== "HISTORICAL_SIMULATION") return state;
  const base = { ...state, observedAt: event.observedAt };
  switch (event.kind) {
    case "campaign.progress": return { ...base, progress: event.payload };
    case "account.balance": return { ...base, balance: event.payload };
    case "position.snapshot": return { ...base, positions: rows(event.payload.openPositions) };
    case "trade.snapshot": return { ...base, trades: rows(event.payload.recentFills), orders: rows(event.payload.recentOrders) };
    case "decision.snapshot": return { ...base, decision: event.payload };
    case "checkpoint": return { ...base, checkpoint: event.payload };
    case "risk": return { ...base, risk: event.payload };
    case "gate": return { ...base, gate: event.payload };
  }
}
function text(v: unknown) { return typeof v === "string" || typeof v === "number" ? String(v) : "—"; }
function num(v: unknown) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function Metric({ label, value, accent = "" }: { label: string; value: React.ReactNode; accent?: string }) { return <div className="border-border/70 bg-background/40 rounded-xl border p-4"><dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt><dd className={`mt-2 text-2xl font-semibold tabular-nums ${accent}`}>{value}</dd></div>; }
function Feed({ title, items, empty }: { title: string; items: readonly Summary[]; empty: string }) { return <WaiaSurface variant="raised" className="min-h-56 p-5"><h3 className="font-medium">{title}</h3>{items.length === 0 ? <p className="text-muted-foreground mt-6 text-sm">{empty}</p> : <ol className="divide-border mt-3 divide-y">{items.slice(0, 12).map((item, i) => <li key={item.id ?? i} className="flex justify-between gap-4 py-3 text-sm"><span>{item.label ?? "Observed event"}</span><time className="text-muted-foreground shrink-0 text-xs">{item.atUtc ? new Date(item.atUtc).toLocaleTimeString() : "—"}</time></li>)}</ol>}</WaiaSurface>; }

function FhvUserObservationDashboardForRun({ runId }: { runId: string }): React.ReactNode {
  const [view, dispatch] = React.useReducer(reduceFhvUserStreamEvent, EMPTY_USER_STREAM_VIEW);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/trader/research/stream?campaign_run_id=${encodeURIComponent(runId)}`, { withCredentials: true });
    const subscriptions = KINDS.map((kind) => {
      const handler = (raw: Event) => {
        try {
          const event = JSON.parse((raw as MessageEvent<string>).data) as RealtimeEvent;
          if (event.campaignRunId !== runId) { source.close(); setConnected(false); setError("Campaign binding mismatch. Stream closed safely."); return; }
          dispatch(event); setConnected(true); setError(null);
        } catch { setError("An invalid stream event was rejected."); }
      };
      source.addEventListener(kind, handler); return [kind, handler] as const;
    });
    source.onopen = () => setConnected(true);
    source.onerror = () => { setConnected(false); setError("Connection interrupted. Reconnecting automatically…"); };
    return () => { subscriptions.forEach(([kind, handler]) => source.removeEventListener(kind, handler)); source.close(); };
  }, [runId]);
  if (!runId) return <WaiaSurface variant="elevated" className="p-6" data-testid="fhv-stream-awaiting-run"><h2 className="text-xl font-semibold">Historical test stream</h2><p className="text-muted-foreground mt-2 text-sm">Waiting for the campaign link. Streaming starts automatically—no Sync buttons are required.</p></WaiaSurface>;

  const completion = num(view.progress.completionPct) ?? 0;
  const pnl = text(view.balance.netPnl);
  return <section className="space-y-5" data-testid="fhv-user-streaming-dashboard">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-muted-foreground text-xs tracking-wide uppercase">Historical test</p><h2 className="mt-1 text-2xl font-semibold">Live account observation</h2><p className="text-muted-foreground mt-1 font-mono text-xs">{runId}</p></div><div className={`rounded-full border px-3 py-1.5 text-xs font-medium ${connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`} data-testid="fhv-stream-connection"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />{connected ? "LIVE · automatic" : "Reconnecting…"}</div></div>
    {error ? <p className="border-amber-500/30 bg-amber-500/5 text-amber-200 rounded-lg border px-4 py-3 text-sm">{error}</p> : null}
    <WaiaSurface variant="elevated" className="space-y-4 p-5"><div className="flex flex-wrap justify-between gap-3 text-sm"><span>{text(view.progress.phase)} · {text(view.progress.currentSymbol)} · {text(view.progress.partition)}</span><span className="text-muted-foreground tabular-nums">{text(view.progress.barsProcessed)} / {text(view.progress.barsTotal)} bars</span></div><div className="bg-muted h-3 overflow-hidden rounded-full"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} /></div><div className="flex justify-between text-xs"><span>{completion.toFixed(1)}% complete</span><span className="text-muted-foreground">ETA {text(view.progress.etaUtc)}</span></div></WaiaSurface>
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Virtual balance" value={text(view.balance.cash)} /><Metric label="Equity" value={text(view.balance.equity)} /><Metric label="Net P&L" value={pnl} accent={pnl.startsWith("-") ? "text-destructive" : pnl !== "—" ? "text-emerald-400" : ""} /><Metric label="24h change" value={view.balance.delta24h == null ? "Baseline pending" : text(view.balance.delta24h)} /></dl>
    <div className="grid gap-4 lg:grid-cols-3"><Feed title="Open positions" items={view.positions} empty="No open simulated positions." /><Feed title="Recent trades" items={view.trades} empty="No simulated fills yet." /><Feed title="Recent orders" items={view.orders} empty="No simulated orders yet." /></div>
    <div className="grid gap-4 lg:grid-cols-2"><WaiaSurface variant="raised" className="p-5"><h3 className="font-medium">Decision stream</h3><dl className="mt-4 grid gap-3 sm:grid-cols-2"><Metric label="Market regime" value={text(view.decision.regime)} /><Metric label="Conviction" value={text(view.decision.conviction)} /><Metric label="CDE permission" value={text(view.decision.cdePermission)} /><Metric label="Signals accepted / rejected" value={`${text(view.decision.signalsCreated)} / ${text(view.decision.signalsRejected)}`} /></dl></WaiaSurface><WaiaSurface variant="raised" className="p-5"><h3 className="font-medium">Risk & drawdown</h3><dl className="mt-4 grid gap-3 sm:grid-cols-2"><Metric label="Guardian" value={text(view.risk.guardianState)} /><Metric label="Drawdown" value={num(view.risk.accountDrawdownBps) == null ? "—" : `${(num(view.risk.accountDrawdownBps)! / 100).toFixed(2)}%`} /><Metric label="Exposure" value={text(view.balance.exposure)} /><Metric label="Reconciliation" value={text(view.risk.reconciliationState)} /></dl></WaiaSurface></div>
    <div className="border-border bg-muted/10 flex flex-wrap justify-between gap-3 rounded-xl border p-4 text-xs"><span>Heartbeat: {text(view.gate.heartbeatState)}</span><span>Stream lag: {num(view.checkpoint.eventStreamLagMs) == null ? "—" : `${num(view.checkpoint.eventStreamLagMs)} ms`}</span><span>Evidence: {text(view.checkpoint.evidenceHealth)}</span><span className="text-muted-foreground">Last update: {view.observedAt ? new Date(view.observedAt).toLocaleTimeString() : "—"}</span></div>
    <p className="text-muted-foreground text-xs">Read-only historical simulation. No real HTX balance, live trading, capital or administrative controls are exposed.</p>
  </section>;
}

/** The key remount is deliberate: no state, connection error, or last event may cross run IDs. */
export function FhvUserObservationDashboard(): React.ReactNode {
  const runId = useSearchParams().get("campaign_run_id")?.trim() ?? "";
  return <FhvUserObservationDashboardForRun key={runId || "awaiting-campaign"} runId={runId} />;
}
