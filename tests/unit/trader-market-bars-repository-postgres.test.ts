import { describe, expect, it, vi } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  insertMarketBarsPostgres,
  MARKET_BAR_INSERT_CHUNK_SIZE,
  type InsertMarketBarInput,
} from "@/lib/trader/market-data/market-bars-repository-postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_ID = "00000000-0000-4000-8000-000000027272";

type PgWriteExecutor = Pick<WaiaPostgresDb, "insert">;

type InsertCall = {
  rowCount: number;
  conflictTarget: readonly unknown[];
};

function makeBar(index: number): Bar {
  const openMs = 1_700_000_000_000 + index * 60_000;
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    barOpenTime: new Date(openMs).toISOString(),
    barCloseTime: new Date(openMs + 60_000).toISOString(),
    open: "1",
    high: "2",
    low: "0.5",
    close: "1.5",
    volume: "10",
  };
}

function makeInputs(count: number): InsertMarketBarInput[] {
  return Array.from({ length: count }, (_, index) => ({ bar: makeBar(index) }));
}

function createMockWriteExecutor(options?: { failOnCall?: number }) {
  const calls: InsertCall[] = [];
  let callIndex = 0;

  const ex = {
    insert: vi.fn(() => ({
      values: (rows: unknown[]) => ({
        onConflictDoNothing: ({ target }: { target: readonly unknown[] }) => {
          callIndex += 1;
          if (options?.failOnCall === callIndex) {
            return Promise.reject(new Error(`chunk ${callIndex} failed`));
          }
          calls.push({ rowCount: (rows as unknown[]).length, conflictTarget: target });
          return Promise.resolve();
        },
      }),
    })),
  };

  return { ex: ex as unknown as PgWriteExecutor, calls };
}

describe("insertMarketBarsPostgres chunking", () => {
  const context = requireOrgContext(ORG_ID);

  it("returns without insert for empty input", async () => {
    const { ex, calls } = createMockWriteExecutor();
    await insertMarketBarsPostgres(ex, context, []);
    expect(calls).toHaveLength(0);
    expect(ex.insert).not.toHaveBeenCalled();
  });

  it("inserts small batches in a single chunk", async () => {
    const { ex, calls } = createMockWriteExecutor();
    await insertMarketBarsPostgres(ex, context, makeInputs(50));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rowCount).toBe(50);
  });

  it("chunks large input at MARKET_BAR_INSERT_CHUNK_SIZE", async () => {
    const { ex, calls } = createMockWriteExecutor();
    await insertMarketBarsPostgres(ex, context, makeInputs(12_001));
    expect(calls).toHaveLength(13);
    expect(calls.every((call) => call.rowCount <= MARKET_BAR_INSERT_CHUNK_SIZE)).toBe(true);
    expect(calls.at(-1)?.rowCount).toBe(1);
    expect(calls.reduce((sum, call) => sum + call.rowCount, 0)).toBe(12_001);
  });

  it("uses exactly one chunk at boundary 1000 and two at 1001", async () => {
    const atBoundary = createMockWriteExecutor();
    await insertMarketBarsPostgres(atBoundary.ex, context, makeInputs(1000));
    expect(atBoundary.calls).toHaveLength(1);
    expect(atBoundary.calls[0]?.rowCount).toBe(1000);

    const overBoundary = createMockWriteExecutor();
    await insertMarketBarsPostgres(overBoundary.ex, context, makeInputs(1001));
    expect(overBoundary.calls).toHaveLength(2);
    expect(overBoundary.calls[0]?.rowCount).toBe(1000);
    expect(overBoundary.calls[1]?.rowCount).toBe(1);
  });

  it("preserves onConflictDoNothing target on every chunk", async () => {
    const { ex, calls } = createMockWriteExecutor();
    await insertMarketBarsPostgres(ex, context, makeInputs(2_500));

    const expectedTarget = [
      pgSchema.traderMarketBars.organizationId,
      pgSchema.traderMarketBars.symbol,
      pgSchema.traderMarketBars.interval,
      pgSchema.traderMarketBars.barOpenTime,
    ];

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.conflictTarget).toEqual(expectedTarget);
    }
  });

  it("propagates chunk insert failures", async () => {
    const { ex, calls } = createMockWriteExecutor({ failOnCall: 3 });
    await expect(insertMarketBarsPostgres(ex, context, makeInputs(2_500))).rejects.toThrow(
      "chunk 3 failed",
    );
    expect(calls).toHaveLength(2);
  });
});
