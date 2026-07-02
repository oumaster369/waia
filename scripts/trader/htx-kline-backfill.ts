/**
 * RI-P7 — HTX kline backfill with paginated fetch (maps HTX klines → trader_market_bars).
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:htx:backfill -- \
 *     --org-id=<uuid> \
 *     --symbol=BTC/USDT \
 *     --period=1min \
 *     [--size=2000] \
 *     [--target-bars=43200]
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script when wired).
 */

import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { HtxRestClient, type HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import {
  computeHtxCandlesStartFromSeconds,
  fetchPaginatedHtxKlines,
} from "@/lib/trader/connectors/htx/kline-pagination";
import { HTX_MARKET_HISTORY_CANDLES_MAX_SIZE } from "@/lib/trader/connectors/htx/config";
import { BTC_USDT, type Bar, type InstrumentId } from "@/lib/trader/intelligence/types";
import { mapHtxKlinesToBars } from "@/lib/trader/market-data/htx-kline-mapper";

export type HtxKlineBackfillCliFlags = Map<string, string>;

export type HtxKlineBackfillDeps = {
  fetchImpl?: HtxFetchFn;
  insertBars?: (organizationId: string, bars: readonly Bar[]) => Promise<void>;
  log?: (message: string) => void;
};

export type HtxKlineBackfillConfig = {
  organizationId: string;
  internalSymbol: InstrumentId;
  period: string;
  /** Single-shot fetch size (legacy); ignored when targetBarCount > size. */
  size: number;
  /** Paginated backfill target (RI-P7). Default 43_200 (~30 days of 1m bars). */
  targetBarCount: number;
  restHost?: string;
};

export const DEFAULT_HTX_BACKFILL_TARGET_BARS = 43_200;

const LOG_PREFIX = "[trader:htx:backfill]";

export function printHtxKlineBackfillUsage(): void {
  console.log(`HTX kline backfill (RI-P7 paginated)

Usage:
  pnpm trader:htx:backfill -- \\
    --org-id=<uuid> \\
    [--symbol=BTC/USDT] \\
    [--period=1min] \\
    [--size=2000] \\
    [--target-bars=43200]

Environment:
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES
  WAIA_TRADER_CLI=1`);
}

export function parseHtxKlineBackfillFlags(argv: string[]): HtxKlineBackfillCliFlags {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      flags.set(body, "true");
    } else {
      flags.set(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    }
  }
  return flags;
}

export function resolveHtxKlineBackfillConfig(
  flags: HtxKlineBackfillCliFlags,
): HtxKlineBackfillConfig {
  const organizationId = flags.get("org-id")?.trim();
  if (!organizationId) {
    throw new Error(`${LOG_PREFIX} --org-id is required`);
  }

  const sizeRaw = flags.get("size") ?? "2000";
  const size = Number.parseInt(sizeRaw, 10);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`${LOG_PREFIX} --size must be a positive integer`);
  }

  const targetRaw = flags.get("target-bars") ?? String(DEFAULT_HTX_BACKFILL_TARGET_BARS);
  const targetBarCount = Number.parseInt(targetRaw, 10);
  if (!Number.isFinite(targetBarCount) || targetBarCount <= 0) {
    throw new Error(`${LOG_PREFIX} --target-bars must be a positive integer`);
  }

  return {
    organizationId,
    internalSymbol: (flags.get("symbol")?.trim() || BTC_USDT) as InstrumentId,
    period: flags.get("period")?.trim() || "1min",
    size,
    targetBarCount,
    restHost: flags.get("rest-host")?.trim(),
  };
}

export async function fetchHtxKlineBars(
  config: HtxKlineBackfillConfig,
  deps: HtxKlineBackfillDeps = {},
): Promise<Bar[]> {
  const log = deps.log ?? ((message: string) => console.info(message));
  const client = new HtxRestClient({
    apiKey: "public",
    apiSecret: "public",
    restHost: config.restHost,
    fetchImpl: deps.fetchImpl,
  });

  const htxSymbol = internalSymbolToHtx(config.internalSymbol);

  if (
    config.targetBarCount <= config.size &&
    config.targetBarCount <= HTX_MARKET_HISTORY_CANDLES_MAX_SIZE
  ) {
    const klines = await client.getMarketHistoryKline({
      symbol: htxSymbol,
      period: config.period,
      size: config.targetBarCount,
    });
    return mapHtxKlinesToBars(config.internalSymbol, klines);
  }

  const startFromSeconds = computeHtxCandlesStartFromSeconds({
    targetBarCount: config.targetBarCount,
    period: config.period,
  });

  const paginated = await fetchPaginatedHtxKlines({
    symbol: htxSymbol,
    period: config.period,
    targetBarCount: config.targetBarCount,
    batchSize: Math.min(config.size, HTX_MARKET_HISTORY_CANDLES_MAX_SIZE),
    startFromSeconds,
    log,
    fetchPage: (input) =>
      client.getMarketHistoryCandles({
        symbol: input.symbol,
        period: input.period,
        size: input.size,
        from: input.from,
      }),
  });

  return mapHtxKlinesToBars(config.internalSymbol, paginated.rows);
}

export async function runHtxKlineBackfill(
  config: HtxKlineBackfillConfig,
  deps: HtxKlineBackfillDeps = {},
): Promise<{ barCount: number }> {
  const log = deps.log ?? ((message: string) => console.info(message));
  const bars = await fetchHtxKlineBars(config, deps);

  if (bars.length === 0) {
    log(`${LOG_PREFIX} HTX returned zero klines for ${config.internalSymbol}`);
    return { barCount: 0 };
  }

  if (deps.insertBars) {
    await deps.insertBars(config.organizationId, bars);
  }

  log(
    `${LOG_PREFIX} mapped ${bars.length} bars for org=${config.organizationId} symbol=${config.internalSymbol} period=${config.period} target=${config.targetBarCount}`,
  );

  return { barCount: bars.length };
}

async function main(): Promise<void> {
  const flags = parseHtxKlineBackfillFlags(process.argv.slice(2));
  if (flags.has("help")) {
    printHtxKlineBackfillUsage();
    return;
  }

  const config = resolveHtxKlineBackfillConfig(flags);
  const { withWaiaPostgresClient } = await import("@/db/postgres-client");
  const { insertMarketBarsPostgres } =
    await import("@/lib/trader/market-data/market-bars-repository-postgres");
  const { requireOrgContext } = await import("@/lib/waia-core/scope/org-context");

  await withWaiaPostgresClient(async (_sql, db) => {
    await runHtxKlineBackfill(config, {
      insertBars: async (organizationId, bars) => {
        const context = requireOrgContext(organizationId);
        await insertMarketBarsPostgres(
          db,
          context,
          bars.map((bar) => ({ bar })),
        );
      },
    });
  });
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
