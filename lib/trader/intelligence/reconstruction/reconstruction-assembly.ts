import { createHash } from "node:crypto";

import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import {
  clusterEqualLevels,
  classifyEffortVsResult,
  computeRelativeVolume,
  sortBarsByCloseTime,
} from "@/lib/trader/intelligence/reconstruction/bar-utils";
import { resolveLevelFormedAt } from "@/lib/trader/intelligence/reconstruction/reconstruction-kernel";
import {
  RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
  type LiquidityLevel,
  type ReconstructionSnapshot,
  type StructureBias,
  type SwingPoint,
  type VolatilityRegime,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export function assembleMarketStructure(input: {
  highs: readonly SwingPoint[];
  lows: readonly SwingPoint[];
  latestClose: string | null;
  priorDay: Bar | null;
  sessionSlice: readonly Bar[];
}): ReconstructionSnapshot["marketStructure"] {
  const highs = input.highs.slice(-5);
  const lows = input.lows.slice(-5);

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

  const priorDay = input.priorDay;
  const sessionSlice = input.sessionSlice;
  const latestClose = input.latestClose;
  const lastSwingHigh = highs.at(-1)?.price ?? null;
  const lastSwingLow = lows.at(-1)?.price ?? null;

  return {
    swingHighs: highs,
    swingLows: lows,
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

export function assembleLiquidityStructure(input: {
  swingHighs: readonly SwingPoint[];
  swingLows: readonly SwingPoint[];
  isSwept: (side: "HIGH" | "LOW", price: string, formedAt: string) => boolean;
}): ReconstructionSnapshot["liquidityStructure"] {
  const equalHighs = clusterEqualLevels(input.swingHighs.map((s) => s.price));
  const equalLows = clusterEqualLevels(input.swingLows.map((s) => s.price));

  const levels: LiquidityLevel[] = [
    ...equalHighs.map((cluster) => {
      const formedAt = resolveLevelFormedAt(cluster.price, input.swingHighs);
      return {
        price: cluster.price,
        kind: "EQUAL_HIGHS" as const,
        touchCount: cluster.touchCount,
        swept: input.isSwept("HIGH", cluster.price, formedAt),
      };
    }),
    ...equalLows.map((cluster) => {
      const formedAt = resolveLevelFormedAt(cluster.price, input.swingLows);
      return {
        price: cluster.price,
        kind: "EQUAL_LOWS" as const,
        touchCount: cluster.touchCount,
        swept: input.isSwept("LOW", cluster.price, formedAt),
      };
    }),
    ...input.swingHighs.map((s) => ({
      price: s.price,
      kind: "SWING_HIGH" as const,
      touchCount: 1,
      swept: input.isSwept("HIGH", s.price, s.barCloseTime),
    })),
    ...input.swingLows.map((s) => ({
      price: s.price,
      kind: "SWING_LOW" as const,
      touchCount: 1,
      swept: input.isSwept("LOW", s.price, s.barCloseTime),
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

export function assembleTrendStructure(input: {
  perTimeframeBias: Partial<Record<BarInterval, StructureBias>>;
}): ReconstructionSnapshot["trendStructure"] {
  const perTimeframeBias = input.perTimeframeBias;
  const biases = (["15m", "1h", "4h", "1d"] as const)
    .map((tf) => perTimeframeBias[tf])
    .filter(Boolean);
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

export function assembleVolatilityStructure(input: {
  atrUsdt: string | null;
  recentAtr: string | null;
  priorAtr: string | null;
  atrPeriod: number;
}): ReconstructionSnapshot["volatilityStructure"] {
  let volatilityRegime: VolatilityRegime = "UNKNOWN";
  let expansionRatio: string | null = null;

  if (input.recentAtr && input.priorAtr && compareDecimal(input.priorAtr, "0") > 0) {
    const ratio = Number(input.recentAtr) / Number(input.priorAtr);
    expansionRatio = ratio.toFixed(4);
    if (ratio > 1.2) {
      volatilityRegime = "EXPANSION";
    } else if (ratio < 0.8) {
      volatilityRegime = "COMPRESSION";
    } else {
      volatilityRegime = "NORMAL";
    }
  }

  return {
    atrUsdt: input.atrUsdt,
    atrPeriod: input.atrPeriod,
    volatilityRegime,
    expansionRatio,
  };
}

export function assembleParticipationStructure(
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

export function assembleContextStructure(
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

export function computeReconstructionContentDigest(
  withoutDigest: Omit<ReconstructionSnapshot, "contentDigest">,
): string {
  const canonical = JSON.stringify({
    schemaVersion: withoutDigest.schemaVersion,
    instrumentId: withoutDigest.instrumentId,
    evaluatedAt: withoutDigest.evaluatedAt,
    marketStructure: withoutDigest.marketStructure,
    liquidityStructure: withoutDigest.liquidityStructure,
    trendStructure: withoutDigest.trendStructure,
    volatilityStructure: withoutDigest.volatilityStructure,
    participationStructure: withoutDigest.participationStructure,
    contextStructure: withoutDigest.contextStructure,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function assembleReconstructionSnapshot(parts: {
  instrumentId: string;
  evaluatedAt: string;
  marketStructure: ReconstructionSnapshot["marketStructure"];
  liquidityStructure: ReconstructionSnapshot["liquidityStructure"];
  trendStructure: ReconstructionSnapshot["trendStructure"];
  volatilityStructure: ReconstructionSnapshot["volatilityStructure"];
  participationStructure: ReconstructionSnapshot["participationStructure"];
  contextStructure: ReconstructionSnapshot["contextStructure"];
}): ReconstructionSnapshot {
  const withoutDigest = {
    schemaVersion: RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
    ...parts,
  };
  return {
    ...withoutDigest,
    contentDigest: computeReconstructionContentDigest(withoutDigest),
  };
}
