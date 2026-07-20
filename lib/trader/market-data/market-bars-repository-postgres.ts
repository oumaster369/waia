import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq, gte, lte } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "insert">;

/** Aligns with HTX candles page size; keeps Drizzle `.values()` batches stack-safe. */
export const MARKET_BAR_INSERT_CHUNK_SIZE = 1000;

const MARKET_BAR_CONFLICT_TARGET = [
  pgSchema.traderMarketBars.organizationId,
  pgSchema.traderMarketBars.symbol,
  pgSchema.traderMarketBars.interval,
  pgSchema.traderMarketBars.barOpenTime,
] as const;

export type MarketBarRecord = Bar & {
  id: string;
  organizationId: string;
  contentDigest: string;
  ingestedAt: Date;
};

export type InsertMarketBarInput = {
  id?: string;
  bar: Bar;
  contentDigest?: string;
  ingestedAt?: Date;
};

export type ListMarketBarsQuery = {
  symbol: InstrumentId;
  interval: BarInterval;
  barOpenTimeFrom?: Date;
  barOpenTimeTo?: Date;
};

function mapRow(row: typeof pgSchema.traderMarketBars.$inferSelect): MarketBarRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    symbol: row.symbol,
    interval: row.interval as BarInterval,
    barOpenTime: row.barOpenTime.toISOString(),
    barCloseTime: row.barCloseTime.toISOString(),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    contentDigest: row.contentDigest,
    ingestedAt: row.ingestedAt,
  };
}

function toInsertRow(
  organizationId: string,
  input: InsertMarketBarInput,
): typeof pgSchema.traderMarketBars.$inferInsert {
  const contentDigest = input.contentDigest ?? computeBarContentDigest(input.bar);
  return {
    id: input.id ?? crypto.randomUUID(),
    organizationId,
    symbol: input.bar.symbol,
    interval: input.bar.interval,
    barOpenTime: new Date(input.bar.barOpenTime),
    barCloseTime: new Date(input.bar.barCloseTime),
    open: input.bar.open,
    high: input.bar.high,
    low: input.bar.low,
    close: input.bar.close,
    volume: input.bar.volume,
    contentDigest,
    ingestedAt: input.ingestedAt,
  };
}

export async function insertMarketBarsPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  inputs: readonly InsertMarketBarInput[],
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }

  const scoped = requireOrgContext(context.organizationId);

  for (let offset = 0; offset < inputs.length; offset += MARKET_BAR_INSERT_CHUNK_SIZE) {
    const chunk = inputs.slice(offset, offset + MARKET_BAR_INSERT_CHUNK_SIZE);
    const rows = chunk.map((input) => toInsertRow(scoped.organizationId, input));

    await ex
      .insert(pgSchema.traderMarketBars)
      .values(rows)
      .onConflictDoNothing({
        target: [...MARKET_BAR_CONFLICT_TARGET],
      });
  }
}

export async function listMarketBarsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListMarketBarsQuery,
): Promise<MarketBarRecord[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [
    orgScopedWhere(pgSchema.traderMarketBars.organizationId, scoped),
    eq(pgSchema.traderMarketBars.symbol, query.symbol),
    eq(pgSchema.traderMarketBars.interval, query.interval),
  ];

  if (query.barOpenTimeFrom) {
    conditions.push(gte(pgSchema.traderMarketBars.barOpenTime, query.barOpenTimeFrom));
  }
  if (query.barOpenTimeTo) {
    conditions.push(lte(pgSchema.traderMarketBars.barOpenTime, query.barOpenTimeTo));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderMarketBars)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.traderMarketBars.barOpenTime));

  return rows.map(mapRow);
}
