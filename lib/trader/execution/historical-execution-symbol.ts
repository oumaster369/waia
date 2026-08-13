const HISTORICAL_EXECUTION_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT"]);

export type HistoricalExecutionInstrument = "BTCUSDT" | "ETHUSDT";

/** Maps canonical research instrument ids to WP17 execution symbols. */
export function normalizeSymbolForHistoricalExecution(
  symbol: string,
): HistoricalExecutionInstrument {
  const normalized = symbol.includes("/") ? symbol.replace("/", "") : symbol;
  if (HISTORICAL_EXECUTION_SYMBOLS.has(normalized)) {
    return normalized as HistoricalExecutionInstrument;
  }
  throw new Error(`[htr/wp17] unsupported historical execution symbol: ${symbol}`);
}

export function tryNormalizeSymbolForHistoricalExecution(
  symbol: string,
): HistoricalExecutionInstrument | null {
  try {
    return normalizeSymbolForHistoricalExecution(symbol);
  } catch {
    return null;
  }
}

export function historicalExecutionInstrumentsMatch(left: string, right: string): boolean {
  const canonicalLeft = tryNormalizeSymbolForHistoricalExecution(left);
  const canonicalRight = tryNormalizeSymbolForHistoricalExecution(right);
  return canonicalLeft !== null && canonicalRight !== null && canonicalLeft === canonicalRight;
}
