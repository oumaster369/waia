import { HTX_MARKET_HISTORY_CANDLES_MAX_SIZE } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";

export type HtxCandlesPageFetcher = (input: {
  symbol: string;
  period: string;
  size: number;
  from: number;
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
  /** Unix seconds — first bar open time to include (forward paging starts here). */
  startFromSeconds: number;
  fetchPage: HtxCandlesPageFetcher;
  log?: (message: string) => void;
};

export type FetchPaginatedHtxKlinesResult = {
  rows: HtxKlineRow[];
  pageCount: number;
};

/**
 * Fetches HTX historical candles forward in time via `/market/history/candles`
 * until targetBarCount is reached or data is exhausted.
 * Rows are deduplicated by kline id and returned ascending by id.
 */
export async function fetchPaginatedHtxKlines(
  input: FetchPaginatedHtxKlinesInput,
): Promise<FetchPaginatedHtxKlinesResult> {
  const batchSize = Math.min(
    input.batchSize ?? HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
    HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
  );
  const periodSeconds = htxPeriodToSeconds(input.period);
  const byId = new Map<number, HtxKlineRow>();
  let from = input.startFromSeconds;
  let pageCount = 0;
  let previousMaxId: number | undefined;
  let stallCount = 0;

  while (byId.size < input.targetBarCount) {
    const batch = await input.fetchPage({
      symbol: input.symbol,
      period: input.period,
      size: batchSize,
      from,
    });
    pageCount += 1;

    if (batch.length === 0) {
      input.log?.(
        `[htx] pagination stopped: empty page at from=${from} (page=${pageCount}, collected=${byId.size})`,
      );
      break;
    }

    const batchIds = batch.map((row) => row.id);
    const maxId = Math.max(...batchIds);
    const minId = Math.min(...batchIds);
    const sizeBefore = byId.size;

    for (const row of batch) {
      byId.set(row.id, row);
    }

    const addedCount = byId.size - sizeBefore;

    input.log?.(
      `[htx] pagination page=${pageCount} from=${from} count=${batch.length} minId=${minId} maxId=${maxId} collected=${byId.size}`,
    );

    if (previousMaxId !== undefined && maxId <= previousMaxId) {
      input.log?.(`[htx] pagination stopped: maxId did not advance (${maxId} <= ${previousMaxId})`);
      break;
    }
    previousMaxId = maxId;

    if (addedCount === 0) {
      stallCount += 1;
      if (stallCount >= 2) {
        input.log?.(`[htx] pagination stopped: stall at from=${from}`);
        break;
      }
    } else {
      stallCount = 0;
    }

    if (batch.length < batchSize) {
      input.log?.(`[htx] pagination stopped: short page (${batch.length} < ${batchSize})`);
      break;
    }

    from = maxId + periodSeconds;
  }

  const rows = [...byId.values()].sort((a, b) => a.id - b.id);
  return {
    rows: rows.slice(0, input.targetBarCount),
    pageCount,
  };
}

/** Compute start timestamp for a target number of bars ending near now. */
export function computeHtxCandlesStartFromSeconds(input: {
  targetBarCount: number;
  period: string;
  nowSeconds?: number;
}): number {
  const periodSeconds = htxPeriodToSeconds(input.period);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return now - input.targetBarCount * periodSeconds;
}
