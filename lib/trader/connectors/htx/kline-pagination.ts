import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";

export type HtxKlinePageFetcher = (input: {
  symbol: string;
  period: string;
  size: number;
  from?: number;
}) => Promise<HtxKlineRow[]>;

const PERIOD_SECONDS: Record<string, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "30min": 1800,
  "60min": 3600,
  "4hour": 14_400,
  "1day": 86_400,
};

export function htxPeriodToSeconds(period: string): number {
  const seconds = PERIOD_SECONDS[period];
  if (!seconds) {
    throw new Error(`[htx] unsupported kline period: ${period}`);
  }
  return seconds;
}

export type FetchPaginatedHtxKlinesInput = {
  symbol: string;
  period: string;
  targetBarCount: number;
  batchSize?: number;
  fetchPage: HtxKlinePageFetcher;
};

export type FetchPaginatedHtxKlinesResult = {
  rows: HtxKlineRow[];
  pageCount: number;
};

/**
 * Fetches HTX klines backwards in time until targetBarCount is reached or data is exhausted.
 * Rows are deduplicated by kline id and returned ascending by id.
 */
export async function fetchPaginatedHtxKlines(
  input: FetchPaginatedHtxKlinesInput,
): Promise<FetchPaginatedHtxKlinesResult> {
  const batchSize = input.batchSize ?? 2000;
  const periodSeconds = htxPeriodToSeconds(input.period);
  const byId = new Map<number, HtxKlineRow>();
  let from: number | undefined;
  let pageCount = 0;
  let previousOldestId: number | undefined;

  while (byId.size < input.targetBarCount) {
    const batch = await input.fetchPage({
      symbol: input.symbol,
      period: input.period,
      size: batchSize,
      from,
    });
    pageCount += 1;

    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      byId.set(row.id, row);
    }

    const oldestId = Math.min(...batch.map((row) => row.id));
    if (previousOldestId !== undefined && oldestId >= previousOldestId) {
      break;
    }
    previousOldestId = oldestId;

    if (batch.length < batchSize) {
      break;
    }

    const nextFrom = oldestId - batchSize * periodSeconds;
    if (nextFrom <= 0) {
      break;
    }
    from = nextFrom;
  }

  const rows = [...byId.values()].sort((a, b) => a.id - b.id);
  return {
    rows: rows.slice(-input.targetBarCount),
    pageCount,
  };
}
