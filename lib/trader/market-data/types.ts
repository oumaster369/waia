import type { Bar, Quote } from "@/lib/trader/intelligence/types";

export type BarReplayMode = "full" | "expand";

export type MarketSnapshot = {
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  cycleIndex: number;
  cycleId: string;
};

export type BarReplayNextResult = { done: false; snapshot: MarketSnapshot } | { done: true };

export type BarReplaySource = {
  next(): BarReplayNextResult;
  reset(): void;
};

export type FixtureBarReplayOptions = {
  fixturePath?: string;
  mode?: BarReplayMode;
  cycleIdPrefix?: string;
};

export type TraderFixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};
