/**
 * Generates tests/fixtures/trader/fhv-official-real-schema with correct manifest digests.
 * Run: node --import tsx scripts/trader/generate-fhv-official-real-schema-fixture.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  buildFhvDatasetManifest,
  FHV_DATASET_PARTITIONS_V1,
} from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import type { GapRecord } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";

const FIXTURE_ROOT = join(process.cwd(), "tests/fixtures/trader/fhv-official-real-schema");
const PARTITIONS = [
  { dir: "development", startUtc: FHV_DATASET_PARTITIONS_V1.development.startUtc },
  { dir: "walk-forward", startUtc: FHV_DATASET_PARTITIONS_V1.walkForward.startUtc },
  { dir: "blind-holdout", startUtc: FHV_DATASET_PARTITIONS_V1.blindHoldout.startUtc },
] as const;
const SYMBOLS = [
  { dir: "BTCUSDT", barSymbol: "BTC/USDT", price: "65000.00" },
  { dir: "ETHUSDT", barSymbol: "ETH/USDT", price: "3500.00" },
] as const;
const BAR_COUNT = 20;

function generateBars(startUtc: string, symbol: string, price: string): Bar[] {
  const bars: Bar[] = [];
  let openMs = Date.parse(startUtc);
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const barOpenTime = new Date(openMs).toISOString();
    const barCloseTime = new Date(openMs + 60_000).toISOString();
    bars.push({
      symbol,
      interval: "1m",
      open: price,
      high: price,
      low: price,
      close: price,
      volume: "1.00",
      barOpenTime,
      barCloseTime,
    });
    openMs += 60_000;
  }
  return bars;
}

function main(): void {
  const allBars: Bar[] = [];
  const gaps: GapRecord[] = [];
  let integrityResults = {
    monotonic: true,
    duplicates: false,
    outOfOrder: false,
    nonFinite: false,
    negativeVolume: false,
    invalidRelation: false,
  };
  let normalizedContentDigest = "";
  let barSetDigest = "";

  for (const partition of PARTITIONS) {
    for (const symbol of SYMBOLS) {
      const bars = generateBars(partition.startUtc, symbol.barSymbol, symbol.price);
      const integrity = assertIngestBarsIntegrity({
        bars,
        expectedSymbol: symbol.barSymbol,
        expectedInterval: "1m",
      });
      if (!integrity.ok) {
        throw new Error(
          `Fixture integrity failed for ${partition.dir}/${symbol.dir}: ${integrity.reason}`,
        );
      }
      allBars.push(...bars);
      gaps.push(...integrity.gaps);
      integrityResults = integrity.integrityResults;
      normalizedContentDigest = integrity.normalizedContentDigest;
    }
  }

  allBars.sort((left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime));
  barSetDigest = computeBarSetDigest(allBars);

  for (const partition of PARTITIONS) {
    for (const symbol of SYMBOLS) {
      const bars = generateBars(partition.startUtc, symbol.barSymbol, symbol.price);
      const outDir = join(FIXTURE_ROOT, "partitions", partition.dir, symbol.dir);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "bars.v1.json"), `${JSON.stringify({ bars }, null, 2)}\n`);
    }
  }

  const manifest = buildFhvDatasetManifest({
    sourceObjects: [
      {
        sourceObjectId: "tests/fixtures/trader/fhv-official-real-schema",
        retrieval: {
          retrievedAtUtc: "2026-01-01T00:00:00.000Z",
          method: "fixture-generate",
          uri: "tests/fixtures/trader/fhv-official-real-schema",
        },
        sourceChecksumSha256: barSetDigest,
      },
    ],
    bars: allBars,
    normalizedContentDigest,
    barSetDigest,
    integrityResults,
    gaps,
    expectedBarCount: allBars.length,
    intervalBoundaries: {
      startUtc: FHV_DATASET_PARTITIONS_V1.development.startUtc,
      endUtc: FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc,
    },
  });

  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(
    join(FIXTURE_ROOT, "fhv-dataset-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`Generated ${FIXTURE_ROOT}\n`);
  process.stdout.write(`manifestSemanticDigest=${manifest.manifestSemanticDigest}\n`);
  process.stdout.write(`barSetDigest=${manifest.barSetDigest}\n`);
}

main();
