import { readFileSync } from "node:fs";
import path from "node:path";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { sha256File } from "@/lib/trader/backtest/replay-benchmark-harness";

export const HTR_WP22_FIXTURE_MANIFEST_SCHEMA =
  "htr-wp22-multi-position-fixture-manifest/v1" as const;

export const HTR_WP22_BTC_FIXTURE_RELATIVE_PATH =
  "tests/fixtures/trader/htr-wp22-btcusdt-1m-correctness.v1.json";
export const HTR_WP22_ETH_FIXTURE_RELATIVE_PATH =
  "tests/fixtures/trader/htr-wp22-ethusdt-1m-correctness.v1.json";
export const HTR_WP22_MULTI_POSITION_MANIFEST_RELATIVE_PATH =
  "tests/fixtures/trader/htr-wp22-multi-position-btc-eth.manifest.v1.json";

export const HTR_WP22_FIXTURE_SOURCE_AUTHORITY = "SYNTHETIC_HTR_WP22_FIXTURE_V1" as const;
export const HTR_WP22_FIXTURE_INITIAL_CASH_USDT = "100000.00" as const;
export const HTR_WP22_FIXTURE_TIME_RANGE_START = "2026-01-01T00:00:00.000Z" as const;
export const HTR_WP22_FIXTURE_TIME_RANGE_END = "2026-01-01T02:00:00.000Z" as const;

export type HtrWp22FixtureLeg = {
  symbol: "BTCUSDT" | "ETHUSDT";
  fixtureRelativePath: string;
  fileSha256: string;
  barCount: number;
};

export type HtrWp22FixtureManifest = {
  schemaVersion: typeof HTR_WP22_FIXTURE_MANIFEST_SCHEMA;
  sourceAuthority: typeof HTR_WP22_FIXTURE_SOURCE_AUTHORITY;
  initialCashUsdt: typeof HTR_WP22_FIXTURE_INITIAL_CASH_USDT;
  symbols: ["BTCUSDT", "ETHUSDT"];
  timeRange: {
    start: typeof HTR_WP22_FIXTURE_TIME_RANGE_START;
    end: typeof HTR_WP22_FIXTURE_TIME_RANGE_END;
  };
  holdoutContent: "PROHIBITED";
  htxSubstitution: "PROHIBITED";
  d11bPerformanceDatasetSubstitution: "PROHIBITED";
  legs: [HtrWp22FixtureLeg, HtrWp22FixtureLeg];
  payloadSha256?: string;
};

function resolveFixturePath(relativePath: string, cwd = process.cwd()): string {
  return path.join(cwd, relativePath);
}

function countBarsInFixture(relativePath: string, cwd = process.cwd()): number {
  const parsed = JSON.parse(readFileSync(resolveFixturePath(relativePath, cwd), "utf8")) as {
    bars?: unknown[];
  };
  return parsed.bars?.length ?? 0;
}

export function buildHtrWp22FixtureManifest(cwd = process.cwd()): HtrWp22FixtureManifest {
  const btcPath = HTR_WP22_BTC_FIXTURE_RELATIVE_PATH;
  const ethPath = HTR_WP22_ETH_FIXTURE_RELATIVE_PATH;
  const legs: [HtrWp22FixtureLeg, HtrWp22FixtureLeg] = [
    {
      symbol: "BTCUSDT",
      fixtureRelativePath: btcPath,
      fileSha256: sha256File(resolveFixturePath(btcPath, cwd)),
      barCount: countBarsInFixture(btcPath, cwd),
    },
    {
      symbol: "ETHUSDT",
      fixtureRelativePath: ethPath,
      fileSha256: sha256File(resolveFixturePath(ethPath, cwd)),
      barCount: countBarsInFixture(ethPath, cwd),
    },
  ];

  const semanticBody = {
    schemaVersion: HTR_WP22_FIXTURE_MANIFEST_SCHEMA,
    sourceAuthority: HTR_WP22_FIXTURE_SOURCE_AUTHORITY,
    initialCashUsdt: HTR_WP22_FIXTURE_INITIAL_CASH_USDT,
    symbols: ["BTCUSDT", "ETHUSDT"] as ["BTCUSDT", "ETHUSDT"],
    timeRange: {
      start: HTR_WP22_FIXTURE_TIME_RANGE_START,
      end: HTR_WP22_FIXTURE_TIME_RANGE_END,
    },
    holdoutContent: "PROHIBITED" as const,
    htxSubstitution: "PROHIBITED" as const,
    d11bPerformanceDatasetSubstitution: "PROHIBITED" as const,
    legs,
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

export function loadHtrWp22FixtureManifest(cwd = process.cwd()): HtrWp22FixtureManifest {
  const manifestPath = resolveFixturePath(HTR_WP22_MULTI_POSITION_MANIFEST_RELATIVE_PATH, cwd);
  return JSON.parse(readFileSync(manifestPath, "utf8")) as HtrWp22FixtureManifest;
}

export function verifyHtrWp22FixtureManifest(
  manifest: HtrWp22FixtureManifest,
  cwd = process.cwd(),
): boolean {
  const rebuilt = buildHtrWp22FixtureManifest(cwd);
  return (
    manifest.sourceAuthority === rebuilt.sourceAuthority &&
    manifest.initialCashUsdt === rebuilt.initialCashUsdt &&
    manifest.symbols.length === rebuilt.symbols.length &&
    manifest.symbols.every((symbol, index) => symbol === rebuilt.symbols[index]) &&
    manifest.legs.length === rebuilt.legs.length &&
    manifest.legs[0].fileSha256 === rebuilt.legs[0].fileSha256 &&
    manifest.legs[1].fileSha256 === rebuilt.legs[1].fileSha256 &&
    manifest.legs[0].barCount === rebuilt.legs[0].barCount &&
    manifest.legs[1].barCount === rebuilt.legs[1].barCount
  );
}
