import { describe, expect, it } from "vitest";
import { EMPTY_USER_STREAM_VIEW, reduceFhvUserStreamEvent } from "@/components/trader/fhv-user-observation-dashboard";

const base = { schemaVersion: "fhv-realtime-event/v1" as const, eventId: "e1", observedAt: "2026-08-30T12:00:00Z", organizationId: "tenant-a", campaignRunId: "run-a", source: "HISTORICAL_SIMULATION" as const };
describe("DEE-785 user realtime projection", () => {
  it("accumulates the canonical typed stream without manual sync", () => {
    const balance = reduceFhvUserStreamEvent(EMPTY_USER_STREAM_VIEW, { ...base, kind: "account.balance", payload: { cash: "9000", equity: "10100", netPnl: "100", delta24h: null } });
    const trades = reduceFhvUserStreamEvent(balance, { ...base, eventId: "e2", kind: "trade.snapshot", payload: { recentFills: [{ id: "fill-1", label: "BUY" }], recentOrders: [{ id: "order-1", label: "BUY LIMIT" }] } });
    expect(trades.balance).toMatchObject({ equity: "10100", delta24h: null });
    expect(trades.trades).toHaveLength(1);
    expect(trades.orders).toHaveLength(1);
  });
  it("rejects non-historical sources", () => {
    const malicious = { ...base, source: "LIVE" as never, kind: "account.balance" as const, payload: { equity: "leak" } };
    expect(reduceFhvUserStreamEvent(EMPTY_USER_STREAM_VIEW, malicious)).toBe(EMPTY_USER_STREAM_VIEW);
  });
});
