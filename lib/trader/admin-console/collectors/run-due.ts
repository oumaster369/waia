import { createRequire } from "node:module";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { AlternativeMeFearGreedClient } from "@/lib/trader/connectors/alternative-me/fear-greed-client";
import type { CollectorTask } from "@/lib/trader/admin-console/collectors/run-collectors-cycle";
import {
  collectorsEnabled,
  runAdminConsoleCollectorCycle,
} from "@/lib/trader/admin-console/collectors/run-collectors-cycle";
import {
  runCollectedJob,
  type CollectorStore,
} from "@/lib/trader/admin-console/collectors/collector-store";
import {
  fearGreedRows,
  type FearGreedPoint,
} from "@/lib/trader/admin-console/collectors/fear-greed-rows";
import { fetchAdminNewsDrafts } from "@/lib/trader/admin-console/collectors/fetch-news";
import { planNewsWrite, type NewsDraft } from "@/lib/trader/admin-console/collectors/news-persist";
import { createPostgresCollectorStore } from "@/lib/trader/admin-console/collectors/postgres-store";
import {
  htxQuoteRows,
  type QuoteLatestRow,
  type QuoteMinuteRow,
} from "@/lib/trader/admin-console/collectors/quote-rows";
import { dueCollectorKeys } from "@/lib/trader/admin-console/collectors/schedule";
import {
  fetchHtxPublicTickers,
  type HtxPublicTicker,
} from "@/lib/trader/admin-console/money/htx-public-tickers";
import { fetchUsdQuoteRows } from "@/lib/trader/admin-console/money/usd-quotes";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

export type CollectorFetchers = {
  htx: () => Promise<{ tickers: readonly HtxPublicTicker[]; sourceTs: string | null }>;
  usd: () => Promise<{ latest: QuoteLatestRow[]; minute: QuoteMinuteRow[] }>;
  news: () => Promise<NewsDraft[]>;
  fearGreed: (limit: number) => Promise<FearGreedPoint[]>;
};

export function collectorTasksFor(input: {
  now: Date;
  store: CollectorStore;
  fetchers: CollectorFetchers;
}): CollectorTask[] {
  const due = new Set(dueCollectorKeys(input.now));
  const observedAt = input.now.toISOString();
  const tasks: CollectorTask[] = [];
  if (due.has("admin_market_quotes")) {
    tasks.push({
      key: "admin_market_quotes",
      run: () =>
        runCollectedJob(input.store, "admin_market_quotes", async () => {
          const snapshot = await input.fetchers.htx();
          const rows = htxQuoteRows(snapshot.tickers, { observedAt, sourceTs: snapshot.sourceTs });
          await input.store.upsertQuotes(rows.latest, rows.minute);
          return rows.latest.length;
        }),
    });
  }
  if (due.has("admin_usd_quotes")) {
    tasks.push({
      key: "admin_usd_quotes",
      run: () =>
        runCollectedJob(input.store, "admin_usd_quotes", async () => {
          const rows = await input.fetchers.usd();
          await input.store.upsertQuotes(rows.latest, rows.minute);
          return rows.latest.length;
        }),
    });
  }
  if (due.has("admin_news")) {
    tasks.push({
      key: "admin_news",
      run: () =>
        runCollectedJob(input.store, "admin_news", async () => {
          const drafts = await input.fetchers.news();
          let written = 0;
          for (const draft of drafts) {
            const preview = planNewsWrite(null, draft);
            if (!preview || preview.action !== "insert") continue;
            const existing = await input.store.findNews(preview.dedupeKey);
            const write = planNewsWrite(existing, draft);
            if (!write || write.action === "unchanged") continue;
            await input.store.applyNews(write);
            written += 1;
          }
          return written;
        }),
    });
  }
  if (due.has("admin_fear_greed")) {
    tasks.push({
      key: "admin_fear_greed",
      run: () =>
        runCollectedJob(input.store, "admin_fear_greed", async () => {
          const limit = (await input.store.hasFearGreed()) ? 2 : 90;
          const points = await input.fetchers.fearGreed(limit);
          const rows = fearGreedRows(points, observedAt);
          await input.store.upsertFearGreed(rows);
          return rows.length;
        }),
    });
  }
  if (due.has("admin_retention")) {
    tasks.push({
      key: "admin_retention",
      run: () =>
        runCollectedJob(input.store, "admin_retention", () => input.store.retain(input.now)),
    });
  }
  return tasks;
}

export async function runDueAdminCollectors(
  env: { WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED?: string; DATABASE_URL_POSTGRES?: string },
  options: { log?: (message: string) => void; now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<{ ran: string[]; failed: string[] }> {
  if (!collectorsEnabled(env)) {
    options.log?.("disabled");
    return { ran: [], failed: [] };
  }
  const url = env.DATABASE_URL_POSTGRES?.trim();
  if (!url) {
    options.log?.("postgres_unavailable");
    return { ran: [], failed: [] };
  }
  process.env.DATABASE_URL_POSTGRES = url;
  const runtime = createPerRequestPostgresRuntime();
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const store = createPostgresCollectorStore(runtime.db);
    const tasks = collectorTasksFor({
      now: options.now ?? new Date(),
      store,
      fetchers: {
        htx: async () => ({ tickers: await fetchHtxPublicTickers(fetchImpl), sourceTs: null }),
        usd: () => fetchUsdQuoteRows(fetchImpl, (options.now ?? new Date()).toISOString()),
        news: () => fetchAdminNewsDrafts(fetchImpl, (options.now ?? new Date()).toISOString()),
        fearGreed: (limit) => new AlternativeMeFearGreedClient({ fetchImpl }).getHistory(limit),
      },
    });
    return await runAdminConsoleCollectorCycle({ env, tasks, log: options.log });
  } finally {
    await runtime._sql.end({ timeout: 5 });
  }
}
