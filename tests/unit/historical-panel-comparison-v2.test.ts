import { describe, expect, it } from "vitest";
import { compareHistoricalPanelExportsV2 } from "@/lib/trader/historical-simulation-v2/panel-comparison-v2";

const digest = "a".repeat(64);
const expected = { organizationId: "org", runId: "run", accountId: "account", initialRecordIndex: 525600, totalCycles: 2 };
function fixture() {
  const history = [0, 1].map(cycleSequence => ({
    accountId: "account", cycleSequence, cycleId: `cycle-${cycleSequence}`, symbol: "BTCUSDT",
    partition: "WALK_FORWARD", replayBarClosedAtUtc: `2025-01-01T00:0${cycleSequence}:00.000Z`,
    cash: "100.00000000", equity: "101.00000000", netPnl: "1.00000000",
    grossRealizedPnl: "0.00000000", netRealizedPnl: "0.00000000", netUnrealizedPnl: "1.00000000",
    buyAndHoldGrossEquity: "102.00000000", strategyMinusBuyAndHoldGross: "-1.00000000",
    buyAndHoldConvention: "GROSS_MARK_TO_MARKET_NO_FEES", openPositionsCount: 1,
    decisionsCount: cycleSequence + 1, riskVetoCount: 0, ordersCount: 1, fillsCount: 1,
    pendingModeledOrders: [], lastForecast: { confidence: 0.6 }, lastDecision: { reason: "example" },
    lastPortfolio: {}, lastRisk: {}, lastExecution: {}, lastAccounting: { equity: "101.00000000" },
    lastGuardian: {}, lastLearning: {}, observedExecutionEffects: [], modeledRealityArtifacts: [],
    knowledgeArtifacts: [], stages: ["FORECAST"], snapshots: [],
    checkpoint: { committedCycleSequence: cycleSequence, nextRecordIndex: 525601 + cycleSequence,
      nextCycleSequence: cycleSequence + 1, contentDigestHex: digest }, ledgerHeadContentDigestHex: digest,
  }));
  return {
    schemaVersion: "waia.trader.historical_observable_read_model.v2", mode: "HISTORICAL_SIMULATION",
    capitalEligible: false, organizationId: "org", runId: "run", eventId: "one",
    observedAt: "2026-09-10T00:00:00.000Z",
    lifecycle: { phase: "COMPLETED", qualifiedTotalCycles: 2, committedCycles: 2, remainingCycles: 0,
      progressBps: 10000, nextCycleSequence: 2, latestCommittedCycleId: "cycle-1",
      observedAt: "2026-09-10T00:00:00.000Z", errorCode: null, contentDigestHex: digest },
    accounts: [{ ...history[1], history }],
    aggregate: { accountCount: 1, equity: "101.00000000", cash: "100.00000000", netPnl: "1.00000000",
      buyAndHoldGrossEquity: "102.00000000", strategyMinusBuyAndHoldGross: "-1.00000000",
      cycles: 2, decisions: 2, riskVetoes: 0, orders: 1, fills: 1, processedRecords: 2,
      latestCycleSequence: 1, qualifiedTotalCycles: 2, committedCycles: 2, progressBps: 10000, runPhase: "COMPLETED" },
  };
}
function compare(a: unknown, b: unknown, scope = expected) {
  return compareHistoricalPanelExportsV2(JSON.stringify(a), JSON.stringify(b), scope);
}
describe("offline historical panel comparison (not execution or qualification proof)", () => {
  it("matches supplied bodies, ignoring only root transport identity/time", () => {
    const a = fixture(); const b = fixture(); b.eventId = "two"; b.observedAt = "2026-09-10T00:00:01.000Z";
    expect(compare(a, b)).toEqual({ status: "MATCH", reason: "SUPPLIED_PROJECTIONS_EQUAL", readinessGranted: false });
  });
  it("is independent of object key insertion order, not array order", () => {
    const a = fixture(); const b = Object.fromEntries(Object.entries(a).reverse());
    expect(compare(a, b).status).toBe("MATCH");
  });
  for (const field of ["lastForecast", "lastDecision", "lastRisk", "lastAccounting", "lastLearning",
    "observedExecutionEffects", "modeledRealityArtifacts", "knowledgeArtifacts", "stages", "snapshots"]) {
    it(`compares ${field} without stripping evidence`, () => {
      const a = fixture(); const b = fixture();
      (b.accounts[0]!.history[0] as Record<string, unknown>)[field] = field.endsWith("Artifacts") ||
        ["observedExecutionEffects", "stages", "snapshots"].includes(field) ? ["changed"] : { changed: true };
      expect(compare(a, b).status).toBe("DIFFERENT");
    });
  }
  it("does not ignore lifecycle timestamps or digests", () => {
    const a = fixture(); const b = fixture(); b.lifecycle.observedAt = "2026-09-10T01:00:00.000Z";
    expect(compare(a, b).status).toBe("DIFFERENT");
    b.lifecycle.observedAt = a.lifecycle.observedAt; b.lifecycle.contentDigestHex = "b".repeat(64);
    expect(compare(a, b).status).toBe("DIFFERENT");
  });
  for (const mutate of [
    (a: ReturnType<typeof fixture>) => { a.accounts[0]!.history.pop(); },
    (a: ReturnType<typeof fixture>) => { a.accounts[0]!.history[1] = a.accounts[0]!.history[0]!; },
    (a: ReturnType<typeof fixture>) => { a.accounts[0]!.history[0]!.checkpoint.nextRecordIndex++; },
    (a: ReturnType<typeof fixture>) => { a.accounts[0]!.history[0]!.accountId = "foreign"; },
    (a: ReturnType<typeof fixture>) => { a.lifecycle.phase = "RUNNING"; },
    (a: ReturnType<typeof fixture>) => { a.lifecycle.errorCode = "ERROR" as never; },
    (a: ReturnType<typeof fixture>) => { a.aggregate.committedCycles--; },
    (a: ReturnType<typeof fixture>) => { a.aggregate.equity = "999.00000000"; },
    (a: ReturnType<typeof fixture>) => { a.capitalEligible = true; },
    (a: ReturnType<typeof fixture>) => { a.schemaVersion = "unknown"; },
    (a: ReturnType<typeof fixture>) => { a.accounts.push(a.accounts[0]!); },
    (a: ReturnType<typeof fixture>) => { a.accounts[0]!.equity = "999"; },
  ]) it("refuses equal malformed/incomplete captures", () => {
    const a = fixture(); mutate(a); expect(compare(a, a).status).toBe("REFUSED");
  });
  it.each(["organizationId", "runId", "accountId"])("requires explicit expected %s", field => {
    expect(compare(fixture(), fixture(), { ...expected, [field]: "wrong" }).status).toBe("REFUSED");
  });
  it("rejects unknown top-level fields rather than discarding them", () => {
    const a = { ...fixture(), ignored: "hidden" }; expect(compare(a, a).status).toBe("REFUSED");
  });
  it("refuses numeric lexemes that JSON.parse would silently round", () => {
    const a = JSON.stringify(fixture());
    for (const number of ["9007199254740993", "0.60000000000000000001", "1e999", "-0"]) {
      expect(compareHistoricalPanelExportsV2(a.replace('"confidence":0.6', `"confidence":${number}`), a, expected).status).toBe("REFUSED");
    }
  });
  it("refuses duplicate members including escaped-key aliases", () => {
    const a = JSON.stringify(fixture());
    for (const replacement of ['"confidence":0.7,"confidence":0.6', '"confi\\u0064ence":0.7,"confidence":0.6']) {
      expect(compareHistoricalPanelExportsV2(a.replace('"confidence":0.6', replacement), a, expected).status).toBe("REFUSED");
    }
  });
  it("rejects missing object-valued producer stages", () => {
    for (const field of ["lastForecast", "lastRisk", "lastExecution", "lastAccounting"]) {
      const a = fixture();
      for (const cycle of [...a.accounts[0]!.history, a.accounts[0]!]) (cycle as Record<string, unknown>)[field] = null;
      expect(compare(a, a).status).toBe("REFUSED");
    }
  });
  it("retains every opaque member when checking latest against history", () => {
    for (const field of ["lastForecast", "lastRisk", "lastExecution", "lastAccounting"]) {
      const a = fixture();
      const latest = a.accounts[0]! as Record<string, unknown>;
      latest[field] = { ...(latest[field] as object), ...JSON.parse('{"__proto__":{"different":true}}') };
      expect(compare(a, a).status).toBe("REFUSED");
    }
  });
  it("bounds input size, structure depth, and expected extent", () => {
    const a = JSON.stringify(fixture());
    expect(compareHistoricalPanelExportsV2(" ".repeat(32 * 1024 * 1024 + 1), a, expected).status).toBe("REFUSED");
    expect(compareHistoricalPanelExportsV2("[".repeat(100) + "0" + "]".repeat(100), a, expected).status).toBe("REFUSED");
    expect(compare(fixture(), fixture(), { ...expected, totalCycles: 0 }).status).toBe("REFUSED");
    expect(compareHistoricalPanelExportsV2("not JSON", a, expected).status).toBe("REFUSED");
  });
});
