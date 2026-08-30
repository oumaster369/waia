import { describe, expect, it } from "vitest";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { buildAdminAccountRows, connectionState, parseFiniteDecimal, sumKnownAccountEquity } from "@/lib/trader/fhv-admin-stream-view-model";

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
    expect(rows[0]).toMatchObject({ id: "run-1", pnl24h: null, direction24h: "unavailable" });
    expect(sumKnownAccountEquity(rows)).toBeNull();
  });

  it("parses only finite decimal telemetry", () => {
    expect(parseFiniteDecimal("123.45")).toBe(123.45);
    expect(parseFiniteDecimal(null)).toBeNull();
    expect(parseFiniteDecimal("Infinity")).toBeNull();
  });
});
