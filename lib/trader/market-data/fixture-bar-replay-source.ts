import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  BarReplayMode,
  BarReplayNextResult,
  BarReplaySource,
  FixtureBarReplayOptions,
  TraderFixtureFile,
} from "@/lib/trader/market-data/types";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";

export const DEFAULT_GOLDEN_FIXTURE_PATH = path.join(
  process.cwd(),
  "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
);

export const DEFAULT_CYCLE_ID_PREFIX = "dee-260";

/** Minimum bar count for expand mode start (matches Feature Engine SMA window). */
export const EXPAND_MIN_BARS = 20;

function loadFixtureFile(fixturePath: string): TraderFixtureFile {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as TraderFixtureFile;
}

export class FixtureBarReplaySource implements BarReplaySource {
  private readonly fixture: TraderFixtureFile;
  private readonly mode: BarReplayMode;
  private readonly cycleIdPrefix: string;
  private cycleIndex = 0;
  private expandBarCount = EXPAND_MIN_BARS;
  private expandExhausted = false;

  constructor(options: FixtureBarReplayOptions = {}) {
    const fixturePath = options.fixturePath ?? DEFAULT_GOLDEN_FIXTURE_PATH;
    this.fixture = loadFixtureFile(fixturePath);
    this.mode = options.mode ?? "full";
    this.cycleIdPrefix = options.cycleIdPrefix ?? DEFAULT_CYCLE_ID_PREFIX;

    if (this.fixture.bars.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] fixture requires at least ${EXPAND_MIN_BARS} bars for expand mode`,
      );
    }
  }

  reset(): void {
    this.cycleIndex = 0;
    this.expandBarCount = EXPAND_MIN_BARS;
    this.expandExhausted = false;
  }

  next(): BarReplayNextResult {
    if (this.mode === "full") {
      const snapshot = buildMarketSnapshot(
        this.fixture.bars,
        this.fixture.latestQuote,
        this.cycleIndex,
        this.cycleIdPrefix,
      );
      this.cycleIndex += 1;
      return { done: false, snapshot };
    }

    if (this.expandExhausted) {
      return { done: true };
    }

    const windowBars = this.fixture.bars.slice(0, this.expandBarCount);
    const snapshot = buildMarketSnapshot(
      windowBars,
      this.fixture.latestQuote,
      this.cycleIndex,
      this.cycleIdPrefix,
    );
    this.cycleIndex += 1;

    if (this.expandBarCount >= this.fixture.bars.length) {
      this.expandExhausted = true;
    } else {
      this.expandBarCount += 1;
    }

    return { done: false, snapshot };
  }
}
