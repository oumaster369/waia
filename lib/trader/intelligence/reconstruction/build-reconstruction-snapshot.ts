import { computeAtrUsdt } from "@/lib/trader/exits/atr-estimator";
import { collectIncrementalClosedBars } from "@/lib/trader/market-data/canvas/incremental-mtf";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
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
} from "@/lib/trader/intelligence/reconstruction/reconstruction-kernel";
import {
  filterBarsByInterval,
  detectSwingPoints,
  STRUCTURE_TIMEFRAMES,
} from "@/lib/trader/intelligence/reconstruction/bar-utils";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";

const ATR_PERIOD = 14;

export type BuildReconstructionSnapshotInput = {
  bars1m: readonly Bar[];
  evaluatedAt: string;
  fusedContext?: FusedMarketContext;
};

function resolveStructureBars(bars1m: readonly Bar[]): Partial<Record<BarInterval, Bar[]>> {
  return resampleReplayMtfBars({ bars1m });
}

function closedOnlyStructureBars(bars1m: readonly Bar[]): Partial<Record<BarInterval, Bar[]>> {
  const raw = resampleReplayMtfBars({ bars1m });
  const { finalState } = collectIncrementalClosedBars(bars1m);
  const closedOnly: Partial<Record<BarInterval, Bar[]>> = {};
  for (const interval of ["15m", "1h", "4h", "1d"] as const) {
    const series = raw[interval] ?? [];
    closedOnly[interval] =
      finalState.forming[interval] && series.length > 0 ? series.slice(0, -1) : series;
  }
  return closedOnly;
}

function buildSnapshotFromStructureBars(
  input: BuildReconstructionSnapshotInput,
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot {
  const instrumentId = input.bars1m[0]?.symbol ?? "BTC/USDT";
  const marketStructure = buildMarketStructure(structureBars, input.evaluatedAt);
  const liquidityStructure = buildLiquidityStructure(marketStructure, structureBars);
  const trendStructure = buildTrendStructure(structureBars);
  const volatilityStructure = buildVolatilityStructure(structureBars);
  const participationStructure = assembleParticipationStructure(input.bars1m);
  const contextStructure = assembleContextStructure(input.fusedContext);

  return assembleReconstructionSnapshot({
    instrumentId,
    evaluatedAt: input.evaluatedAt,
    marketStructure,
    liquidityStructure,
    trendStructure,
    volatilityStructure,
    participationStructure,
    contextStructure,
  });
}

function isHighLiquiditySwept(levelPrice: string, formedAt: string, bars: readonly Bar[]): boolean {
  return bars.some((bar) => bar.barCloseTime > formedAt && isHighSweepBar(levelPrice, bar));
}

function isLowLiquiditySwept(levelPrice: string, formedAt: string, bars: readonly Bar[]): boolean {
  return bars.some((bar) => bar.barCloseTime > formedAt && isLowSweepBar(levelPrice, bar));
}

function buildMarketStructure(
  structureBars: Partial<Record<BarInterval, Bar[]>>,
  _evaluatedAt: string,
): ReconstructionSnapshot["marketStructure"] {
  const primaryBars = filterBarsByInterval(structureBars, "1h");
  const fallbackBars = filterBarsByInterval(structureBars, "15m");
  const bars = primaryBars.length >= 5 ? primaryBars : fallbackBars;
  const { highs, lows } = detectSwingPoints(bars);
  const dayBars = filterBarsByInterval(structureBars, "1d");
  const priorDay = dayBars.length >= 2 ? dayBars.at(-2) : dayBars.at(-1);
  const sessionBars = filterBarsByInterval(structureBars, "1h");
  return assembleMarketStructure({
    highs,
    lows,
    latestClose: bars.at(-1)?.close ?? null,
    priorDay: priorDay ?? null,
    sessionSlice: sessionBars.slice(-24),
  });
}

function buildLiquidityStructure(
  marketStructure: ReconstructionSnapshot["marketStructure"],
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot["liquidityStructure"] {
  const primaryBars = filterBarsByInterval(structureBars, "1h");
  const fallbackBars = filterBarsByInterval(structureBars, "15m");
  const sweepBars = primaryBars.length >= 5 ? primaryBars : fallbackBars;

  return assembleLiquidityStructure({
    swingHighs: marketStructure.swingHighs,
    swingLows: marketStructure.swingLows,
    isSwept: (side, price, formedAt) =>
      side === "HIGH"
        ? isHighLiquiditySwept(price, formedAt, sweepBars)
        : isLowLiquiditySwept(price, formedAt, sweepBars),
  });
}

function buildTrendStructure(
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot["trendStructure"] {
  const perTimeframeBias: Partial<Record<BarInterval, ReturnType<typeof classifyBiasFromCloses>>> =
    {};
  for (const tf of STRUCTURE_TIMEFRAMES) {
    const bars = filterBarsByInterval(structureBars, tf);
    perTimeframeBias[tf] =
      bars.length >= 3
        ? classifyBiasFromCloses(bars[0]!.close, bars.at(-1)!.close, bars.length)
        : "UNCLEAR";
  }
  return assembleTrendStructure({ perTimeframeBias });
}

function buildVolatilityStructure(
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot["volatilityStructure"] {
  const bars = filterBarsByInterval(structureBars, "1h");
  const atrUsdt = computeAtrUsdt(bars, ATR_PERIOD);
  const recentAtr =
    bars.length >= ATR_PERIOD + 5
      ? computeAtrUsdt(bars.slice(-(ATR_PERIOD + 5)), ATR_PERIOD)
      : null;
  const priorAtr =
    bars.length >= ATR_PERIOD + 5
      ? computeAtrUsdt(bars.slice(0, -(ATR_PERIOD + 1)), ATR_PERIOD)
      : null;
  return assembleVolatilityStructure({ atrUsdt, recentAtr, priorAtr, atrPeriod: ATR_PERIOD });
}

/**
 * Deterministic general MTF market reconstruction across six structural dimensions.
 * Never derives structure from 1m bars (1m = execution only).
 */
export function buildReconstructionSnapshot(
  input: BuildReconstructionSnapshotInput,
): ReconstructionSnapshot {
  return buildSnapshotFromStructureBars(input, resolveStructureBars(input.bars1m));
}

/** Oracle closed-prefix helper for parity (§6.2) — excludes still-forming HTF buckets. */
export function buildReconstructionSnapshotForClosedPrefix(input: {
  bars1m: readonly Bar[];
  evaluatedAt: string;
  fusedContext?: FusedMarketContext;
}): ReconstructionSnapshot {
  return buildSnapshotFromStructureBars(input, closedOnlyStructureBars(input.bars1m));
}
