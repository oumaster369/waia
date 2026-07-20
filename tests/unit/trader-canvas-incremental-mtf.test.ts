import { describe, expect, it } from "vitest";

import {
  advanceMtf,
  collectIncrementalClosedBars,
  createMtfDomainState,
} from "@/lib/trader/market-data/canvas/incremental-mtf";
import type { HtfInterval } from "@/lib/trader/market-data/canvas/incremental-mtf";
import {
  aggregateBucket,
  resampleReplayMtfBars,
} from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type { Bar } from "@/lib/trader/intelligence/types";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) =>
    makeCanvasBar1m({
      barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    }),
  );
}

function groupByInterval(
  emitted: readonly { interval: HtfInterval; bar: Bar }[],
): Record<HtfInterval, Bar[]> {
  const grouped: Record<HtfInterval, Bar[]> = { "15m": [], "1h": [], "4h": [], "1d": [] };
  for (const item of emitted) {
    grouped[item.interval].push(item.bar);
  }
  return grouped;
}

function expectedOracleClosed(
  bars1m: readonly Bar[],
  finalState: ReturnType<typeof createMtfDomainState>,
  interval: HtfInterval,
): Bar[] {
  const oracle = resampleReplayMtfBars({ bars1m })[interval] ?? [];
  if (finalState.forming[interval] && oracle.length > 0) {
    return oracle.slice(0, -1);
  }
  return oracle;
}

describe("trader canvas incremental mtf (HTR-WP07)", () => {
  it("does not emit the still-forming bucket", () => {
    const bars = sampleBars(10);
    const { emitted, finalState } = collectIncrementalClosedBars(bars);
    expect(finalState.forming["15m"]).toBeDefined();
    const grouped = groupByInterval(emitted);
    for (const interval of ["15m", "1h", "4h", "1d"] as const) {
      expect(grouped[interval]).toEqual(expectedOracleClosed(bars, finalState, interval));
    }
  });

  it("records gap diagnostics when gapObserved is true", () => {
    let state = createMtfDomainState();
    const bar = sampleBars(1)[0]!;
    const first = advanceMtf(state, bar, { gapObserved: false });
    state = first.state;
    const second = advanceMtf(state, sampleBars(1)[0]!, { gapObserved: true });
    expect(second.state.gapCount).toBe(1);
    expect(second.state.lastGapBarOpenTimeMs).toBe(Date.parse(bar.barOpenTime));
  });

  it("leaves gap diagnostics unchanged when gapObserved is false", () => {
    let state = createMtfDomainState();
    state = advanceMtf(state, sampleBars(1)[0]!, { gapObserved: true }).state;
    const before = { gapCount: state.gapCount, lastGap: state.lastGapBarOpenTimeMs };
    state = advanceMtf(state, sampleBars(2)[1]!, { gapObserved: false }).state;
    expect(state.gapCount).toBe(before.gapCount);
    expect(state.lastGapBarOpenTimeMs).toBe(before.lastGap);
  });

  it("round-trips forming buckets and gap diagnostics on restore-shaped replay", () => {
    const bars = sampleBars(20);
    const firstPass = collectIncrementalClosedBars(bars);
    const secondPass = collectIncrementalClosedBars(bars);
    expect(firstPass.finalState).toEqual(secondPass.finalState);
    expect(firstPass.emitted).toEqual(secondPass.emitted);
  });

  it("aggregateBucket via shared primitive matches reduce semantics", () => {
    const bucket = sampleBars(15);
    const viaReduce = aggregateBucket(bucket, "15m");
    expect(viaReduce.symbol).toBe("BTC/USDT");
    expect(viaReduce.interval).toBe("15m");
    expect(Number(viaReduce.volume)).toBeGreaterThan(0);
  });
});
