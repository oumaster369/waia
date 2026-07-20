/**
 * M0.5 — Read-only dataset / regime coverage audit helper.
 *
 * Does NOT write to DB, mutate sealed datasets, or consume blind splits.
 * Fetches public HTX klines OR analyzes in-memory bars for regime distribution.
 *
 * Usage:
 *   WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server scripts/trader/audit-dataset-regime-coverage-readonly.ts
 *   ... -- --target-bars=129600 [--symbol=BTC/USDT] [--period=1min] [--json-out=path]
 */

import { writeFileSync } from "node:fs";

import { classifyRegime } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { BTC_USDT, type Bar, type Regime } from "@/lib/trader/intelligence/types";
import { evaluateMultiRegimeCoverage } from "@/lib/trader/research/regime-coverage";
import { CANONICAL_RESEARCH_REGIME_LABELS } from "@/lib/trader/research/regime-taxonomy";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { fetchHtxKlineBars, parseHtxKlineBackfillFlags } from "@/scripts/trader/htx-kline-backfill";

const LOG_PREFIX = "[trader:audit:regime-coverage]";
const SMA_WINDOW = 20;
const DEFAULT_TARGET_BARS = 129_600;

type RegimeCounts = Record<Regime, number>;

type DiversityReport = {
  capturedAt: string;
  symbol: string;
  interval: string;
  totalBars: number;
  classifiableWindows: number;
  barTimeSpan: { firstOpen: string; lastClose: string; spanDays: number };
  regimeCounts: RegimeCounts;
  regimePercent: Record<string, number>;
  canonicalRegimeCounts: Record<string, number>;
  stressEmitted: boolean;
  unreachableCanonicalRegimes: string[];
  gateBarCoverage: {
    hasNonTrendingBars: boolean;
    hasDownBars: boolean;
    satisfiesBarLevelRequirement: boolean;
    nonTrendingBarCount: number;
    downBarCount: number;
  };
  volatility: {
    realizedVol20: { min: string; p25: string; median: string; p75: string; max: string };
    highVolBarShare: number;
    lowVolBarShare: number;
  };
  trend: {
    maxConsecutiveBars: Record<string, number>;
    regimeTransitionCount: number;
  };
  reversal: {
    zscoreZeroCrossCount: number;
    zscoreSignFlipCount: number;
  };
  sideways: {
    rangePlusChopShare: number;
    chopShare: number;
    rangeShare: number;
  };
  crisisRecovery: {
    stressBarCount: number;
    panicBarCount: number;
    bearToNonBearTransitionCount: number;
    bearRecoverySegments: number;
  };
  breakout: {
    bullBreakoutCrossCount: number;
    bearBreakoutCrossCount: number;
    falseBullBreakoutCount: number;
    falseBearBreakoutCount: number;
  };
  eventDiversity: {
    measurable: false;
    reason: string;
  };
};

function emptyRegimeCounts(): RegimeCounts {
  return {
    TREND_BULL: 0,
    TREND_BEAR: 0,
    RANGE: 0,
    CHOP: 0,
    STRESS: 0,
    PANIC: 0,
    LIQUIDITY_VACUUM: 0,
    EVENT_RISK: 0,
    LOW_EDGE: 0,
    UNKNOWN: 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index]!;
}

function analyzeBars(bars: readonly Bar[]): DiversityReport {
  const regimeCounts = emptyRegimeCounts();
  const realizedVols: number[] = [];
  const zscores: string[] = [];
  let previousRegime: Regime | undefined;
  let transitionCount = 0;
  const maxConsecutive: Record<string, number> = {};
  let currentRegime: Regime | undefined;
  let currentRun = 0;

  let zscoreZeroCrossCount = 0;
  let zscoreSignFlipCount = 0;
  let previousZsign: -1 | 0 | 1 | undefined;

  let bullBreakoutCrossCount = 0;
  let bearBreakoutCrossCount = 0;
  let falseBullBreakoutCount = 0;
  let falseBearBreakoutCount = 0;
  let pendingBullBreakoutIndex: number | undefined;
  let pendingBearBreakoutIndex: number | undefined;

  let bearToNonBearTransitionCount = 0;
  let bearRecoverySegments = 0;
  let inBearRecovery = false;

  const classifiableWindows = Math.max(0, bars.length - SMA_WINDOW + 1);

  for (let index = SMA_WINDOW - 1; index < bars.length; index += 1) {
    const window = bars.slice(index - SMA_WINDOW + 1, index + 1);
    const features = computeFeatureSnapshot({
      bars: window,
      evaluatedAt: window.at(-1)!.barCloseTime,
    });
    const regime = classifyRegime(features);
    regimeCounts[regime] += 1;
    realizedVols.push(Number.parseFloat(features.features.realizedVol20));
    zscores.push(features.features.zscoreVsSma20);

    if (previousRegime !== undefined && previousRegime !== regime) {
      transitionCount += 1;
      if (
        (previousRegime === "TREND_BEAR" || previousRegime === "STRESS") &&
        regime !== "TREND_BEAR" &&
        regime !== "STRESS"
      ) {
        bearToNonBearTransitionCount += 1;
        if (!inBearRecovery) {
          bearRecoverySegments += 1;
          inBearRecovery = true;
        }
      }
      if (regime === "TREND_BEAR" || regime === "STRESS") {
        inBearRecovery = false;
      }
    }

    if (currentRegime === regime) {
      currentRun += 1;
    } else {
      if (currentRegime !== undefined) {
        maxConsecutive[currentRegime] = Math.max(maxConsecutive[currentRegime] ?? 0, currentRun);
      }
      currentRegime = regime;
      currentRun = 1;
    }
    previousRegime = regime;

    const z = features.features.zscoreVsSma20;
    const zsign: -1 | 0 | 1 = compareDecimal(z, "0") < 0 ? -1 : compareDecimal(z, "0") > 0 ? 1 : 0;
    if (previousZsign !== undefined) {
      if (previousZsign !== 0 && zsign !== 0 && previousZsign !== zsign) {
        zscoreSignFlipCount += 1;
      }
      if ((previousZsign <= 0 && zsign > 0) || (previousZsign >= 0 && zsign < 0)) {
        zscoreZeroCrossCount += 1;
      }
    }
    previousZsign = zsign;

    const prevZ = index > SMA_WINDOW - 1 ? zscores[zscores.length - 2]! : z;
    if (compareDecimal(prevZ, "2") < 0 && compareDecimal(z, "2") >= 0) {
      bullBreakoutCrossCount += 1;
      pendingBullBreakoutIndex = index;
    }
    if (compareDecimal(prevZ, "-2") > 0 && compareDecimal(z, "-2") <= 0) {
      bearBreakoutCrossCount += 1;
      pendingBearBreakoutIndex = index;
    }

    if (pendingBullBreakoutIndex !== undefined && index - pendingBullBreakoutIndex >= 5) {
      const breakoutZ = zscores[pendingBullBreakoutIndex - (SMA_WINDOW - 1)]!;
      if (compareDecimal(z, "0.5") <= 0 && compareDecimal(breakoutZ, "2") >= 0) {
        falseBullBreakoutCount += 1;
      }
      pendingBullBreakoutIndex = undefined;
    }
    if (pendingBearBreakoutIndex !== undefined && index - pendingBearBreakoutIndex >= 5) {
      const breakoutZ = zscores[pendingBearBreakoutIndex - (SMA_WINDOW - 1)]!;
      if (compareDecimal(z, "-0.5") >= 0 && compareDecimal(breakoutZ, "-2") <= 0) {
        falseBearBreakoutCount += 1;
      }
      pendingBearBreakoutIndex = undefined;
    }
  }

  if (currentRegime !== undefined) {
    maxConsecutive[currentRegime] = Math.max(maxConsecutive[currentRegime] ?? 0, currentRun);
  }

  const sortedVols = [...realizedVols].sort((a, b) => a - b);
  const medianVol = percentile(sortedVols, 0.5);
  let highVol = 0;
  let lowVol = 0;
  for (const vol of realizedVols) {
    if (vol >= medianVol * 1.5) {
      highVol += 1;
    }
    if (vol <= medianVol * 0.5) {
      lowVol += 1;
    }
  }

  const regimePercent: Record<string, number> = {};
  for (const [label, count] of Object.entries(regimeCounts)) {
    if (count > 0) {
      regimePercent[label] = Number(((count / classifiableWindows) * 100).toFixed(2));
    }
  }

  const canonicalRegimeCounts: Record<string, number> = {};
  for (const label of CANONICAL_RESEARCH_REGIME_LABELS) {
    canonicalRegimeCounts[label] = regimeCounts[label];
  }

  const unreachable = CANONICAL_RESEARCH_REGIME_LABELS.filter((label) => regimeCounts[label] === 0);

  const nonTrendingBarCount = regimeCounts.RANGE + regimeCounts.CHOP;
  const downBarCount = regimeCounts.TREND_BEAR + regimeCounts.STRESS;

  const firstOpen = bars[0]!.barOpenTime;
  const lastClose = bars.at(-1)!.barCloseTime;
  const spanMs = Date.parse(lastClose) - Date.parse(firstOpen);

  return {
    capturedAt: new Date().toISOString(),
    symbol: bars[0]?.symbol ?? BTC_USDT,
    interval: bars[0]?.interval ?? "1m",
    totalBars: bars.length,
    classifiableWindows,
    barTimeSpan: {
      firstOpen,
      lastClose,
      spanDays: Number((spanMs / 86_400_000).toFixed(2)),
    },
    regimeCounts,
    regimePercent,
    canonicalRegimeCounts,
    stressEmitted: regimeCounts.STRESS > 0,
    unreachableCanonicalRegimes: unreachable,
    gateBarCoverage: {
      hasNonTrendingBars: nonTrendingBarCount > 0,
      hasDownBars: downBarCount > 0,
      satisfiesBarLevelRequirement: nonTrendingBarCount > 0 && downBarCount > 0,
      nonTrendingBarCount,
      downBarCount,
    },
    volatility: {
      realizedVol20: {
        min: formatDecimal(parseDecimal(String(sortedVols[0] ?? 0))),
        p25: sortedVols.length ? String(percentile(sortedVols, 0.25)) : "0",
        median: String(medianVol),
        p75: sortedVols.length ? String(percentile(sortedVols, 0.75)) : "0",
        max: formatDecimal(parseDecimal(String(sortedVols.at(-1) ?? 0))),
      },
      highVolBarShare: classifiableWindows
        ? Number(((highVol / classifiableWindows) * 100).toFixed(2))
        : 0,
      lowVolBarShare: classifiableWindows
        ? Number(((lowVol / classifiableWindows) * 100).toFixed(2))
        : 0,
    },
    trend: {
      maxConsecutiveBars: maxConsecutive,
      regimeTransitionCount: transitionCount,
    },
    reversal: {
      zscoreZeroCrossCount,
      zscoreSignFlipCount,
    },
    sideways: {
      rangePlusChopShare: classifiableWindows
        ? Number(((nonTrendingBarCount / classifiableWindows) * 100).toFixed(2))
        : 0,
      chopShare: classifiableWindows
        ? Number(((regimeCounts.CHOP / classifiableWindows) * 100).toFixed(2))
        : 0,
      rangeShare: classifiableWindows
        ? Number(((regimeCounts.RANGE / classifiableWindows) * 100).toFixed(2))
        : 0,
    },
    crisisRecovery: {
      stressBarCount: regimeCounts.STRESS,
      panicBarCount: regimeCounts.PANIC,
      bearToNonBearTransitionCount,
      bearRecoverySegments,
    },
    breakout: {
      bullBreakoutCrossCount,
      bearBreakoutCrossCount,
      falseBullBreakoutCount,
      falseBearBreakoutCount,
    },
    eventDiversity: {
      measurable: false,
      reason:
        "Sealed research datasets store OHLCV bars only; trader_market_events ingestion is not bound to dataset windows (M7).",
    },
  };
}

async function main(): Promise<void> {
  const flags = parseHtxKlineBackfillFlags(process.argv.slice(2));
  const targetBars = Number.parseInt(flags.get("target-bars") ?? String(DEFAULT_TARGET_BARS), 10);
  const jsonOut = flags.get("json-out");

  console.info(
    `${LOG_PREFIX} fetching ${targetBars} public HTX klines (read-only, no DB writes)...`,
  );

  const bars = await fetchHtxKlineBars({
    organizationId: "audit-readonly",
    internalSymbol: (flags.get("symbol")?.trim() || BTC_USDT) as typeof BTC_USDT,
    period: flags.get("period")?.trim() || "1min",
    size: 2000,
    targetBarCount: targetBars,
    restHost: flags.get("rest-host")?.trim(),
  });

  console.info(`${LOG_PREFIX} fetched ${bars.length} bars`);

  const report = analyzeBars(bars);
  const gateFromBars = evaluateMultiRegimeCoverage(
    Object.entries(report.canonicalRegimeCounts)
      .filter(([, count]) => count > 0)
      .map(([label]) => label),
  );

  const payload = {
    ...report,
    gateEvaluationFromObservedBarRegimes: gateFromBars,
    notes: [
      "Proxy analysis uses current HTX public kline fetch, not Org-0 sealed digest verification.",
      "Trade-attributed gate requires countAttributedRoundTrips > 0 per regime bucket (v2), not bar presence alone.",
      "CDE v0 classifyRegime never emits STRESS; down bucket attribution depends on TREND_BEAR only.",
    ],
  };

  const json = JSON.stringify(payload, null, 2);
  if (jsonOut) {
    writeFileSync(jsonOut, json);
    console.info(`${LOG_PREFIX} wrote ${jsonOut}`);
  } else {
    console.log(json);
  }
}

main().catch((error: unknown) => {
  console.error(`${LOG_PREFIX} failed`, error);
  process.exit(1);
});
