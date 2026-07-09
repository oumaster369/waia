import { createHash } from "node:crypto";

import { computeAtrUsdt } from "@/lib/trader/exits/atr-estimator";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import {
  classifyEffortVsResult,
  classifyTimeframeBias,
  clusterEqualLevels,
  computeRelativeVolume,
  detectSwingPoints,
  filterBarsByInterval,
  sortBarsByCloseTime,
  STRUCTURE_TIMEFRAMES,
} from "@/lib/trader/intelligence/reconstruction/bar-utils";
import {
  RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
  type LiquidityLevel,
  type ReconstructionSnapshot,
  type StructureBias,
  type VolatilityRegime,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const ATR_PERIOD = 14;

export type BuildReconstructionSnapshotInput = {
  bars1m: readonly Bar[];
  evaluatedAt: string;
  fusedContext?: FusedMarketContext;
};

function computeContentDigest(snapshot: Omit<ReconstructionSnapshot, "contentDigest">): string {
  const canonical = JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    instrumentId: snapshot.instrumentId,
    evaluatedAt: snapshot.evaluatedAt,
    marketStructure: snapshot.marketStructure,
    liquidityStructure: snapshot.liquidityStructure,
    trendStructure: snapshot.trendStructure,
    volatilityStructure: snapshot.volatilityStructure,
    participationStructure: snapshot.participationStructure,
    contextStructure: snapshot.contextStructure,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function resolveStructureBars(bars1m: readonly Bar[]): Partial<Record<BarInterval, Bar[]>> {
  return resampleReplayMtfBars({ bars1m });
}

function buildMarketStructure(
  structureBars: Partial<Record<BarInterval, Bar[]>>,
  evaluatedAt: string,
): ReconstructionSnapshot["marketStructure"] {
  const primaryBars = filterBarsByInterval(structureBars, "1h");
  const fallbackBars = filterBarsByInterval(structureBars, "15m");
  const bars = primaryBars.length >= 5 ? primaryBars : fallbackBars;
  const { highs, lows } = detectSwingPoints(bars);

  let structureBias: StructureBias = "UNCLEAR";
  if (highs.length >= 2 && lows.length >= 2) {
    const lastHigh = highs.at(-1)!;
    const prevHigh = highs.at(-2)!;
    const lastLow = lows.at(-1)!;
    const prevLow = lows.at(-2)!;
    const hh = compareDecimal(lastHigh.price, prevHigh.price) > 0;
    const ll = compareDecimal(lastLow.price, prevLow.price) < 0;
    const hl = compareDecimal(lastLow.price, prevLow.price) > 0;
    const lh = compareDecimal(lastHigh.price, prevHigh.price) < 0;
    if (hh && hl) {
      structureBias = "BULLISH";
    } else if (ll && lh) {
      structureBias = "BEARISH";
    } else {
      structureBias = "NEUTRAL";
    }
  }

  const dayBars = filterBarsByInterval(structureBars, "1d");
  const priorDay = dayBars.length >= 2 ? dayBars.at(-2) : dayBars.at(-1);
  const sessionBars = filterBarsByInterval(structureBars, "1h");
  const sessionSlice = sessionBars.slice(-24);

  const latestClose = bars.at(-1)?.close ?? null;
  const lastSwingHigh = highs.at(-1)?.price ?? null;
  const lastSwingLow = lows.at(-1)?.price ?? null;

  return {
    swingHighs: highs.slice(-5),
    swingLows: lows.slice(-5),
    structureBias,
    higherHighSequence:
      highs.length >= 2 && compareDecimal(highs.at(-1)!.price, highs.at(-2)!.price) > 0,
    lowerLowSequence:
      lows.length >= 2 && compareDecimal(lows.at(-1)!.price, lows.at(-2)!.price) < 0,
    priorDayHigh: priorDay?.high ?? null,
    priorDayLow: priorDay?.low ?? null,
    sessionHigh:
      sessionSlice.length > 0
        ? sessionSlice.reduce(
            (max, b) => (compareDecimal(b.high, max) > 0 ? b.high : max),
            sessionSlice[0]!.high,
          )
        : null,
    sessionLow:
      sessionSlice.length > 0
        ? sessionSlice.reduce(
            (min, b) => (compareDecimal(b.low, min) < 0 ? b.low : min),
            sessionSlice[0]!.low,
          )
        : null,
    breakOfStructure:
      latestClose !== null &&
      lastSwingHigh !== null &&
      compareDecimal(latestClose, lastSwingHigh) > 0,
    changeOfCharacter:
      latestClose !== null &&
      lastSwingLow !== null &&
      compareDecimal(latestClose, lastSwingLow) < 0,
  };
}

function resolveLevelFormedAt(
  price: string,
  swings: readonly { price: string; barCloseTime: string }[],
  tolerancePct = 0.15,
): string {
  const matches = swings.filter((swing) => {
    const base = Number(price);
    const current = Number(swing.price);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(current)) {
      return false;
    }
    const diffPct = (Math.abs(current - base) / base) * 100;
    return diffPct <= tolerancePct;
  });
  if (matches.length === 0) {
    // TODO(PR-2-debt): Equal-level clusters are built from swing prices; a missing match
    // means no contributing swing fell within tolerance (rare with current clustering).
    // The epoch fallback treats all HTF bars as post-formation — conservative, no look-ahead,
    // and does not read beyond the caller-supplied bar window. Replace with an explicit
    // deterministic formation-time resolver in a future PR if equal-level-only pools appear.
    return "1970-01-01T00:00:00.000Z";
  }
  return matches.reduce(
    (latest, swing) => (swing.barCloseTime > latest ? swing.barCloseTime : latest),
    matches[0]!.barCloseTime,
  );
}

function isHighLiquiditySwept(levelPrice: string, formedAt: string, bars: readonly Bar[]): boolean {
  for (const bar of bars) {
    if (bar.barCloseTime <= formedAt) {
      continue;
    }
    if (compareDecimal(bar.high, levelPrice) > 0 && compareDecimal(bar.close, levelPrice) < 0) {
      return true;
    }
  }
  return false;
}

function isLowLiquiditySwept(levelPrice: string, formedAt: string, bars: readonly Bar[]): boolean {
  for (const bar of bars) {
    if (bar.barCloseTime <= formedAt) {
      continue;
    }
    if (compareDecimal(bar.low, levelPrice) < 0 && compareDecimal(bar.close, levelPrice) > 0) {
      return true;
    }
  }
  return false;
}

function buildLiquidityStructure(
  marketStructure: ReconstructionSnapshot["marketStructure"],
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot["liquidityStructure"] {
  const primaryBars = filterBarsByInterval(structureBars, "1h");
  const fallbackBars = filterBarsByInterval(structureBars, "15m");
  const sweepBars = primaryBars.length >= 5 ? primaryBars : fallbackBars;

  const highPrices = marketStructure.swingHighs.map((s) => s.price);
  const lowPrices = marketStructure.swingLows.map((s) => s.price);
  const equalHighs = clusterEqualLevels(highPrices);
  const equalLows = clusterEqualLevels(lowPrices);

  const levels: LiquidityLevel[] = [
    ...equalHighs.map((cluster) => {
      const formedAt = resolveLevelFormedAt(cluster.price, marketStructure.swingHighs);
      return {
        price: cluster.price,
        kind: "EQUAL_HIGHS" as const,
        touchCount: cluster.touchCount,
        swept: isHighLiquiditySwept(cluster.price, formedAt, sweepBars),
      };
    }),
    ...equalLows.map((cluster) => {
      const formedAt = resolveLevelFormedAt(cluster.price, marketStructure.swingLows);
      return {
        price: cluster.price,
        kind: "EQUAL_LOWS" as const,
        touchCount: cluster.touchCount,
        swept: isLowLiquiditySwept(cluster.price, formedAt, sweepBars),
      };
    }),
    ...marketStructure.swingHighs.map((s) => ({
      price: s.price,
      kind: "SWING_HIGH" as const,
      touchCount: 1,
      swept: isHighLiquiditySwept(s.price, s.barCloseTime, sweepBars),
    })),
    ...marketStructure.swingLows.map((s) => ({
      price: s.price,
      kind: "SWING_LOW" as const,
      touchCount: 1,
      swept: isLowLiquiditySwept(s.price, s.barCloseTime, sweepBars),
    })),
  ];

  const sortedAbove = levels
    .filter((l) => l.kind === "EQUAL_HIGHS" || l.kind === "SWING_HIGH")
    .map((l) => l.price)
    .sort((a, b) => compareDecimal(a, b));
  const sortedBelow = levels
    .filter((l) => l.kind === "EQUAL_LOWS" || l.kind === "SWING_LOW")
    .map((l) => l.price)
    .sort((a, b) => compareDecimal(b, a));

  return {
    levels: levels.slice(0, 12),
    nearestObjectiveAbove: sortedAbove.at(-1) ?? null,
    nearestObjectiveBelow: sortedBelow.at(-1) ?? null,
    unsweptHighCount: levels.filter(
      (l) => (l.kind === "EQUAL_HIGHS" || l.kind === "SWING_HIGH") && !l.swept,
    ).length,
    unsweptLowCount: levels.filter(
      (l) => (l.kind === "EQUAL_LOWS" || l.kind === "SWING_LOW") && !l.swept,
    ).length,
  };
}

function buildTrendStructure(
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot["trendStructure"] {
  const perTimeframeBias: Partial<Record<BarInterval, StructureBias>> = {};
  for (const tf of STRUCTURE_TIMEFRAMES) {
    const bars = filterBarsByInterval(structureBars, tf);
    perTimeframeBias[tf] = classifyTimeframeBias(bars);
  }

  const biases = STRUCTURE_TIMEFRAMES.map((tf) => perTimeframeBias[tf]).filter(Boolean);
  const bullish = biases.filter((b) => b === "BULLISH").length;
  const bearish = biases.filter((b) => b === "BEARISH").length;
  let mtfAlignment: "ALIGNED" | "CONFLICTING" | "PARTIAL" | "UNCLEAR" = "UNCLEAR";
  if (bullish >= 3 && bearish === 0) {
    mtfAlignment = "ALIGNED";
  } else if (bearish >= 3 && bullish === 0) {
    mtfAlignment = "ALIGNED";
  } else if (bullish > 0 && bearish > 0) {
    mtfAlignment = "CONFLICTING";
  } else if (bullish > 0 || bearish > 0) {
    mtfAlignment = "PARTIAL";
  }

  const h1Bias = perTimeframeBias["1h"];
  let regimeBias: "TREND" | "RANGE" | "CHOP" | "UNKNOWN" = "UNKNOWN";
  if (h1Bias === "BULLISH" || h1Bias === "BEARISH") {
    regimeBias = mtfAlignment === "CONFLICTING" ? "CHOP" : "TREND";
  } else if (h1Bias === "NEUTRAL") {
    regimeBias = "RANGE";
  }

  return { perTimeframeBias, mtfAlignment, regimeBias };
}

function buildVolatilityStructure(
  structureBars: Partial<Record<BarInterval, Bar[]>>,
): ReconstructionSnapshot["volatilityStructure"] {
  const bars = filterBarsByInterval(structureBars, "1h");
  const atrUsdt = computeAtrUsdt(bars, ATR_PERIOD);
  let volatilityRegime: VolatilityRegime = "UNKNOWN";
  let expansionRatio: string | null = null;

  if (bars.length >= ATR_PERIOD + 5) {
    const recentAtr = computeAtrUsdt(bars.slice(-(ATR_PERIOD + 5)), ATR_PERIOD);
    const priorAtr = computeAtrUsdt(bars.slice(0, -(ATR_PERIOD + 1)), ATR_PERIOD);
    if (recentAtr && priorAtr && compareDecimal(priorAtr, "0") > 0) {
      const ratio = Number(recentAtr) / Number(priorAtr);
      expansionRatio = ratio.toFixed(4);
      if (ratio > 1.2) {
        volatilityRegime = "EXPANSION";
      } else if (ratio < 0.8) {
        volatilityRegime = "COMPRESSION";
      } else {
        volatilityRegime = "NORMAL";
      }
    }
  }

  return { atrUsdt, atrPeriod: ATR_PERIOD, volatilityRegime, expansionRatio };
}

function buildParticipationStructure(
  bars1m: readonly Bar[],
): ReconstructionSnapshot["participationStructure"] {
  const sorted = sortBarsByCloseTime(bars1m);
  const relativeVolume = computeRelativeVolume(sorted);
  const volumeAnomaly = relativeVolume !== null && compareDecimal(relativeVolume, "1.5") >= 0;
  return {
    relativeVolume,
    volumeAnomaly,
    effortVsResult: classifyEffortVsResult(sorted),
  };
}

function buildContextStructure(
  fusedContext?: FusedMarketContext,
): ReconstructionSnapshot["contextStructure"] {
  const fearGreed = fusedContext?.fearGreed?.payload.value;
  return {
    sessionPhase: fusedContext?.sessionPhase ?? "UNKNOWN",
    fearGreedIndex: typeof fearGreed === "number" ? fearGreed : null,
    crossVenueAgreement: fusedContext?.crossVenueTriangulation?.agreement ?? null,
    contextOnly: true,
  };
}

/**
 * Deterministic general MTF market reconstruction across six structural dimensions.
 * Never derives structure from 1m bars (1m = execution only).
 */
export function buildReconstructionSnapshot(
  input: BuildReconstructionSnapshotInput,
): ReconstructionSnapshot {
  const instrumentId = input.bars1m[0]?.symbol ?? "BTC/USDT";
  const structureBars = resolveStructureBars(input.bars1m);
  const marketStructure = buildMarketStructure(structureBars, input.evaluatedAt);
  const liquidityStructure = buildLiquidityStructure(marketStructure, structureBars);
  const trendStructure = buildTrendStructure(structureBars);
  const volatilityStructure = buildVolatilityStructure(structureBars);
  const participationStructure = buildParticipationStructure(input.bars1m);
  const contextStructure = buildContextStructure(input.fusedContext);

  const withoutDigest = {
    schemaVersion: RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
    instrumentId,
    evaluatedAt: input.evaluatedAt,
    marketStructure,
    liquidityStructure,
    trendStructure,
    volatilityStructure,
    participationStructure,
    contextStructure,
  };

  return {
    ...withoutDigest,
    contentDigest: computeContentDigest(withoutDigest),
  };
}
