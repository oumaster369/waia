/**
 * DEE-436 — FHV official multi-year bounded memory scale proof.
 */

import { describe, expect, it } from "vitest";

import { resetFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  createLazyOfficialInterleavedBarIterator,
  FHV_OFFICIAL_TOTAL_BARS,
  FhvLazySharedPortfolioBarReplaySource,
  getFhvSharedPortfolioSnapshotMaterializationCount,
  resetFhvSharedPortfolioSnapshotMaterializationCount,
} from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";

const MEMORY_CEILING_BYTES = 256 * 1024 * 1024;

describe("DEE-436 FHV official scale memory", () => {
  it("FHV_OFFICIAL_MULTI_YEAR_BOUNDED_MEMORY_SCALE_PASS", () => {
    resetFhvSharedPortfolioSnapshotMaterializationCount();
    resetFullHistoryRescanCount();

    const iterator = createLazyOfficialInterleavedBarIterator();
    const heapBefore = process.memoryUsage().heapUsed;
    let totalBars = 0;
    let rollingDigestCount = 0;

    while (totalBars < iterator.totalEvents) {
      const bar = iterator.next();
      if (!bar) {
        break;
      }
      computeBarContentDigest(bar);
      totalBars += 1;
      rollingDigestCount += 1;
    }

    expect(totalBars).toBe(FHV_OFFICIAL_TOTAL_BARS);
    expect(rollingDigestCount).toBe(FHV_OFFICIAL_TOTAL_BARS);

    const heapAfterScan = process.memoryUsage().heapUsed;
    expect(heapAfterScan - heapBefore).toBeLessThan(MEMORY_CEILING_BYTES);

    const lazyIterator = createLazyOfficialInterleavedBarIterator();
    const source = new FhvLazySharedPortfolioBarReplaySource({
      nextBar: () => lazyIterator.next(),
      cycleIdPrefix: "fhv-scale-sample",
    });

    let sampleCycles = 0;
    while (sampleCycles < 40) {
      const result = source.next();
      if (result.done) {
        break;
      }
      sampleCycles += 1;
    }

    expect(sampleCycles).toBe(40);
    expect(getFhvSharedPortfolioSnapshotMaterializationCount()).toBe(40);
  }, 180_000);
});
