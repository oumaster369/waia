import type { Bar } from "@/lib/trader/intelligence/types";
import {
  appendBarToBucket,
  createBucketAccumulator,
  finalizeBucket,
  type BucketAccumulator,
} from "@/lib/trader/market-data/mtf/mtf-bucket-accumulator";
import { floorToInterval, INTERVAL_MS } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";

export type HtfInterval = "15m" | "1h" | "4h" | "1d";

const HTF_INTERVALS: readonly HtfInterval[] = ["15m", "1h", "4h", "1d"];

const CLOSED_TAIL_CAPACITY: Record<HtfInterval, number> = {
  "15m": 5,
  "1h": 24,
  "4h": 5,
  "1d": 5,
};

export type MtfDomainState = Readonly<{
  forming: Partial<Record<HtfInterval, BucketAccumulator>>;
  closedTail: Readonly<{
    _15m: readonly Bar[];
    _1h: readonly Bar[];
    _4h: readonly Bar[];
    _1d: readonly Bar[];
  }>;
  gapCount: number;
  lastGapBarOpenTimeMs: number | null;
}>;

export type MtfView = Readonly<{
  formingBucketKeys: Readonly<Partial<Record<HtfInterval, number>>>;
  closedTail: MtfDomainState["closedTail"];
  gapCount: number;
  lastGapBarOpenTimeMs: number | null;
}>;

export type MtfAdvanceResult = Readonly<{
  state: MtfDomainState;
  emittedClosed: readonly { interval: HtfInterval; bar: Bar }[];
}>;

export function createMtfDomainState(): MtfDomainState {
  return {
    forming: {},
    closedTail: { _15m: [], _1h: [], _4h: [], _1d: [] },
    gapCount: 0,
    lastGapBarOpenTimeMs: null,
  };
}

function tailKey(interval: HtfInterval): "_15m" | "_1h" | "_4h" | "_1d" {
  switch (interval) {
    case "15m":
      return "_15m";
    case "1h":
      return "_1h";
    case "4h":
      return "_4h";
    case "1d":
      return "_1d";
  }
}

function appendClosedTail(tail: readonly Bar[], bar: Bar, capacity: number): readonly Bar[] {
  const next = [...tail, bar];
  if (next.length <= capacity) {
    return next;
  }
  return next.slice(next.length - capacity);
}

function processInterval(
  state: MtfDomainState,
  interval: HtfInterval,
  acceptedBar1m: Bar,
): { state: MtfDomainState; emitted: Bar | null } {
  const intervalMs = INTERVAL_MS[interval];
  const bucketKey = floorToInterval(Date.parse(acceptedBar1m.barOpenTime), intervalMs);
  const forming = state.forming[interval];
  const key = tailKey(interval);

  if (!forming) {
    return {
      state: {
        ...state,
        forming: { ...state.forming, [interval]: createBucketAccumulator(acceptedBar1m, interval) },
      },
      emitted: null,
    };
  }

  if (bucketKey > forming.bucketKey) {
    const closedBar = finalizeBucket(forming, interval);
    const nextTail = appendClosedTail(
      state.closedTail[key],
      closedBar,
      CLOSED_TAIL_CAPACITY[interval],
    );
    return {
      state: {
        ...state,
        forming: { ...state.forming, [interval]: createBucketAccumulator(acceptedBar1m, interval) },
        closedTail: { ...state.closedTail, [key]: nextTail },
      },
      emitted: closedBar,
    };
  }

  return {
    state: {
      ...state,
      forming: { ...state.forming, [interval]: appendBarToBucket(forming, acceptedBar1m) },
    },
    emitted: null,
  };
}

export function advanceMtf(
  state: MtfDomainState,
  acceptedBar1m: Bar,
  input: { gapObserved: boolean },
): MtfAdvanceResult {
  let nextState: MtfDomainState = {
    ...state,
    gapCount: input.gapObserved ? state.gapCount + 1 : state.gapCount,
    lastGapBarOpenTimeMs: input.gapObserved
      ? Date.parse(acceptedBar1m.barOpenTime)
      : state.lastGapBarOpenTimeMs,
  };

  const emittedClosed: { interval: HtfInterval; bar: Bar }[] = [];

  for (const interval of HTF_INTERVALS) {
    const result = processInterval(nextState, interval, acceptedBar1m);
    nextState = result.state;
    if (result.emitted) {
      emittedClosed.push({ interval, bar: result.emitted });
    }
  }

  return { state: nextState, emittedClosed };
}

export function selectMtfView(state: MtfDomainState): MtfView {
  const formingBucketKeys: Partial<Record<HtfInterval, number>> = {};
  for (const interval of HTF_INTERVALS) {
    const acc = state.forming[interval];
    if (acc) {
      formingBucketKeys[interval] = acc.bucketKey;
    }
  }
  return {
    formingBucketKeys,
    closedTail: state.closedTail,
    gapCount: state.gapCount,
    lastGapBarOpenTimeMs: state.lastGapBarOpenTimeMs,
  };
}

export function collectIncrementalClosedBars(
  bars1m: readonly Bar[],
  gapObservedAt: ReadonlySet<number> = new Set(),
): { emitted: readonly { interval: HtfInterval; bar: Bar }[]; finalState: MtfDomainState } {
  let state = createMtfDomainState();
  const emitted: { interval: HtfInterval; bar: Bar }[] = [];
  for (const bar of bars1m) {
    const openMs = Date.parse(bar.barOpenTime);
    const result = advanceMtf(state, bar, { gapObserved: gapObservedAt.has(openMs) });
    state = result.state;
    for (const item of result.emittedClosed) {
      emitted.push(item);
    }
  }
  return { emitted, finalState: state };
}
