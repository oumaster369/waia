import { readFileSync } from "node:fs";
import path from "node:path";

import { splitBarsThreeWay } from "@/lib/trader/market-data/research-dataset";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { TraderFixtureFile } from "@/lib/trader/market-data/types";

const SCENARIO_FIXTURES = [
  "btcusdt-1m-mean-reversion.json",
  "btcusdt-1m-mean-reversion-exit.json",
  "btcusdt-1m-liquidity-sweep-entry.json",
  "btcusdt-1m-liquidity-sweep-exit.json",
] as const;

const BAR_MS = 60_000;
const REPLAY_T0_MS = Date.parse("2026-01-01T00:00:00.000Z");

/** Matches three-way split at 230 bars: train 138 / validation 46 / blind 46. */
export const RESEARCH_INTEGRATION_BAR_COUNT = 230;

function loadScenarioBars(relativePath: string): Bar[] {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader", relativePath);
  return (JSON.parse(readFileSync(filePath, "utf8")) as TraderFixtureFile).bars;
}

function reTimestampBars(bars: readonly Bar[], startIndex: number): Bar[] {
  return bars.map((bar, offset) => {
    const openMs = REPLAY_T0_MS + (startIndex + offset) * BAR_MS;
    return {
      ...bar,
      barOpenTime: new Date(openMs).toISOString(),
      barCloseTime: new Date(openMs + BAR_MS).toISOString(),
    };
  });
}

function buildScenarioCycle(startIndex: number): Bar[] {
  const bars: Bar[] = [];
  let cursor = startIndex;
  for (const scenarioFile of SCENARIO_FIXTURES) {
    const segment = loadScenarioBars(scenarioFile);
    bars.push(...reTimestampBars(segment, cursor));
    cursor += segment.length;
  }
  return bars;
}

/** Self-contained 20-bar OOS window: plateau then cliff (TREND_BEAR + MR buy without in-sample context). */
function buildSelfContainedTrendBearOosWindow(): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < 20; index += 1) {
    const close = index < 15 ? 65_000 : 65_000 - (index - 14) * 500;
    const closeStr = close.toFixed(2);
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: closeStr,
      high: (close + 20).toFixed(2),
      low: (close - 20).toFixed(2),
      close: closeStr,
      volume: "10",
      barOpenTime: new Date(REPLAY_T0_MS + index * BAR_MS).toISOString(),
      barCloseTime: new Date(REPLAY_T0_MS + (index + 1) * BAR_MS).toISOString(),
    });
  }
  return bars;
}

/**
 * Golden scenario OHLCV for Postgres research integration tests.
 *
 * Layout is pinned to {@link RESEARCH_INTEGRATION_BAR_COUNT} so the validation
 * split contains a TREND_BEAR cliff segment (down-regime trades) plus golden
 * MR/LSR scenarios (non-trending trades) for walk-forward coverage.
 */
export function buildResearchIntegrationBars(totalBars = RESEARCH_INTEGRATION_BAR_COUNT): Bar[] {
  if (totalBars !== RESEARCH_INTEGRATION_BAR_COUNT) {
    throw new Error(
      `research integration bars require exactly ${RESEARCH_INTEGRATION_BAR_COUNT} bars (got ${totalBars})`,
    );
  }

  const splits = splitBarsThreeWay(
    Array.from({ length: totalBars }, (_, index) => ({
      symbol: "BTC/USDT" as const,
      interval: "1m" as const,
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: "1",
      barOpenTime: new Date(REPLAY_T0_MS + index * BAR_MS).toISOString(),
      barCloseTime: new Date(REPLAY_T0_MS + (index + 1) * BAR_MS).toISOString(),
    })),
  );

  const trainTarget = splits.train.length;
  const validationTarget = splits.validation.length;
  const blindTarget = splits.blind.length;

  const cycle1 = buildScenarioCycle(0);
  const cycle2 = buildScenarioCycle(cycle1.length);
  const cycle2TrainTailLength = trainTarget - cycle1.length;
  const walkForwardGoldenBars = 20;
  const walkForwardBearBars = 20;
  const validationTailLength = validationTarget - walkForwardGoldenBars - walkForwardBearBars;

  const trainPart = [...cycle1, ...cycle2.slice(0, cycle2TrainTailLength)];
  const validationPart = [
    ...cycle2.slice(cycle2TrainTailLength, cycle2TrainTailLength + walkForwardGoldenBars),
    ...buildSelfContainedTrendBearOosWindow(),
    ...cycle2.slice(
      cycle2TrainTailLength + walkForwardGoldenBars,
      cycle2TrainTailLength + walkForwardGoldenBars + validationTailLength,
    ),
  ];
  const blindPart = [
    ...loadScenarioBars("btcusdt-1m-mean-reversion-exit.json").slice(0, walkForwardGoldenBars),
    ...buildSelfContainedTrendBearOosWindow(),
    ...loadScenarioBars("btcusdt-1m-liquidity-sweep-entry.json").slice(0, validationTailLength),
  ];

  if (
    trainPart.length !== trainTarget ||
    validationPart.length !== validationTarget ||
    blindPart.length !== blindTarget
  ) {
    throw new Error(
      `[research] integration bar layout mismatch (train=${trainPart.length}/${trainTarget}, validation=${validationPart.length}/${validationTarget}, blind=${blindPart.length}/${blindTarget})`,
    );
  }

  return reTimestampBars([...trainPart, ...validationPart, ...blindPart], 0);
}
