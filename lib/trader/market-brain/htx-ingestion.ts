import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { P3_MARKET_BRAIN_SYMBOLS, type InstrumentId } from "@/lib/trader/intelligence/types";

export type HtxIngestionSymbolResult = {
  instrumentId: InstrumentId;
  snapshot: MarketSnapshot | null;
  ingestionError: string | null;
};

export type HtxIngestionCycleResult = {
  results: readonly HtxIngestionSymbolResult[];
  allSucceeded: boolean;
};

export type HtxIngestionCycleOptions = {
  fetchImpl?: typeof fetch;
  restHost?: string;
  symbols?: readonly InstrumentId[];
};

/**
 * Polls HTX REST for each P3 symbol (BTC/ETH spot). Deterministic symbol order (DEE-197).
 */
export async function runHtxIngestionCycle(
  options: HtxIngestionCycleOptions = {},
): Promise<HtxIngestionCycleResult> {
  const symbols = options.symbols ?? P3_MARKET_BRAIN_SYMBOLS;
  const results: HtxIngestionSymbolResult[] = [];

  for (const instrumentId of symbols) {
    try {
      const poll = new HtxBarPollSource({
        internalSymbol: instrumentId,
        fetchImpl: options.fetchImpl,
        restHost: options.restHost,
        cycleIdPrefix: `p3-${instrumentId.replace("/", "-").toLowerCase()}`,
      });
      const snapshot = await poll.fetchSnapshot();
      results.push({ instrumentId, snapshot, ingestionError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ instrumentId, snapshot: null, ingestionError: message });
    }
  }

  return {
    results,
    allSucceeded: results.every((entry) => entry.ingestionError === null),
  };
}
