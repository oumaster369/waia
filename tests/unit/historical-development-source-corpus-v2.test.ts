import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildHistoricalDevelopmentSourceCorpusV2,
  loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2,
  loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2,
} from
  "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  barToFhvBarsV2Record,
  serializeFhvBarsV2Record,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { streamingBarSemanticDigestOf } from
  "@/lib/trader/market-data/fhv-streaming-bar-digest";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureBars(count: number, symbol = "BTC/USDT"): Bar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 10_000 + index * 2 + Math.sin(index / 4) * 20;
    const openTime = new Date(Date.UTC(2020, 0, 1) + index * 60_000).toISOString();
    return { symbol, interval: "1m", barOpenTime: openTime,
      barCloseTime: new Date(Date.parse(openTime) + 60_000).toISOString(),
      open: (close - 1).toFixed(8), high: (close + 3).toFixed(8), low: (close - 3).toFixed(8),
      close: close.toFixed(8), volume: String(100 + (index % 17)) };
  });
}

async function* iterable(values: readonly Bar[]): AsyncGenerator<Bar> {
  for (const value of values) yield value;
}

describe("historical DEVELOPMENT source corpus v2", () => {
  it("seals PIT features and attaches only fully visible 13-D outcomes", async () => {
    const bars = fixtureBars(180);
    const corpus = await buildHistoricalDevelopmentSourceCorpusV2({
      bars: iterable(bars), symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    });
    expect(corpus).toHaveLength(127);
    expect(corpus[0]?.closedBarEpochMs).toBe(Date.parse(bars[20]!.barCloseTime));
    expect(corpus.at(-1)?.closedBarEpochMs).toBe(Date.parse(bars[146]!.barCloseTime));
    expect(corpus.every((anchor) => anchor.outcome13d.length === 13)).toBe(true);
    expect(corpus.every((anchor) => anchor.symbol === "BTCUSDT")).toBe(true);
  });

  it("returns the digest of the same byte stream consumed by the corpus parser", async () => {
    const root = mkdtempSync(join(tmpdir(), "waia-development-corpus-"));
    temporaryRoots.push(root);
    const partitionDir = join(root, "partitions", "development", "BTCUSDT");
    mkdirSync(partitionDir, { recursive: true });
    const raw = fixtureBars(180)
      .map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)))
      .join("");
    writeFileSync(join(partitionDir, "bars.v2.ndjson"), raw);

    const snapshot = await loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2({
      datasetRoot: root,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
    });

    expect(snapshot.corpus).toHaveLength(127);
    expect(snapshot.rawSha256Hex).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  it("binds WF corpus, full-file bytes and exact scientific window to one snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "waia-wf-corpus-"));
    temporaryRoots.push(root);
    const partitionDir = join(root, "partitions", "walk-forward", "BTCUSDT");
    mkdirSync(partitionDir, { recursive: true });
    const bars = fixtureBars(180);
    const filePath = join(partitionDir, "bars.v2.ndjson");
    const serialize = (values: readonly Bar[]) => values
      .map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)))
      .join("");
    const rawA = serialize(bars);
    writeFileSync(filePath, rawA);
    const bounds = {
      startUtc: bars[0]!.barOpenTime,
      endUtc: bars.at(-1)!.barCloseTime,
    };
    const snapshotA = await loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2({
      datasetRoot: root,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      ...bounds,
    });
    expect(snapshotA.rawSha256Hex).toBe(createHash("sha256").update(rawA).digest("hex"));
    expect(snapshotA.scientificWindowEvidence).toEqual({
      ...bounds,
      barCount: bars.length,
      expectedBarCount: bars.length,
      firstBarOpen: bounds.startUtc,
      lastBarClose: bounds.endUtc,
      semanticContentDigest: streamingBarSemanticDigestOf(bars),
      gapDuplicateIntegrity: "PASS",
    });

    const changed = bars.map((bar, index) => index === 90
      ? { ...bar, close: (Number(bar.close) + 1).toFixed(8) }
      : bar);
    const rawB = serialize(changed);
    writeFileSync(filePath, rawB);
    const snapshotB = await loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2({
      datasetRoot: root,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      ...bounds,
    });
    expect(snapshotB.rawSha256Hex).not.toBe(snapshotA.rawSha256Hex);
    expect(snapshotB.scientificWindowEvidence?.semanticContentDigest).not.toBe(
      snapshotA.scientificWindowEvidence?.semanticContentDigest,
    );
  });

  it("fails closed on a gap instead of silently fabricating a future bar", async () => {
    const bars = fixtureBars(180);
    bars.splice(70, 1);
    await expect(buildHistoricalDevelopmentSourceCorpusV2({
      bars: iterable(bars), symbol: "BTCUSDT",
    })).rejects.toThrow("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:NON_CONTIGUOUS_BAR");
  });

  it("refuses a corpus too small for all three state pools", async () => {
    await expect(buildHistoricalDevelopmentSourceCorpusV2({
      bars: iterable(fixtureBars(100)), symbol: "BTCUSDT",
    })).rejects.toThrow("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:INSUFFICIENT_SOURCE_ANCHORS");
  });
});
