import { z } from "zod";

import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";

const numberLike = z.union([z.number(), z.string()]);

const tickerSchema = z.object({
  status: z.string(),
  ts: z.number(),
  data: z.array(
    z.object({
      symbol: z.string(),
      open: numberLike,
      high: numberLike,
      low: numberLike,
      close: numberLike,
      amount: numberLike,
      vol: numberLike,
      bid: numberLike,
      ask: numberLike,
    }),
  ),
});

export type HtxPublicTicker = z.infer<typeof tickerSchema>["data"][number];

export async function fetchHtxPublicTickers(
  fetchImpl: typeof fetch = fetch,
  host = HTX_DEFAULT_REST_HOST,
): Promise<HtxPublicTicker[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetchImpl(`${host}/market/tickers`, { signal: controller.signal });
    if (!response.ok) throw new Error("HTX_TICKERS_HTTP");
    const parsed = tickerSchema.parse(await response.json());
    if (parsed.status !== "ok") throw new Error("HTX_TICKERS_STATUS");
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}
