import { computeAtrUsdt } from "@/lib/trader/exits/atr-estimator";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { CanvasClosedBar } from "@/lib/trader/market-data/canvas/market-canvas.types";
import type { HtfInterval } from "@/lib/trader/market-data/canvas/incremental-mtf";
import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import {
  assembleContextStructure,
  assembleLiquidityStructure,
  assembleMarketStructure,
  assembleParticipationStructure,
  assembleReconstructionSnapshot,
  assembleTrendStructure,
  assembleVolatilityStructure,
} from "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import {
  classifyBiasFromCloses,
  isHighSweepBar,
  isLowSweepBar,
  seedAtrFromTrs,
  trueRange,
  wilderNextAtr,
} from "@/lib/trader/intelligence/reconstruction/reconstruction-kernel";
import { detectSwingPoints } from "@/lib/trader/intelligence/reconstruction/bar-utils";
import type {
  ReconstructionSnapshot,
  SwingPoint,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";

const ATR_PERIOD = 14;
const SWING_REGISTRY_MAX = 8;
const SWEEP_KEY_MAX = 16;

export type LiquiditySide = "HIGH" | "LOW";
export type SweepKey = `${LiquiditySide}:${string}`;
export type StructureTimeframe = "15m" | "1h" | "4h" | "1d";

const STRUCTURE_TF_KEYS: readonly StructureTimeframe[] = ["15m", "1h", "4h", "1d"];

export type TfReconstructionState = Readonly<{
  firstClose: string | null;
  latestClose: string | null;
  closedCount: number;
  swingWindow: readonly CanvasClosedBar[];
  swingHighs: readonly SwingPoint[];
  swingLows: readonly SwingPoint[];
  lastSweepTimeBySideKey: Readonly<Record<SweepKey, number>>;
  sweepSeedRing: readonly CanvasClosedBar[];
}>;

export type AtrStreamState = Readonly<{
  warm: boolean;
  seedTr: readonly string[];
  prevClose: string | null;
  currentAtr: string | null;
  atrDelayRing: readonly string[];
}>;

export type ReconstructionDomainState = Readonly<{
  perTf: Readonly<Record<StructureTimeframe, TfReconstructionState>>;
  atr1h: AtrStreamState;
  session1h: readonly CanvasClosedBar[];
  priorDay1d: readonly CanvasClosedBar[];
  snapshot: ReconstructionSnapshot | null;
  htfCloseCount: number;
}>;

export type ReconstructionAdvanceResult = Readonly<{
  state: ReconstructionDomainState;
  snapshot: ReconstructionSnapshot | null;
  recomputed: boolean;
}>;

export type ReconstructionWorkCounters = Readonly<{
  fullHistoryRescans: number;
  barVisitsPerClose: number;
  swingConfirmOps: number;
  sweepMapUpdates: number;
  clusterOps: number;
}>;

function emptyTfState(): TfReconstructionState {
  return {
    firstClose: null,
    latestClose: null,
    closedCount: 0,
    swingWindow: [],
    swingHighs: [],
    swingLows: [],
    lastSweepTimeBySideKey: {},
    sweepSeedRing: [],
  };
}

function emptyAtrState(): AtrStreamState {
  return { warm: false, seedTr: [], prevClose: null, currentAtr: null, atrDelayRing: [] };
}

export function createReconstructionDomainState(): ReconstructionDomainState {
  return {
    perTf: {
      "15m": emptyTfState(),
      "1h": emptyTfState(),
      "4h": emptyTfState(),
      "1d": emptyTfState(),
    },
    atr1h: emptyAtrState(),
    session1h: [],
    priorDay1d: [],
    snapshot: null,
    htfCloseCount: 0,
  };
}

function appendRing<T>(ring: readonly T[], item: T, capacity: number): readonly T[] {
  const next = [...ring, item];
  return next.length <= capacity ? next : next.slice(next.length - capacity);
}

function formedAtMs(formedAt: string): number {
  const ms = Date.parse(formedAt);
  if (!Number.isFinite(ms)) {
    throw new Error("RECONSTRUCTION_INVALID_FORMED_AT");
  }
  return ms;
}

function isSwept(
  map: Readonly<Record<SweepKey, number>>,
  side: LiquiditySide,
  price: string,
  formedAt: string,
): boolean {
  const key: SweepKey = `${side}:${price}`;
  return (map[key] ?? Number.NEGATIVE_INFINITY) > formedAtMs(formedAt);
}

function updateSweepMap(
  map: Readonly<Record<SweepKey, number>>,
  side: LiquiditySide,
  price: string,
  barCloseTimeMs: number,
): Readonly<Record<SweepKey, number>> {
  const key: SweepKey = `${side}:${price}`;
  const prev = map[key] ?? Number.NEGATIVE_INFINITY;
  return { ...map, [key]: Math.max(prev, barCloseTimeMs) };
}

function pruneSweepKeys(tf: TfReconstructionState): TfReconstructionState {
  const pricesHigh = new Set(tf.swingHighs.map((s) => s.price));
  const pricesLow = new Set(tf.swingLows.map((s) => s.price));
  const next: Record<SweepKey, number> = {};
  for (const [key, value] of Object.entries(tf.lastSweepTimeBySideKey) as [SweepKey, number][]) {
    const [side, price] = key.split(":") as [LiquiditySide, string];
    const keep = side === "HIGH" ? pricesHigh.has(price) : pricesLow.has(price);
    if (keep) {
      next[key] = value;
    }
  }
  if (Object.keys(next).length > SWEEP_KEY_MAX) {
    const entries = Object.entries(next).slice(-SWEEP_KEY_MAX);
    return {
      ...tf,
      lastSweepTimeBySideKey: Object.fromEntries(entries) as Record<SweepKey, number>,
    };
  }
  return { ...tf, lastSweepTimeBySideKey: next };
}

function seedSweepKey(
  tf: TfReconstructionState,
  side: LiquiditySide,
  price: string,
  swingBarCloseTime: string,
): TfReconstructionState {
  const key: SweepKey = `${side}:${price}`;
  if (key in tf.lastSweepTimeBySideKey) {
    return tf;
  }
  const swingMs = Date.parse(swingBarCloseTime);
  let map = tf.lastSweepTimeBySideKey;
  for (const seedBar of tf.sweepSeedRing) {
    const seedMs = Date.parse(seedBar.barCloseTime);
    if (seedMs <= swingMs) {
      continue;
    }
    const swept = side === "HIGH" ? isHighSweepBar(price, seedBar) : isLowSweepBar(price, seedBar);
    if (swept) {
      map = updateSweepMap(map, side, price, seedMs);
    }
  }
  return { ...tf, lastSweepTimeBySideKey: map };
}

function applySweepBar(
  tf: TfReconstructionState,
  bar: CanvasClosedBar,
  counters: { sweepMapUpdates: number },
): TfReconstructionState {
  const barMs = Date.parse(bar.barCloseTime);
  let map = tf.lastSweepTimeBySideKey;
  for (const key of Object.keys(map) as SweepKey[]) {
    const [side, price] = key.split(":") as [LiquiditySide, string];
    const swept = side === "HIGH" ? isHighSweepBar(price, bar) : isLowSweepBar(price, bar);
    if (swept) {
      map = updateSweepMap(map, side, price, barMs);
      counters.sweepMapUpdates += 1;
    }
  }
  return {
    ...tf,
    lastSweepTimeBySideKey: map,
    sweepSeedRing: appendRing(tf.sweepSeedRing, bar, 3),
  };
}

function confirmSwings(
  tf: TfReconstructionState,
  bar: CanvasClosedBar,
  counters: { swingConfirmOps: number },
): TfReconstructionState {
  const swingWindow = appendRing(tf.swingWindow, bar, 5);
  let swingHighs = tf.swingHighs;
  let swingLows = tf.swingLows;
  let next = tf;

  if (swingWindow.length === 5) {
    counters.swingConfirmOps += 1;
    const { highs, lows } = detectSwingPoints(swingWindow, 2);
    for (const point of highs) {
      swingHighs = appendRing(swingHighs, point, SWING_REGISTRY_MAX);
      next = seedSweepKey(
        { ...next, swingHighs, swingLows },
        "HIGH",
        point.price,
        point.barCloseTime,
      );
    }
    for (const point of lows) {
      swingLows = appendRing(swingLows, point, SWING_REGISTRY_MAX);
      next = seedSweepKey(
        { ...next, swingHighs, swingLows },
        "LOW",
        point.price,
        point.barCloseTime,
      );
    }
    next = pruneSweepKeys({ ...next, swingWindow, swingHighs, swingLows });
  } else {
    next = { ...next, swingWindow };
  }

  return next;
}

function updateTfState(
  tf: TfReconstructionState,
  bar: CanvasClosedBar,
  counters: { swingConfirmOps: number; sweepMapUpdates: number },
): TfReconstructionState {
  let next: TfReconstructionState = {
    ...tf,
    firstClose: tf.firstClose ?? bar.close,
    latestClose: bar.close,
    closedCount: tf.closedCount + 1,
  };
  next = confirmSwings(next, bar, counters);
  next = applySweepBar(next, bar, counters);
  return next;
}

function updateAtr1h(state: AtrStreamState, bar: CanvasClosedBar): AtrStreamState {
  const tr = trueRange(bar, state.prevClose ?? bar.open);
  if (!state.warm) {
    const seedTr = [...state.seedTr, tr];
    if (seedTr.length < ATR_PERIOD) {
      return { ...state, seedTr, prevClose: bar.close };
    }
    const currentAtr = seedAtrFromTrs(seedTr, ATR_PERIOD);
    const atrDelayRing = appendRing([...state.atrDelayRing, currentAtr], currentAtr, 16).slice(-16);
    return {
      warm: true,
      seedTr: [],
      prevClose: bar.close,
      currentAtr,
      atrDelayRing,
    };
  }
  const currentAtr = wilderNextAtr(state.currentAtr!, tr, ATR_PERIOD);
  const atrDelayRing = appendRing([...state.atrDelayRing, currentAtr], currentAtr, 16).slice(-16);
  return { warm: true, seedTr: [], prevClose: bar.close, currentAtr, atrDelayRing };
}

function structureTf(state: ReconstructionDomainState): "15m" | "1h" {
  return state.perTf["1h"].closedCount >= 5 ? "1h" : "15m";
}

function assembleFromState(
  state: ReconstructionDomainState,
  oneMinuteRing: readonly CanvasClosedBar[],
  instrumentId: string,
  evaluatedAt: string,
  fusedContext?: FusedMarketContext,
): ReconstructionSnapshot {
  const selected = structureTf(state);
  const structureTfState = state.perTf[selected];

  const marketStructure = assembleMarketStructure({
    highs: structureTfState.swingHighs,
    lows: structureTfState.swingLows,
    latestClose: structureTfState.latestClose,
    priorDay: state.priorDay1d.at(-2) ?? state.priorDay1d.at(-1) ?? null,
    sessionSlice: state.session1h.slice(-24),
  });

  const liquidityStructure = assembleLiquidityStructure({
    swingHighs: marketStructure.swingHighs,
    swingLows: marketStructure.swingLows,
    isSwept: (side, price, formedAt) =>
      isSwept(structureTfState.lastSweepTimeBySideKey, side, price, formedAt),
  });

  const perTimeframeBias: Partial<Record<BarInterval, ReturnType<typeof classifyBiasFromCloses>>> =
    {};
  for (const tf of STRUCTURE_TF_KEYS) {
    const sub = state.perTf[tf];
    perTimeframeBias[tf] =
      sub.firstClose && sub.latestClose
        ? classifyBiasFromCloses(sub.firstClose, sub.latestClose, sub.closedCount)
        : "UNCLEAR";
  }

  const priorAtr = state.atr1h.atrDelayRing.length === 16 ? state.atr1h.atrDelayRing[0]! : null;
  const recentAtr = computeAtrUsdt(state.session1h.slice(-(ATR_PERIOD + 5)), ATR_PERIOD);

  return assembleReconstructionSnapshot({
    instrumentId,
    evaluatedAt,
    marketStructure,
    liquidityStructure,
    trendStructure: assembleTrendStructure({ perTimeframeBias }),
    volatilityStructure: assembleVolatilityStructure({
      atrUsdt: state.atr1h.currentAtr,
      recentAtr,
      priorAtr,
      atrPeriod: ATR_PERIOD,
    }),
    participationStructure: assembleParticipationStructure(oneMinuteRing),
    contextStructure: assembleContextStructure(fusedContext),
  });
}

export function advanceReconstruction(
  state: ReconstructionDomainState,
  closedHtfBars: readonly { interval: HtfInterval; bar: CanvasClosedBar }[],
  oneMinuteRing: readonly CanvasClosedBar[],
  evaluatedAt: string,
  fusedContext?: FusedMarketContext,
  counters?: ReconstructionWorkCounters,
): ReconstructionAdvanceResult {
  if (closedHtfBars.length === 0) {
    return { state, snapshot: state.snapshot, recomputed: false };
  }

  const work: {
    fullHistoryRescans: number;
    barVisitsPerClose: number;
    swingConfirmOps: number;
    sweepMapUpdates: number;
    clusterOps: number;
  } = counters
    ? { ...counters }
    : {
        fullHistoryRescans: 0,
        barVisitsPerClose: 0,
        swingConfirmOps: 0,
        sweepMapUpdates: 0,
        clusterOps: 0,
      };

  let next = state;
  for (const { interval, bar } of closedHtfBars) {
    work.barVisitsPerClose += 1;
    const tfKey = interval as StructureTimeframe;
    const tfState = updateTfState(next.perTf[tfKey], bar, work);
    next = {
      ...next,
      perTf: { ...next.perTf, [tfKey]: tfState },
      htfCloseCount: next.htfCloseCount + 1,
    };
    if (interval === "1h") {
      next = {
        ...next,
        atr1h: updateAtr1h(next.atr1h, bar),
        session1h: appendRing(next.session1h, bar, 24),
      };
    }
    if (interval === "1d") {
      next = { ...next, priorDay1d: appendRing(next.priorDay1d, bar, 5) };
    }
  }

  const instrumentId = oneMinuteRing[0]?.symbol ?? closedHtfBars[0]?.bar.symbol ?? "BTC/USDT";
  const snapshot = assembleFromState(next, oneMinuteRing, instrumentId, evaluatedAt, fusedContext);
  return {
    state: { ...next, snapshot },
    snapshot,
    recomputed: true,
  };
}

export function measureReconstructionStateBounds(
  state: ReconstructionDomainState,
): Record<string, number | boolean> {
  const bounds: Record<string, number | boolean> = {
    RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS: true,
  };
  for (const tf of STRUCTURE_TF_KEYS) {
    const sub = state.perTf[tf];
    bounds[`swingWindow_${tf}`] = sub.swingWindow.length;
    bounds[`swingHighs_${tf}`] = sub.swingHighs.length;
    bounds[`sweepKeys_${tf}`] = Object.keys(sub.lastSweepTimeBySideKey).length;
    if (sub.swingWindow.length > 5 || sub.swingHighs.length > SWING_REGISTRY_MAX) {
      bounds.RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS = false;
    }
    if (Object.keys(sub.lastSweepTimeBySideKey).length > SWEEP_KEY_MAX) {
      bounds.RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS = false;
    }
  }
  bounds.session1h = state.session1h.length;
  bounds.priorDay1d = state.priorDay1d.length;
  bounds.atrDelayRing = state.atr1h.atrDelayRing.length;
  if (
    state.session1h.length > 24 ||
    state.priorDay1d.length > 5 ||
    state.atr1h.atrDelayRing.length > 16
  ) {
    bounds.RECONSTRUCTION_STATE_WITHIN_DECLARED_BOUNDS = false;
  }
  return bounds;
}
