import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HTX_BACKFILL_TARGET_BARS,
  parseHtxKlineBackfillFlags,
  resolveHtxKlineBackfillConfig,
  runHtxKlineBackfill,
} from "../../scripts/trader/htx-kline-backfill";
import type { HtxKlineResponse } from "@/lib/trader/connectors/htx/types";
import type { Bar } from "@/lib/trader/intelligence/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeKlineResponse(ids: number[]): HtxKlineResponse {
  return {
    status: "ok",
    ch: "market.btcusdt.kline.1min",
    ts: Date.now(),
    data: ids.map((id) => ({
      id,
      open: 1,
      close: 2,
      low: 0.5,
      high: 2.5,
      amount: 10,
      vol: 10,
      count: 5,
    })),
  };
}

describe("htx-kline-backfill CLI (RI-P7)", () => {
  it("defaults target-bars to 43200 (~30 days 1m)", () => {
    const flags = parseHtxKlineBackfillFlags(["--org-id=00000000-0000-4000-8000-0000000272"]);
    const config = resolveHtxKlineBackfillConfig(flags);
    expect(config.targetBarCount).toBe(DEFAULT_HTX_BACKFILL_TARGET_BARS);
    expect(config.size).toBe(2000);
  });

  it("accepts explicit target-bars override", () => {
    const flags = parseHtxKlineBackfillFlags([
      "--org-id=00000000-0000-4000-8000-0000000272",
      "--target-bars=129600",
    ]);
    const config = resolveHtxKlineBackfillConfig(flags);
    expect(config.targetBarCount).toBe(129_600);
  });

  it("passes full fetched bar array to insertBars for repository chunking", async () => {
    const insertBars = vi.fn<(organizationId: string, bars: readonly Bar[]) => Promise<void>>(
      async () => undefined,
    );
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const from = url.searchParams.get("from");
      const start = from ? Number.parseInt(from, 10) : 1_700_000_000;
      const ids = Array.from({ length: 1000 }, (_, index) => start + index * 60);
      return jsonResponse(makeKlineResponse(ids));
    }) as typeof fetch;

    const result = await runHtxKlineBackfill(
      {
        organizationId: "00000000-0000-4000-8000-000000027272",
        internalSymbol: "BTC/USDT",
        period: "1min",
        size: 2000,
        targetBarCount: 2500,
      },
      { fetchImpl, insertBars },
    );

    expect(result.barCount).toBe(2500);
    expect(insertBars).toHaveBeenCalledTimes(1);
    expect(insertBars.mock.calls[0]?.[1]).toHaveLength(2500);
  });
});
