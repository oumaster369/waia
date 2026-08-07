import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  barToFhvBarsV2Record,
  serializeFhvBarsV2Record,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  FHV_OFFICIAL_PARTITION_NAMES,
  FHV_OFFICIAL_SYMBOLS,
  fhvOfficialPartitionFileRelativePath,
  resolveFhvCanonicalPartitionInterval,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import type { Bar } from "@/lib/trader/intelligence/types";

export const FHV_OFFICIAL_BARS_PER_SYMBOL = 3_156_480;
export const FHV_OFFICIAL_TOTAL_BARS = 6_312_960;

function minutesBetween(startUtc: string, endUtc: string): number {
  return Math.floor((Date.parse(endUtc) - Date.parse(startUtc)) / 60_000);
}

function formatDecimal(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "") || "0";
}

function generateEconomicallyMeaningfulBar(input: {
  symbol: "BTC/USDT" | "ETH/USDT";
  openTimeMs: number;
  globalIndex: number;
}): Bar {
  const symbolSeed = input.symbol === "BTC/USDT" ? 0 : 1;
  const t = input.globalIndex;
  const base =
    input.symbol === "BTC/USDT"
      ? 20_000 + Math.sin(t / 5000) * 2000 + (t % 1000) * 0.01
      : 1500 + Math.cos(t / 4000) * 150 + (t % 800) * 0.005;
  const drift = Math.sin((t + symbolSeed * 1000) / 2500) * 0.02;
  const open = base * (1 + drift);
  const close = open * (1 + Math.sin(t / 137) * 0.003);
  const high = Math.max(open, close) * (1 + 0.001 + (t % 17) * 0.00001);
  const low = Math.min(open, close) * (1 - 0.001 - (t % 13) * 0.00001);
  const volume = 10 + (t % 100) + symbolSeed;
  const barOpenTime = new Date(input.openTimeMs).toISOString();
  const barCloseTime = new Date(input.openTimeMs + 60_000).toISOString();
  return {
    symbol: input.symbol,
    interval: "1m",
    open: formatDecimal(open),
    high: formatDecimal(high),
    low: formatDecimal(low),
    close: formatDecimal(close),
    volume: formatDecimal(volume),
    barOpenTime,
    barCloseTime,
  };
}

export function generateFhvOfficialScalePartitionFile(input: {
  datasetRoot: string;
  partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
  symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number];
  globalIndexOffset: number;
}): { barCount: number; globalIndexEnd: number } {
  const interval = resolveFhvCanonicalPartitionInterval(input.partition);
  const barCount = minutesBetween(interval.startUtc, interval.endUtc);
  const instrument = input.symbol === "BTCUSDT" ? "BTC/USDT" : "ETH/USDT";
  const relativePath = fhvOfficialPartitionFileRelativePath({
    partition: input.partition,
    symbol: input.symbol,
  });
  const absolutePath = join(input.datasetRoot, relativePath);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  let content = "";
  let openTimeMs = Date.parse(interval.startUtc);
  for (let index = 0; index < barCount; index += 1) {
    const bar = generateEconomicallyMeaningfulBar({
      symbol: instrument,
      openTimeMs,
      globalIndex: input.globalIndexOffset + index,
    });
    content += serializeFhvBarsV2Record(barToFhvBarsV2Record(bar));
    openTimeMs += 60_000;
  }
  writeFileSync(absolutePath, content, "utf8");
  return { barCount, globalIndexEnd: input.globalIndexOffset + barCount };
}

export function resolveFhvOfficialScaleGlobalIndexOffset(input: {
  partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
  symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number];
}): number {
  let offset = 0;
  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
    for (const symbol of FHV_OFFICIAL_SYMBOLS) {
      if (partition === input.partition && symbol === input.symbol) {
        return offset;
      }
      const interval = resolveFhvCanonicalPartitionInterval(partition);
      offset += minutesBetween(interval.startUtc, interval.endUtc);
    }
  }
  throw new Error(`[fhv] unknown partition/symbol: ${input.partition}/${input.symbol}`);
}

export function generateFhvOfficialScaleCorpus(datasetRoot: string): {
  totalBars: number;
  perPartition: Record<string, number>;
} {
  mkdirSync(datasetRoot, { recursive: true });
  let globalIndex = 0;
  const perPartition: Record<string, number> = {};
  let totalBars = 0;
  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
    for (const symbol of FHV_OFFICIAL_SYMBOLS) {
      const result = generateFhvOfficialScalePartitionFile({
        datasetRoot,
        partition,
        symbol,
        globalIndexOffset: globalIndex,
      });
      globalIndex = result.globalIndexEnd;
      totalBars += result.barCount;
      perPartition[`${partition}/${symbol}`] = result.barCount;
    }
  }
  return { totalBars, perPartition };
}
