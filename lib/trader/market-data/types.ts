import type { Bar, Quote, InstrumentId } from "@/lib/trader/intelligence/types";
import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

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

export type BarPollSource = {
  fetchSnapshot(): Promise<MarketSnapshot>;
  reset(): void;
};

export type FixtureBarReplayOptions = {
  fixturePath?: string;
  mode?: BarReplayMode;
  cycleIdPrefix?: string;
};

export type HtxBarPollOptions = {
  internalSymbol?: InstrumentId;
  size?: number;
  period?: string;
  cycleIdPrefix?: string;
  restHost?: string;
  fetchImpl?: HtxFetchFn;
};

export type TraderFixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};
