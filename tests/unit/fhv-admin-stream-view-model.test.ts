import { describe, expect, it } from "vitest";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { buildAdminAccountRows, connectionState, parseFiniteDecimal, reduceAdminAccountEvent, sumKnownAccountEquity, sumKnownAccountMetric } from "@/lib/trader/fhv-admin-stream-view-model";

describe("DEE-785 FHV admin stream view model", () => {
  it("classifies connection freshness and failures fail visibly", () => {
    const now = Date.parse("2026-08-30T12:00:00.000Z");
    expect(connectionState({ hasStatus: false, requestPending: true, consecutiveFailures: 0, observedAt: null, nowMs: now })).toBe("connecting");
    expect(connectionState({ hasStatus: true, requestPending: false, consecutiveFailures: 0, observedAt: "2026-08-30T11:59:55.000Z", nowMs: now })).toBe("live");
    expect(connectionState({ hasStatus: true, requestPending: false, consecutiveFailures: 0, observedAt: "2026-08-30T11:59:00.000Z", nowMs: now })).toBe("stale");
    expect(connectionState({ hasStatus: true, requestPending: false, consecutiveFailures: 1, observedAt: "2026-08-30T11:59:55.000Z", nowMs: now })).toBe("reconnecting");
  });

  it("never fabricates tenant accounts or a 24h baseline", () => {
    const status = buildFhvOperatorStatusV1({ organizationId: "00000000-0000-4000-8000-0000000416a1", runId: "run-1", phase: "validation", codeSha: "sha", artifactDigest: "artifact", datasetSeal: "seal", datasetDigest: "digest", configurationDigest: "config" });
    const rows = buildAdminAccountRows(status);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "historical:00000000-0000-4000-8000-0000000416a1", pnl24h: null, direction24h: "unavailable" });
    expect(sumKnownAccountEquity(rows)).toBeNull();
  });

  it("retains and truthfully aggregates multiple historical virtual accounts", () => {
    const base = { schemaVersion: "fhv-realtime-event/v1" as const, kind: "account.balance" as const, organizationId: "org", campaignRunId: "run", source: "HISTORICAL_SIMULATION" as const };
    const first = reduceAdminAccountEvent([], { ...base, payload: { accountId: "historical:a", accountKind: "HISTORICAL_VIRTUAL", cash: "100", equity: "110", netPnl: "10", delta24h: null, openPositionsCount: 1 } });
    const second = reduceAdminAccountEvent(first, { ...base, payload: { accountId: "historical:b", accountKind: "HISTORICAL_VIRTUAL", cash: "200", equity: "180", netPnl: "-20", delta24h: "-5", openPositionsCount: 2 } });
    expect(second).toHaveLength(2);
    expect(sumKnownAccountMetric(second, "cash")).toBe(300);
    expect(sumKnownAccountMetric(second, "equity")).toBe(290);
    expect(sumKnownAccountMetric(second, "pnl")).toBe(-10);
    expect(sumKnownAccountMetric(second, "pnl24h")).toBeNull();
    expect(second[0]).toMatchObject({ pnl24h: null, direction24h: "unavailable" });
    expect(second[1]).toMatchObject({ pnl24h: "-5", direction24h: "down" });
  });

  it("rejects non-historical or non-virtual account events", () => {
    const event = { schemaVersion: "fhv-realtime-event/v1" as const, kind: "account.balance" as const, organizationId: "org", campaignRunId: "run", source: "HISTORICAL_SIMULATION" as const, payload: { accountId: "exchange:a", accountKind: "EXCHANGE", equity: "999" } };
    expect(reduceAdminAccountEvent([], event)).toEqual([]);
  });

  it("parses only finite decimal telemetry", () => {
    expect(parseFiniteDecimal("123.45")).toBe(123.45);
    expect(parseFiniteDecimal(null)).toBeNull();
    expect(parseFiniteDecimal("Infinity")).toBeNull();
  });
});
