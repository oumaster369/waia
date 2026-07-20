import { describe, expect, it } from "vitest";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  DEFAULT_RESEARCH_DATASET_SPLIT_RATIOS,
  computeBarSetDigest,
  sealResearchDataset,
  splitBarsThreeWay,
} from "@/lib/trader/market-data/research-dataset";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { Bar } from "@/lib/trader/intelligence/types";

function makeBar(index: number, close = "65000"): Bar {
  const openMs = Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000;
  const openIso = new Date(openMs).toISOString();
  const closeIso = new Date(openMs + 60_000).toISOString();
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: openIso,
    barCloseTime: closeIso,
  };
}

function makeBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) => makeBar(index, `${65000 + index}`));
}

describe("computeStableJsonDigest", () => {
  it("is stable across key order", () => {
    const a = computeStableJsonDigest({ z: 1, a: 2 });
    const b = computeStableJsonDigest({ a: 2, z: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeBarContentDigest", () => {
  it("changes when OHLCV content changes", () => {
    const bars = makeBars(2);
    const first = computeBarContentDigest(bars[0]!);
    const second = computeBarContentDigest(bars[1]!);
    expect(first).not.toBe(second);
  });

  it("is stable for identical bar payloads", () => {
    const bar = makeBar(0);
    expect(computeBarContentDigest(bar)).toBe(computeBarContentDigest({ ...bar }));
  });
});

describe("splitBarsThreeWay", () => {
  it("partitions 10 bars 60/20/20 chronologically", () => {
    const bars = makeBars(10);
    const splits = splitBarsThreeWay(bars, DEFAULT_RESEARCH_DATASET_SPLIT_RATIOS);

    expect(splits.train).toHaveLength(6);
    expect(splits.validation).toHaveLength(2);
    expect(splits.blind).toHaveLength(2);
    expect(splits.train[0]!.barOpenTime).toBe(bars[0]!.barOpenTime);
    expect(splits.validation[0]!.barOpenTime).toBe(bars[6]!.barOpenTime);
    expect(splits.blind[0]!.barOpenTime).toBe(bars[8]!.barOpenTime);
  });

  it("rejects ratios that do not sum to 1", () => {
    expect(() =>
      splitBarsThreeWay(makeBars(10), { train: 0.5, validation: 0.2, blind: 0.2 }),
    ).toThrow(/sum to 1/);
  });

  it("rejects histories shorter than three bars", () => {
    expect(() => splitBarsThreeWay(makeBars(2))).toThrow(/at least 3 bars/);
  });
});

describe("sealResearchDataset", () => {
  it("computes split digests from bar content digests", () => {
    const bars = makeBars(10);
    const splits = splitBarsThreeWay(bars);
    const sealed = sealResearchDataset(bars, splits);

    expect(sealed.trainBarCount).toBe(6);
    expect(sealed.validationBarCount).toBe(2);
    expect(sealed.blindBarCount).toBe(2);
    expect(sealed.trainDigest).toBe(computeBarSetDigest(splits.train));
    expect(sealed.validationDigest).toBe(computeBarSetDigest(splits.validation));
    expect(sealed.blindDigest).toBe(computeBarSetDigest(splits.blind));
    expect(sealed.sealedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects splits whose counts do not cover the full history", () => {
    const bars = makeBars(10);
    const splits = splitBarsThreeWay(bars);
    const truncated = {
      ...splits,
      blind: splits.blind.slice(0, 1),
    };

    expect(() => sealResearchDataset(bars, truncated)).toThrow(/must match full history/);
  });

  it("detects tampering via digest mismatch", () => {
    const bars = makeBars(10);
    const splits = splitBarsThreeWay(bars);
    const sealed = sealResearchDataset(bars, splits);

    const tampered = { ...splits.train[0]!, close: "99999" };
    const tamperedTrain = [tampered, ...splits.train.slice(1)];
    const tamperedDigest = computeBarSetDigest(tamperedTrain);

    expect(tamperedDigest).not.toBe(sealed.trainDigest);
  });
});
