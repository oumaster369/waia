import { describe, expect, it, vi } from "vitest";
import { serveHistoricalObservableV2 } from "@/lib/trader/historical-simulation-v2/observable-http-v2";
import { createHistoricalObservablePollingStreamV2 } from "@/lib/trader/historical-simulation-v2/observable-stream-v2";
import type { HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

const projection = (eventId: string): HistoricalObservableProjectionV2 => ({
  schemaVersion: "waia.trader.historical_observable_read_model.v2", mode: "HISTORICAL_SIMULATION",
  capitalEligible: false, organizationId: "org", runId: "run", eventId, observedAt: "2026-01-01T00:00:00.000Z",
  lifecycle: null, accounts: [], aggregate: { accountCount: 0, equity: null, cash: null, netPnl: null,
    buyAndHoldGrossEquity: null, strategyMinusBuyAndHoldGross: null,
    cycles: 0, decisions: 0, riskVetoes: 0, orders: 0, fills: 0,
    processedRecords: 0, latestCycleSequence: null, qualifiedTotalCycles: null,
    committedCycles: 0, progressBps: null, runPhase: null },
});

describe("historical observable transport v2", () => {
  it("emits resumable named SSE events and suppresses an already delivered head", async () => {
    const abort = new AbortController();
    const stream = createHistoricalObservablePollingStreamV2({ signal: abort.signal,
      lastEventId: "old", load: async () => projection("new"), pollMs: 250 });
    const reader = stream.getReader(); const first = await reader.read(); abort.abort();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("id: new\nevent: historical.snapshot");
    expect(text).toContain('"capitalEligible":false');
    await reader.cancel();
  });

  it("provides a one-shot polling fallback and disposes its database client", async () => {
    const unsafe = vi.fn().mockResolvedValue([]); const dispose = vi.fn().mockResolvedValue(undefined);
    const response = await serveHistoricalObservableV2({
      request: new Request("https://waia.test/api?transport=poll"), sql: { unsafe } as never,
      scope: { organizationId: "org", runId: "run", accountId: "account" }, dispose,
    });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()) as object).toMatchObject({ capitalEligible: false, accounts: [] });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not enqueue after cancellation during an unresolved database read", async () => {
    let release!: (value: HistoricalObservableProjectionV2) => void;
    const pending = new Promise<HistoricalObservableProjectionV2>((resolve) => { release = resolve; });
    const dispose = vi.fn().mockResolvedValue(undefined); const abort = new AbortController();
    const stream = createHistoricalObservablePollingStreamV2({ signal: abort.signal,
      lastEventId: null, load: () => pending, dispose, pollMs: 250 });
    const reader = stream.getReader(); const read = reader.read();
    abort.abort(); release(projection("late"));
    await expect(read).resolves.toMatchObject({ done: true });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("closes and disposes even when an aborted database read never settles", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined); const abort = new AbortController();
    const stream = createHistoricalObservablePollingStreamV2({ signal: abort.signal, lastEventId: null,
      load: () => new Promise<HistoricalObservableProjectionV2>(() => {}), dispose, pollMs: 250 });
    const read=stream.getReader().read(); abort.abort();
    await expect(read).resolves.toMatchObject({done:true});
    expect(dispose).toHaveBeenCalledOnce();
  });
});
