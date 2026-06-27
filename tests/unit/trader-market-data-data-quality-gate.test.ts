import { describe, expect, it } from "vitest";

import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import {
  DATA_QUALITY_HALT_REASON,
  evaluateDataQualityGate,
  evaluateIngestionFailureGate,
  INGESTION_HALT_REASON,
} from "@/lib/trader/market-data/data-quality-gate";

function makeBars(count: number, close = "100.00"): Bar[] {
  const bars: Bar[] = [];
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  for (let index = 0; index < count; index += 1) {
    const openMs = start + index * 60_000;
    const closeMs = openMs + 59_999;
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: close,
      low: close,
      close,
      volume: "1",
      barOpenTime: new Date(openMs).toISOString(),
      barCloseTime: new Date(closeMs).toISOString(),
    });
  }
  return bars;
}

const quote: Quote = {
  symbol: "BTC/USDT",
  bid: "99.99",
  ask: "100.01",
  last: "100.00",
  timestamp: "2026-01-01T00:24:59.000Z",
};

describe("data quality gate (DEE-198)", () => {
  it("passes when data quality meets threshold", () => {
    const features = computeFeatureSnapshot({
      bars: makeBars(25),
      quote,
      evaluatedAt: makeBars(25).at(-1)!.barCloseTime,
    });
    const gate = evaluateDataQualityGate(features);
    expect(gate.halt).toBe(false);
    expect(gate.reasonCode).toBeNull();
  });

  it("halts fail-closed when data quality is below threshold", () => {
    const features = computeFeatureSnapshot({
      bars: makeBars(5),
    });
    const gate = evaluateDataQualityGate(features);
    expect(gate.halt).toBe(true);
    expect(gate.reasonCode).toBe(DATA_QUALITY_HALT_REASON);
  });

  it("halts on ingestion failure gate", () => {
    const gate = evaluateIngestionFailureGate();
    expect(gate.halt).toBe(true);
    expect(gate.reasonCode).toBe(INGESTION_HALT_REASON);
  });
});
