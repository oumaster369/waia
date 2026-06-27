/**
 * DEE-337 — Build pinned deterministic OHLCV replay dataset for P5 two-strategy validation.
 *
 * Usage:
 *   pnpm trader:replay:build-dataset
 *
 * Writes:
 *   tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json
 *   tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.metadata.json
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  MEAN_REVERSION_V0,
  type Bar,
  type Quote,
} from "@/lib/trader/intelligence/types";
import type { TraderFixtureFile } from "@/lib/trader/market-data/types";

export const DEE337_REPLAY_FIXTURE_PATH = path.join(
  process.cwd(),
  "tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json",
);

export const DEE337_REPLAY_FIXTURE_METADATA_PATH = path.join(
  process.cwd(),
  "tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.metadata.json",
);

export const DEE337_SCENARIO_STRATEGY_IDS = [
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0,
] as const;

const SCENARIO_FIXTURES = [
  "btcusdt-1m-mean-reversion.json",
  "btcusdt-1m-mean-reversion-exit.json",
  "btcusdt-1m-liquidity-sweep-entry.json",
  "btcusdt-1m-liquidity-sweep-exit.json",
] as const;

const NEUTRAL_PADDING_BARS = 0;
const NEUTRAL_TAIL_BARS = 0;
const BAR_MS = 60_000;
const REPLAY_T0_MS = Date.parse("2026-01-01T00:00:00.000Z");

function loadFixture(
  relativePath: string,
): TraderFixtureFile & { description?: string; symbol?: string } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader", relativePath);
  return JSON.parse(readFileSync(filePath, "utf8")) as TraderFixtureFile & {
    description?: string;
    symbol?: string;
  };
}

function neutralBar(index: number, close = "65000.00"): Bar {
  const openMs = REPLAY_T0_MS + index * BAR_MS;
  const openIso = new Date(openMs).toISOString();
  const closeIso = new Date(openMs + BAR_MS).toISOString();
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: "65010.00",
    low: "64990.00",
    close,
    volume: "12.50",
    barOpenTime: openIso,
    barCloseTime: closeIso,
  };
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

function buildReplayFixture(): TraderFixtureFile {
  const bars: Bar[] = [];

  for (let index = 0; index < NEUTRAL_PADDING_BARS; index += 1) {
    bars.push(neutralBar(index));
  }

  let cursor = NEUTRAL_PADDING_BARS;
  for (const scenarioFile of SCENARIO_FIXTURES) {
    const scenario = loadFixture(scenarioFile);
    bars.push(...reTimestampBars(scenario.bars, cursor));
    cursor += scenario.bars.length;
  }

  for (let index = 0; index < NEUTRAL_TAIL_BARS; index += 1) {
    bars.push(neutralBar(cursor + index));
  }

  const lastScenario = loadFixture(SCENARIO_FIXTURES[SCENARIO_FIXTURES.length - 1]);
  const latestQuote: Quote = {
    ...lastScenario.latestQuote,
    timestamp: bars.at(-1)!.barCloseTime,
  };

  return { bars, latestQuote };
}

function main(): void {
  const fixture = buildReplayFixture();
  const payload = {
    symbol: "BTC/USDT",
    interval: "1m",
    description:
      "DEE-337 pinned replay: neutral pad + MR entry/exit + LSR entry/exit + neutral tail (integration-test golden scenarios)",
    source:
      "tests/fixtures/trader/btcusdt-1m-{mean-reversion,mean-reversion-exit,liquidity-sweep-entry,liquidity-sweep-exit}.json",
    bars: fixture.bars,
    latestQuote: fixture.latestQuote,
  };

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(DEE337_REPLAY_FIXTURE_PATH, serialized, "utf8");

  const sha256 = createHash("sha256").update(serialized).digest("hex");
  const startBar = fixture.bars[0]!;
  const endBar = fixture.bars.at(-1)!;

  const metadata = {
    run_id: "DEE-337-p5-two-strategy",
    linear_issue: "DEE-337",
    dataset_kind: "pinned_fixture_replay",
    source: payload.source,
    symbol: "BTC/USDT",
    timeframe: "1m",
    bar_count: fixture.bars.length,
    file_path: "tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json",
    sha256,
    t_start_utc: startBar.barOpenTime,
    t_end_utc: endBar.barCloseTime,
    replay_mode: "scenario-sequence",
    scenario_order: [
      "mean_reversion_v0 entry",
      "mean_reversion_v0 exit",
      "liquidity_sweep_reversal_v0 entry",
      "liquidity_sweep_reversal_v0 exit",
    ],
    scenario_fixture_paths: SCENARIO_FIXTURES.map((file) => `tests/fixtures/trader/${file}`),
    scenario_strategy_ids: [...DEE337_SCENARIO_STRATEGY_IDS],
  };

  writeFileSync(
    DEE337_REPLAY_FIXTURE_METADATA_PATH,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  console.info(
    `[trader:replay:build-dataset] wrote ${fixture.bars.length} bars → ${DEE337_REPLAY_FIXTURE_PATH}`,
  );
  console.info(`[trader:replay:build-dataset] sha256=${sha256}`);
  console.info(
    `[trader:replay:build-dataset] range ${metadata.t_start_utc} .. ${metadata.t_end_utc}`,
  );
}

main();
