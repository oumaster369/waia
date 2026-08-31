import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_USER_STREAM_VIEW, FhvUserObservationDashboard, reduceFhvUserStreamEvent } from "@/components/trader/fhv-user-observation-dashboard";

const { mockSearchParams } = vi.hoisted(() => ({ mockSearchParams: new URLSearchParams("campaign_run_id=run-a") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); mockSearchParams.set("campaign_run_id", "run-a"); });

const base = { schemaVersion: "fhv-realtime-event/v1" as const, eventId: "e1", observedAt: "2026-08-30T12:00:00Z", organizationId: "tenant-a", campaignRunId: "run-a", source: "HISTORICAL_SIMULATION" as const };
describe("DEE-785 user realtime projection", () => {
  it("accumulates the canonical typed stream without manual sync", () => {
    const balance = reduceFhvUserStreamEvent(EMPTY_USER_STREAM_VIEW, { ...base, kind: "account.balance", payload: { cash: "9000", equity: "10100", netPnl: "100", delta24h: null } });
    const trades = reduceFhvUserStreamEvent(balance, { ...base, eventId: "e2", kind: "trade.snapshot", payload: { fillsCount: 174, ordersCount: 120, recentFills: [{ id: "fill-1", label: "BUY" }], recentOrders: [{ id: "order-1", label: "BUY LIMIT" }] } });
    expect(trades.balance).toMatchObject({ equity: "10100", delta24h: null });
    expect(trades.trades).toHaveLength(1);
    expect(trades.orders).toHaveLength(1);
    expect(trades.tradeCounts).toEqual({ fills: 174, orders: 120 });
  });
  it("rejects non-historical sources", () => {
    const malicious = { ...base, source: "LIVE" as never, kind: "account.balance" as const, payload: { equity: "leak" } };
    expect(reduceFhvUserStreamEvent(EMPTY_USER_STREAM_VIEW, malicious)).toBe(EMPTY_USER_STREAM_VIEW);
  });

  it("resets data, connection, and errors when campaign_run_id changes", () => {
    const instances: Array<{ listeners: Map<string, (event: Event) => void>; close: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onerror: (() => void) | null }> = [];
    vi.stubGlobal("EventSource", vi.fn(() => {
      const instance = { listeners: new Map<string, (event: Event) => void>(), close: vi.fn(), onopen: null, onerror: null };
      Object.assign(instance, { addEventListener: (kind: string, listener: (event: Event) => void) => instance.listeners.set(kind, listener), removeEventListener: vi.fn() });
      instances.push(instance);
      return instance;
    }));
    const view = render(React.createElement(FhvUserObservationDashboard));
    act(() => {
      instances[0].listeners.get("account.balance")?.(new MessageEvent("account.balance", { data: JSON.stringify({ ...base, payload: { cash: "100", equity: "110", netPnl: "10" }, kind: "account.balance" }) }));
      (instances[0].onerror as (() => void) | null)?.();
    });
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText(/Connection interrupted/)).toBeInTheDocument();
    mockSearchParams.set("campaign_run_id", "run-b");
    view.rerender(React.createElement(FhvUserObservationDashboard));
    expect(instances[0].close).toHaveBeenCalled();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
    expect(screen.queryByText(/Connection interrupted/)).not.toBeInTheDocument();
    expect(screen.getByText("run-b")).toBeInTheDocument();
  });
});
