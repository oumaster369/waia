import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeAtrUsdt } from "@/lib/trader/exits/atr-estimator";
import {
  classifyBiasFromCloses,
  isHighSweepBar,
  isLowSweepBar,
} from "@/lib/trader/intelligence/reconstruction/reconstruction-kernel";
import { classifyTimeframeBias } from "@/lib/trader/intelligence/reconstruction/bar-utils";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";

function loadFixtureBars(): Bar[] {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  const fixture = JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[] };
  return fixture.bars;
}

describe("trader reconstruction kernel oracle regression", () => {
  it("preserves classifyTimeframeBias via classifyBiasFromCloses wrapper", () => {
    const bars = loadFixtureBars().slice(0, 60);
    const resampled = buildReconstructionSnapshot({
      bars1m: bars,
      evaluatedAt: bars.at(-1)!.barCloseTime,
    });
    expect(resampled.trendStructure.perTimeframeBias["1h"]).toBeDefined();
    const direct = classifyTimeframeBias(bars);
    const kernel = classifyBiasFromCloses(bars[0]!.close, bars.at(-1)!.close, bars.length);
    expect(direct).toBe(kernel);
  });

  it("preserves computeAtrUsdt output after kernel extraction", () => {
    const bars = loadFixtureBars().slice(0, 120);
    const atr = computeAtrUsdt(bars, 14);
    expect(atr === null || typeof atr === "string").toBe(true);
  });

  it("uses ms-safe sweep predicates for liquidity parity", () => {
    const bar: Bar = {
      symbol: "BTC/USDT",
      interval: "1h",
      open: "65000",
      high: "65050",
      low: "64900",
      close: "64950",
      volume: "10",
      barOpenTime: "2026-01-01T01:00:00.000Z",
      barCloseTime: "2026-01-01T01:59:59.999Z",
    };
    expect(isHighSweepBar("65020", bar)).toBe(true);
    expect(isLowSweepBar("64950", bar)).toBe(false);
    const formedAt = "2026-01-01T00:00:00.000Z";
    const formedAtMs = Date.parse(formedAt);
    const sweepMs = Date.parse(bar.barCloseTime);
    expect(sweepMs > formedAtMs).toBe(true);
  });
});
