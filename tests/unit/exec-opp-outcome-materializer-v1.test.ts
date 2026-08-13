import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  materializeExecOppOutcome13dV1,
  terminalRhFromOutcome13dV1,
  type QualifiedDevelopmentBarV1,
} from "@/lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import { OUTCOME_VERSION } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function bar(offsetMin: number, close: number, vol: number): QualifiedDevelopmentBarV1 {
  return {
    closedBarEpochMs: T0 + offsetMin * MIN,
    close,
    qualifiedBaseVolume: vol,
  };
}

function barsForHorizon(h: 30 | 60): Map<number, QualifiedDevelopmentBarV1> {
  const map = new Map<number, QualifiedDevelopmentBarV1>();
  map.set(T0, bar(0, 100, 1));
  for (const k of [1, 2, 3, h, h + 1, h + 2, h + 3]) {
    map.set(T0 + k * MIN, bar(k, 100 * Math.exp(0.001 * k), 10 + k));
  }
  return map;
}

describe("DEE-527 PIT exec-opp-outcome materializer", () => {
  it("known-answer R_k and V_k for h=30 with exactly 13 components", () => {
    const bars = barsForHorizon(30);
    const result = materializeExecOppOutcome13dV1({
      primaryHorizonMinutes: 30,
      anchorClosedBarEpochMs: T0,
      barsByCloseEpochMs: bars,
    });
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.outcomeVersion).toBe(OUTCOME_VERSION);
    expect(result.outcome13d).toHaveLength(13);
    expect(result.outcome13d[0]).toBeCloseTo(Math.log(bars.get(T0 + MIN)!.close / 100), 12);
    expect(result.outcome13d[3]).toBeCloseTo(Math.log(bars.get(T0 + 30 * MIN)!.close / 100), 12);
    expect(result.outcome13d[7]).toBe(11); // V_1 at offset 1
    expect(result.outcome13d[10]).toBe(10 + 31); // V_{h+1}
    expect(terminalRhFromOutcome13dV1(result.outcome13d)).toBe(result.rH);
    expect(result.outcomeContentDigestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("h=60 uses exact bar offsets", () => {
    const bars = barsForHorizon(60);
    const result = materializeExecOppOutcome13dV1({
      primaryHorizonMinutes: 60,
      anchorClosedBarEpochMs: T0,
      barsByCloseEpochMs: bars,
    });
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.outcome13d[3]).toBeCloseTo(Math.log(bars.get(T0 + 60 * MIN)!.close / 100), 12);
  });

  it("missing future bar => UNAVAILABLE", () => {
    const bars = barsForHorizon(30);
    bars.delete(T0 + 33 * MIN);
    const result = materializeExecOppOutcome13dV1({
      primaryHorizonMinutes: 30,
      anchorClosedBarEpochMs: T0,
      barsByCloseEpochMs: bars,
    });
    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reason).toBe("UNAVAILABLE");
  });

  it("deterministic digest for identical inputs", () => {
    const bars = barsForHorizon(30);
    const a = materializeExecOppOutcome13dV1({
      primaryHorizonMinutes: 30,
      anchorClosedBarEpochMs: T0,
      barsByCloseEpochMs: bars,
    });
    const b = materializeExecOppOutcome13dV1({
      primaryHorizonMinutes: 30,
      anchorClosedBarEpochMs: T0,
      barsByCloseEpochMs: bars,
    });
    expect(a.eligible && b.eligible).toBe(true);
    if (!a.eligible || !b.eligible) return;
    expect(a.outcomeContentDigestHex).toBe(b.outcomeContentDigestHex);
    expect(createHash("sha256").update("x").digest("hex")).not.toBe(a.outcomeContentDigestHex);
  });
});
