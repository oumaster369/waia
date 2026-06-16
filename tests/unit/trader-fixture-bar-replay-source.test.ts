import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOLDEN_FIXTURE_PATH,
  EXPAND_MIN_BARS,
  FixtureBarReplaySource,
} from "@/lib/trader/market-data/fixture-bar-replay-source";

describe("FixtureBarReplaySource (DEE-260)", () => {
  it("loads the golden BTC/USDT fixture by default", () => {
    const source = new FixtureBarReplaySource();
    const first = source.next();
    expect(first.done).toBe(false);
    if (first.done) {
      return;
    }
    expect(first.snapshot.bars).toHaveLength(25);
    expect(first.snapshot.bars[0]!.symbol).toBe("BTC/USDT");
    expect(first.snapshot.quote.symbol).toBe("BTC/USDT");
  });

  it("full mode returns the same 25-bar window on consecutive cycles", () => {
    const source = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "test-full" });

    const a = source.next();
    const b = source.next();
    const c = source.next();

    expect(a.done).toBe(false);
    expect(b.done).toBe(false);
    expect(c.done).toBe(false);
    if (a.done || b.done || c.done) {
      return;
    }

    expect(a.snapshot.bars).toHaveLength(25);
    expect(b.snapshot.bars).toHaveLength(25);
    expect(c.snapshot.bars).toHaveLength(25);
    expect(a.snapshot.bars[0]!.barOpenTime).toBe(b.snapshot.bars[0]!.barOpenTime);
    expect(a.snapshot.quote).toEqual(b.snapshot.quote);
    expect(a.snapshot.evaluatedAt).toBe(b.snapshot.evaluatedAt);
  });

  it("increments cycleIndex and cycleId deterministically in full mode", () => {
    const source = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "prefix" });

    const first = source.next();
    const second = source.next();

    expect(first.done).toBe(false);
    expect(second.done).toBe(false);
    if (first.done || second.done) {
      return;
    }

    expect(first.snapshot.cycleIndex).toBe(0);
    expect(first.snapshot.cycleId).toBe("prefix-0");
    expect(second.snapshot.cycleIndex).toBe(1);
    expect(second.snapshot.cycleId).toBe("prefix-1");
  });

  it("expand mode grows window from 20 to 25 then exhausts", () => {
    const source = new FixtureBarReplaySource({ mode: "expand", cycleIdPrefix: "expand" });
    const lengths: number[] = [];

    for (let index = 0; index < 10; index += 1) {
      const next = source.next();
      if (next.done) {
        break;
      }
      lengths.push(next.snapshot.bars.length);
    }

    expect(lengths).toEqual([20, 21, 22, 23, 24, 25]);

    expect(source.next()).toEqual({ done: true });
    expect(source.next()).toEqual({ done: true });
  });

  it("expand mode never returns fewer than EXPAND_MIN_BARS while active", () => {
    const source = new FixtureBarReplaySource({ mode: "expand" });

    for (let index = 0; index < 6; index += 1) {
      const next = source.next();
      if (next.done) {
        break;
      }
      expect(next.snapshot.bars.length).toBeGreaterThanOrEqual(EXPAND_MIN_BARS);
    }
  });

  it("reset restores expand progression", () => {
    const source = new FixtureBarReplaySource({ mode: "expand" });

    source.next();
    source.next();
    source.reset();

    const afterReset = source.next();
    expect(afterReset.done).toBe(false);
    if (afterReset.done) {
      return;
    }
    expect(afterReset.snapshot.bars).toHaveLength(EXPAND_MIN_BARS);
    expect(afterReset.snapshot.cycleIndex).toBe(0);
  });

  it("evaluatedAt matches last bar close time", () => {
    const source = new FixtureBarReplaySource({ mode: "full" });
    const next = source.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }
    expect(next.snapshot.evaluatedAt).toBe(next.snapshot.bars.at(-1)!.barCloseTime);
  });

  it("accepts explicit fixture path override", () => {
    const source = new FixtureBarReplaySource({ fixturePath: DEFAULT_GOLDEN_FIXTURE_PATH });
    const next = source.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }
    expect(next.snapshot.bars).toHaveLength(25);
  });
});
