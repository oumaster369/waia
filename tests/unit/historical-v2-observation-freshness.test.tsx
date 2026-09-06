import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHistoricalV2Observation } from "@/components/trader/use-historical-v2-observation";
import { historicalChartRows } from "@/components/trader/historical-v2-account-charts";
import type { HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

const snapshot = (): HistoricalObservableProjectionV2 => ({
  schemaVersion: "waia.trader.historical_observable_read_model.v2", mode: "HISTORICAL_SIMULATION",
  capitalEligible: false, organizationId: "org", runId: "run", eventId: "1",
  observedAt: "2026-09-05T23:00:00.000Z", lifecycle: null, accounts: [],
  aggregate: { accountCount: 0, equity: null, cash: null, netPnl: null,
    buyAndHoldGrossEquity: null, strategyMinusBuyAndHoldGross: null, cycles: 0, decisions: 0,
    riskVetoes: 0, orders: 0, fills: 0, processedRecords: 0, latestCycleSequence: null,
    qualifiedTotalCycles: null, committedCycles: 0, progressBps: null, runPhase: null },
});
function setup() {
  const listeners = new Map<string, (e: MessageEvent<string>) => void>();
  const source = { close: vi.fn(), onerror: null as (() => void) | null,
    addEventListener: vi.fn((name: string, cb: (e: MessageEvent<string>) => void) => listeners.set(name, cb)) };
  vi.stubGlobal("EventSource", vi.fn(() => source));
  const hook = renderHook(() => useHistoricalV2Observation({ endpoint: "/stream", runId: "run", expectedOrganizationId: "org" }));
  const emit = (name: string, body: unknown) => act(() => listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(body) })));
  return { ...hook, source, emit };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Historical V2 honest observation transport", () => {
  it("does not claim contact or a projection merely from creating EventSource", () => {
    const { result } = setup();
    expect(result.current.connected).toBe(false);
    expect(result.current.projection).toBeNull();
    expect(result.current.lastContact).toBeNull();
  });
  it("accepts snapshots and heartbeat contact without inventing committed cycles", () => {
    vi.useFakeTimers(); const { result, emit } = setup();
    emit("historical.snapshot", snapshot());
    const first = result.current.lastContact;
    act(() => vi.advanceTimersByTime(15_000)); emit("heartbeat", {});
    expect(result.current.lastContact).toBeGreaterThan(first!);
    expect(result.current.projection?.aggregate.committedCycles).toBe(0);
    expect(result.current.projection?.lifecycle).toBeNull();
  });
  it("times out a silent stream, closes it and attempts safe polling", async () => {
    vi.useFakeTimers(); const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock); const { result, emit, source } = setup();
    emit("historical.snapshot", snapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.connected).toBe(false);
    expect(result.current.transport).toBe("polling");
    expect(source.close).toHaveBeenCalledTimes(2); // Scheduled renewal, then watchdog fallback.
    expect(fetchMock).toHaveBeenCalledWith("/stream?transport=poll", expect.objectContaining({ cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) }));
  });
  it("keeps last verified values but shows disconnected state on read failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result, emit, source } = setup(); emit("historical.snapshot", snapshot());
    await act(async () => { source.onerror?.(); });
    expect(result.current.projection?.eventId).toBe("1");
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toMatch(/interrupted/);
  });
  it("renews SSE through fresh route authorization without discarding verified data", () => {
    vi.useFakeTimers(); const { result, emit, source } = setup();
    emit("historical.snapshot", snapshot());
    act(() => vi.advanceTimersByTime(25_000));
    expect(EventSource).toHaveBeenCalledTimes(2);
    expect(source.close).toHaveBeenCalledOnce();
    expect(result.current.transport).toBe("SSE");
    expect(result.current.projection?.eventId).toBe("1");
  });
  it.each([401, 403])("clears previously displayed data when fresh admission returns %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    const { result, emit, source } = setup(); emit("historical.snapshot", snapshot());
    await act(async () => source.onerror?.());
    expect(result.current.projection).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toContain("revoked");
  });
  it("ignores retired source snapshots and errors after renewal", () => {
    vi.useFakeTimers();
    const sources: Array<{ listeners: Map<string, (event: MessageEvent<string>) => void>;
      close: ReturnType<typeof vi.fn>; onerror: (() => void) | null;
      addEventListener: (name: string, cb: (event: MessageEvent<string>) => void) => void }> = [];
    vi.stubGlobal("EventSource", vi.fn(() => {
      const listeners = new Map<string, (event: MessageEvent<string>) => void>();
      const source = { listeners, close: vi.fn(), onerror: null as (() => void) | null,
        addEventListener: (name: string, cb: (event: MessageEvent<string>) => void) => { listeners.set(name, cb); } };
      sources.push(source); return source;
    }));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useHistoricalV2Observation({ endpoint: "/stream", runId: "run" }));
    act(() => vi.advanceTimersByTime(25_000));
    expect(sources).toHaveLength(2);
    act(() => {
      sources[0].listeners.get("historical.snapshot")?.(new MessageEvent("historical.snapshot", { data: JSON.stringify(snapshot()) }));
      sources[0].onerror?.();
    });
    expect(result.current.projection).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
    act(() => sources[1].listeners.get("historical.snapshot")?.(new MessageEvent("historical.snapshot", { data: JSON.stringify(snapshot()) })));
    expect(result.current.projection?.eventId).toBe("1");
  });
  it("clears previous data and closes on organization mismatch without fallback", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { result, emit, source } = setup(); emit("historical.snapshot", snapshot());
    emit("historical.snapshot", { ...snapshot(), organizationId: "other" });
    expect(result.current.projection).toBeNull(); expect(result.current.connected).toBe(false);
    expect(result.current.error).toMatch(/identity mismatch/);
    expect(source.close).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("disposes connection and watchdog when unmounted", () => {
    vi.useFakeTimers(); const { source, unmount } = setup(); unmount();
    expect(source.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("recovers through polling after invalid JSON without claiming socket freshness", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (e: MessageEvent<string>) => void>();
    const source = { close: vi.fn(), addEventListener: (name: string, cb: (e: MessageEvent<string>) => void) => listeners.set(name, cb) };
    vi.stubGlobal("EventSource", vi.fn(() => source));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot()))));
    const { result } = renderHook(() => useHistoricalV2Observation({ endpoint: "/stream", runId: "run" }));
    await act(async () => listeners.get("historical.snapshot")?.(new MessageEvent("historical.snapshot", { data: "<!DOCTYPE html>" })));
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(result.current.transport).toBe("polling");
    expect(result.current.connected).toBe(true);
    expect(result.current.projection?.runId).toBe("run");
    expect(result.current.error).toBeNull();
  });
  it("aborts a stuck poll after ten seconds and never overlaps requests", async () => {
    vi.useFakeTimers(); vi.stubGlobal("EventSource", undefined);
    let aborted = false;
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("abort")); });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useHistoricalV2Observation({ endpoint: "/stream", runId: "run" }));
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(aborted).toBe(true); expect(result.current.connected).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("clears a changed scope and ignores the old delayed polling response", async () => {
    vi.stubGlobal("EventSource", undefined);
    const resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve))));
    const { result, rerender } = renderHook(({ runId }) => useHistoricalV2Observation({ endpoint: `/stream?run=${runId}`, runId }), { initialProps: { runId: "run" } });
    rerender({ runId: "next" });
    expect(result.current.projection).toBeNull(); expect(result.current.connected).toBe(false);
    await act(async () => { resolvers[0](new Response(JSON.stringify(snapshot()))); });
    expect(result.current.projection).toBeNull();
    await act(async () => { resolvers[1](new Response(JSON.stringify({ ...snapshot(), runId: "next" }))); });
    expect(result.current.projection?.runId).toBe("next");
    expect(result.current.connected).toBe(true);
  });
});

describe("Committed historical chart rows", () => {
  it("orders actual cycles, preserves missing values and derives observed drawdown only", () => {
    const cycle = (cycleSequence: number, equity: string | null, netPnl: string | null) => ({ cycleSequence, equity, netPnl, replayBarClosedAtUtc: String(cycleSequence) });
    const rows = historicalChartRows([cycle(2, "90", "-10"), cycle(0, "100", "0"), cycle(1, null, null), cycle(3, "110", "10")]);
    expect(rows.map(r => r.sequence)).toEqual([0, 1, 2, 3]);
    expect(rows.map(r => r.drawdown)).toEqual([0, null, 10, 0]);
    expect(rows.map(r => r.pnl)).toEqual([0, null, -10, 10]);
  });
  it("does not fabricate positive-equity peaks or missing chart values", () => {
    const rows = historicalChartRows([{ cycleSequence: 0, equity: "0", netPnl: "", replayBarClosedAtUtc: "0" }]);
    expect(rows[0].drawdown).toBeNull(); expect(rows[0].pnl).toBeNull();
  });
});
