const HISTORICAL_INSTRUMENTS = new Set(["BTCUSDT", "ETHUSDT"]);

export type HistoricalInstrument = "BTCUSDT" | "ETHUSDT";

/** Canonicalizes the supported historical market identity without domain authority. */
export function normalizeHistoricalInstrument(symbol: string): HistoricalInstrument {
  const normalized = symbol.includes("/") ? symbol.replace("/", "") : symbol;
  if (HISTORICAL_INSTRUMENTS.has(normalized)) {
    return normalized as HistoricalInstrument;
  }
  throw new Error(`[htr/instrument] unsupported historical instrument: ${symbol}`);
}

export function tryNormalizeHistoricalInstrument(
  symbol: string,
): HistoricalInstrument | null {
  try {
    return normalizeHistoricalInstrument(symbol);
  } catch {
    return null;
  }
}

export function historicalInstrumentsMatch(left: string, right: string): boolean {
  const canonicalLeft = tryNormalizeHistoricalInstrument(left);
  const canonicalRight = tryNormalizeHistoricalInstrument(right);
  return canonicalLeft !== null && canonicalRight !== null && canonicalLeft === canonicalRight;
}
