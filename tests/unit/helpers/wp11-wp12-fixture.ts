import { readFileSync } from "node:fs";
import path from "node:path";

import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay/provider-sidecar-types";

export function loadMeanReversionFixture(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

export function loadSidecarV1Fixture(): ReplayProviderSidecar {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/m9-provider-sidecar.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

export function loadSidecarV2Fixture(): ReplayProviderSidecar {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/m9-provider-sidecar-v2.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

export function makeSyntheticBar(index: number, overrides: Partial<Bar> = {}): Bar {
  const openMs = Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000;
  const openIso = new Date(openMs).toISOString();
  const closeIso = new Date(openMs + 60_000).toISOString();
  const close = `${65000 + index}`;
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: openIso,
    barCloseTime: closeIso,
    ...overrides,
  };
}

export function makeSyntheticBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) => makeSyntheticBar(index));
}

export function makeSyntheticBarsWithGap(missingBarCount: number): Bar[] {
  const bars = makeSyntheticBars(25);
  if (missingBarCount <= 0) {
    return bars;
  }
  const gapStartIndex = 10;
  for (let index = gapStartIndex + 1; index < bars.length; index += 1) {
    const source = bars[index]!;
    const shiftedOpenMs = Date.parse(source.barOpenTime) + missingBarCount * 60_000;
    bars[index] = {
      ...source,
      barOpenTime: new Date(shiftedOpenMs).toISOString(),
      barCloseTime: new Date(shiftedOpenMs + 60_000).toISOString(),
    };
  }
  return bars;
}

export const SYNTHETIC_SOURCE_PROVENANCE = [
  {
    sourceObjectId: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    retrieval: {
      retrievedAtUtc: "2026-01-01T00:00:00.000Z",
      method: "fixture-read",
      uri: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    },
    sourceChecksumSha256: "a".repeat(64),
  },
] as const;
