import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";

function loadFixtureBars(): Bar[] {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  const fixture = JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[] };
  return fixture.bars;
}

function buildFifteenMinuteBar(input: {
  index: number;
  open: string;
  high: string;
  low: string;
  close: string;
}): Bar[] {
  const startMs = Date.parse("2026-01-01T00:00:00.000Z") + input.index * 15 * 60_000;
  const bars: Bar[] = [];
  for (let minute = 0; minute < 15; minute += 1) {
    const openMs = startMs + minute * 60_000;
    const closeMs = openMs + 59_999;
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: input.open,
      high: input.high,
      low: input.low,
      close: input.close,
      volume: "10",
      barOpenTime: new Date(openMs).toISOString(),
      barCloseTime: new Date(closeMs).toISOString(),
    });
  }
  return bars;
}

function buildSweepDetectionBars(): Bar[] {
  const buckets = [
    { open: "65000", high: "65020", low: "64950", close: "65010" },
    { open: "65010", high: "65020", low: "64950", close: "65010" },
    { open: "65010", high: "65020", low: "64800", close: "64900" },
    { open: "64900", high: "65020", low: "64900", close: "65000" },
    { open: "65000", high: "65020", low: "64900", close: "65000" },
    { open: "65000", high: "65050", low: "64700", close: "64950" },
  ];
  return buckets.flatMap((bucket, index) => buildFifteenMinuteBar({ index, ...bucket }));
}

describe("trader reconstruction snapshot (PR-2)", () => {
  it("produces deterministic descriptors across all six structural dimensions", () => {
    const bars = loadFixtureBars();
    const evaluatedAt = bars.at(-1)!.barCloseTime;

    const first = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });
    const second = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });

    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first.marketStructure).toBeDefined();
    expect(first.liquidityStructure).toBeDefined();
    expect(first.trendStructure).toBeDefined();
    expect(first.volatilityStructure).toBeDefined();
    expect(first.participationStructure).toBeDefined();
    expect(first.contextStructure).toBeDefined();
    expect(first.contextStructure.contextOnly).toBe(true);
  });

  it("never derives structure from 1m-only insufficient data gracefully", () => {
    const bars = loadFixtureBars().slice(0, 3);
    const snapshot = buildReconstructionSnapshot({
      bars1m: bars,
      evaluatedAt: bars.at(-1)!.barCloseTime,
    });
    expect(snapshot.marketStructure.structureBias).toBe("UNCLEAR");
    expect(snapshot.trendStructure.regimeBias).toBe("UNKNOWN");
  });

  it("digest is stable and excludes generatedAt", () => {
    const bars = loadFixtureBars();
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const snapshot = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });
    expect(snapshot.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.evaluatedAt).toBe(evaluatedAt);
  });

  it("marks liquidity levels as swept when price wicks through and reclaims", () => {
    const bars = buildSweepDetectionBars();
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const snapshot = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });

    const lowLevels = snapshot.liquidityStructure.levels.filter(
      (level) => level.kind === "EQUAL_LOWS" || level.kind === "SWING_LOW",
    );
    const highLevels = snapshot.liquidityStructure.levels.filter(
      (level) => level.kind === "EQUAL_HIGHS" || level.kind === "SWING_HIGH",
    );

    expect(lowLevels.length).toBeGreaterThan(0);
    expect(lowLevels.some((level) => level.swept)).toBe(true);
    expect(snapshot.liquidityStructure.unsweptLowCount).toBeLessThan(lowLevels.length);
    expect(
      snapshot.liquidityStructure.unsweptHighCount +
        highLevels.filter((level) => level.swept).length,
    ).toBe(highLevels.length);
    expect(
      snapshot.liquidityStructure.unsweptLowCount + lowLevels.filter((level) => level.swept).length,
    ).toBe(lowLevels.length);
  });
});
