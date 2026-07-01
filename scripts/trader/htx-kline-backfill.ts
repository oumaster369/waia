/**
 * RI-P1 — HTX kline backfill CLI skeleton (maps HTX klines → trader_market_bars).
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:htx:backfill -- \
 *     --org-id=<uuid> \
 *     --symbol=BTC/USDT \
 *     --period=1min \
 *     --size=2000
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script when wired).
 */

import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { HtxRestClient, type HtxFetchFn } from "@/lib/trader/connectors/htx/client";
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
  size: number;
  restHost?: string;
};

const LOG_PREFIX = "[trader:htx:backfill]";

export function printHtxKlineBackfillUsage(): void {
  console.log(`HTX kline backfill (RI-P1 skeleton)

Usage:
  pnpm trader:htx:backfill -- \\
    --org-id=<uuid> \\
    [--symbol=BTC/USDT] \\
    [--period=1min] \\
    [--size=2000]

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

  return {
    organizationId,
    internalSymbol: (flags.get("symbol")?.trim() || BTC_USDT) as InstrumentId,
    period: flags.get("period")?.trim() || "1min",
    size,
    restHost: flags.get("rest-host")?.trim(),
  };
}

export async function fetchHtxKlineBars(
  config: HtxKlineBackfillConfig,
  deps: HtxKlineBackfillDeps = {},
): Promise<Bar[]> {
  const client = new HtxRestClient({
    apiKey: "public",
    apiSecret: "public",
    restHost: config.restHost,
    fetchImpl: deps.fetchImpl,
  });

  const htxSymbol = internalSymbolToHtx(config.internalSymbol);
  const klines = await client.getMarketHistoryKline({
    symbol: htxSymbol,
    period: config.period,
    size: config.size,
  });

  return mapHtxKlinesToBars(config.internalSymbol, klines);
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
    `${LOG_PREFIX} mapped ${bars.length} bars for org=${config.organizationId} symbol=${config.internalSymbol} period=${config.period}`,
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
  const { getPostgresDrizzle } = await import("@/db/postgres-client");
  const { insertMarketBarsPostgres } =
    await import("@/lib/trader/market-data/market-bars-repository-postgres");
  const { requireOrgContext } = await import("@/lib/waia-core/scope/org-context");

  const db = getPostgresDrizzle();
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
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
