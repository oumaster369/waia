import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { decimalText } from "@/lib/trader/admin-console/collectors/decimal-text";
import {
  fearGreedRows,
  type FearGreedRow,
} from "@/lib/trader/admin-console/collectors/fear-greed-rows";
import { planNewsWrite, type NewsWrite } from "@/lib/trader/admin-console/collectors/news-persist";
import {
  htxQuoteRows,
  usdQuoteRows,
  type QuoteLatestRow,
  type QuoteMinuteRow,
} from "@/lib/trader/admin-console/collectors/quote-rows";
import { collectorTasksFor } from "@/lib/trader/admin-console/collectors/run-due";
import { runAdminConsoleCollectorCycle } from "@/lib/trader/admin-console/collectors/run-collectors-cycle";
import { assertAdminConsoleSeedLocal } from "@/lib/trader/admin-console/collectors/seed-guard";
import {
  dueCollectorKeys,
  retentionCutoff,
  tasksWhenCollectorsDisabled,
} from "@/lib/trader/admin-console/collectors/schedule";
import type { CollectorStore } from "@/lib/trader/admin-console/collectors/collector-store";
import {
  installHostDiagnostics,
  reportHostFailure,
} from "@/lib/trader/admin-console/diagnostics/host";
import { incidentAfterDiagnostic } from "@/lib/trader/admin-console/diagnostics/incident-follow";
import { RssFeedClient } from "@/lib/trader/connectors/rss/rss-feed-client";
import { AlternativeMeFearGreedClient } from "@/lib/trader/connectors/alternative-me/fear-greed-client";
import { fetchUsdQuoteRows } from "@/lib/trader/admin-console/money/usd-quotes";
import type { HtxPublicTicker } from "@/lib/trader/admin-console/money/htx-public-tickers";

const observedAt = "2026-09-23T12:06:30.000Z";

function ticker(symbol: string, close: string | number): HtxPublicTicker {
  return {
    symbol,
    open: "1",
    high: "2",
    low: "0.5",
    close,
    amount: "1",
    vol: "3",
    bid: "1",
    ask: "1",
  };
}

function memoryStore(fearPresent = false): CollectorStore & {
  quotes: unknown[];
  fear: unknown[];
  news: string[];
  jobs: { jobKey: string; status: string }[];
  failTelemetry: boolean;
} {
  const store = {
    quotes: [] as unknown[],
    fear: [] as unknown[],
    news: [] as string[],
    jobs: [] as { jobKey: string; status: string }[],
    failTelemetry: false,
    async upsertQuotes(latest: readonly QuoteLatestRow[], minute: readonly QuoteMinuteRow[]) {
      store.quotes.push({ latest, minute });
    },
    async hasFearGreed() {
      return fearPresent || store.fear.length > 0;
    },
    async upsertFearGreed(rows: readonly FearGreedRow[]) {
      store.fear.push(...rows);
    },
    async findNews() {
      return null;
    },
    async applyNews(write: NewsWrite) {
      if (write.action !== "unchanged") store.news.push(write.dedupeKey);
    },
    async retain() {
      return 3;
    },
    async collectValuations() {
      return { processed: 0, blocked: 0 };
    },
    async recordJobRun(run: { jobKey: string; status: string }) {
      if (store.failTelemetry) throw new Error("telemetry down");
      store.jobs.push(run);
    },
    async recordDiagnostic() {
      if (store.failTelemetry) throw new Error("telemetry down");
    },
  };
  return store;
}

describe("admin console collector persistence", () => {
  it("stores HTX USDT last prices and minute closes without renaming them to USD", () => {
    const rows = htxQuoteRows(
      [
        ticker("btcusdt", "64000.10"),
        ticker("ethusdt", "0"),
        ticker("solusdt", "x"),
        ticker("btcusd", "1"),
      ],
      { observedAt, sourceTs: observedAt },
    );
    expect(rows.latest.map((row) => row.symbol)).toEqual(["btcusdt", "ethusdt"]);
    expect(rows.latest[0]).toMatchObject({
      quote: "USDT",
      last: "64000.1",
      priceDefinition: "last",
    });
    expect(rows.latest[1]?.last).toBe("0");
    expect(rows.minute.map((row) => row.symbol)).toEqual(["btcusdt", "ethusdt"]);
    expect(rows.minute[0]?.close).toBe("64000.1");
    expect(rows.latest.some((row) => row.symbol.includes("USD"))).toBe(false);
  });

  it("keeps a USD quote on its own symbol and source", () => {
    const rows = usdQuoteRows({
      source: "coinbase",
      observedAt,
      products: [{ symbol: "BTC-USD", last: "100", bid: null, ask: null }],
    });
    expect(rows.latest[0]).toMatchObject({
      source: "coinbase",
      symbol: "BTC-USD",
      quote: "USD",
      priceDefinition: "last",
      last: "100",
    });
    expect(decimalText("1.2300")).toBe("1.23");
    expect(decimalText(null)).toBeNull();
  });

  it("falls back from Coinbase to Kraken without inventing a missing product", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("coinbase")) return new Response("no", { status: 503 });
      return Response.json({
        error: [],
        result: {
          XXBTZUSD: {
            c: ["10"],
            b: ["9"],
            a: ["11"],
            o: "8",
            h: ["8", "12"],
            l: ["7", "7"],
            v: ["1", "2"],
          },
        },
      });
    });
    const rows = await fetchUsdQuoteRows(fetchImpl as unknown as typeof fetch, observedAt);
    expect(rows.source).toBe("kraken");
    expect(rows.latest).toEqual([
      expect.objectContaining({ symbol: "BTC-USD", last: "10", source: "kraken" }),
    ]);
  });

  it("versions a changed headline and does not merge different article ids", () => {
    const first = planNewsWrite(null, {
      source: "coindesk",
      guid: null,
      url: "https://Example.com/article?id=1&utm_source=x#top",
      title: "Bitcoin rises",
      summary: "one",
      publishedAt: null,
      observedAt,
    });
    const second = planNewsWrite(null, {
      source: "coindesk",
      guid: null,
      url: "https://example.com/article?id=2",
      title: "Bitcoin rises",
      summary: "one",
      publishedAt: null,
      observedAt,
    });
    expect(first?.action).toBe("insert");
    expect(second?.action).toBe("insert");
    if (first?.action !== "insert" || second?.action !== "insert") return;
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(first.url).toBe("https://example.com/article?id=1");
    expect(first.clusterKey).toBe(second.clusterKey);
    const changed = planNewsWrite(
      { id: "item-1", contentHash: first.version.contentHash, currentVersion: 1 },
      {
        source: "coindesk",
        guid: null,
        url: "https://example.com/article?id=1",
        title: "Bitcoin rises again",
        summary: "one",
        publishedAt: null,
        observedAt,
      },
    );
    expect(changed?.action).toBe("version");
    if (changed?.action === "version") expect(changed.version.version).toBe(2);
  });

  it("keeps a zero fear-and-greed reading and skips a point with no classification", () => {
    const rows = fearGreedRows(
      [
        {
          value: "0",
          value_classification: "Extreme Fear",
          timestamp: "1727049600",
          time_until_update: "60",
        },
        { value: "50", value_classification: "  ", timestamp: "1727049600" },
      ],
      observedAt,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 0, classification: "Extreme Fear" });
    expect(rows[0]?.nextUpdateAt).toBe("2026-09-23T12:07:30.000Z");
  });

  it("schedules quotes every minute, news every 10, fear at minute 5, and retention at minute 35", () => {
    expect(dueCollectorKeys(new Date("2026-09-23T12:06:00.000Z"))).toEqual([
      "admin_market_quotes",
      "admin_usd_quotes",
      "admin_account_valuation",
    ]);
    expect(dueCollectorKeys(new Date("2026-09-23T12:00:00.000Z"))).toContain("admin_news");
    expect(dueCollectorKeys(new Date("2026-09-23T12:05:00.000Z"))).toContain("admin_fear_greed");
    expect(dueCollectorKeys(new Date("2026-09-23T12:35:00.000Z"))).toContain("admin_retention");
    expect(
      tasksWhenCollectorsDisabled(dueCollectorKeys(new Date("2026-09-23T12:35:00.000Z"))),
    ).toEqual(["admin_retention"]);
    expect(
      tasksWhenCollectorsDisabled(dueCollectorKeys(new Date("2026-09-23T12:06:00.000Z"))),
    ).toEqual([]);
    expect(dueCollectorKeys(new Date("2026-09-23T12:05:00.000Z"))).toContain(
      "admin_account_valuation",
    );
    expect(retentionCutoff(new Date("2026-09-23T00:00:00.000Z"), 30)).toBe(
      "2026-08-24T00:00:00.000Z",
    );
  });

  it("persists due rows, continues after one collector fails, and ignores a telemetry failure", async () => {
    const store = memoryStore();
    const fear = vi.fn(async () => [
      { value: "0", value_classification: "Extreme Fear", timestamp: "1727049600" },
    ]);
    const tasks = collectorTasksFor({
      now: new Date("2026-09-23T12:05:00.000Z"),
      store,
      fetchers: {
        htx: async () => {
          throw new Error("down");
        },
        usd: async () =>
          usdQuoteRows({
            source: "coinbase",
            observedAt,
            products: [{ symbol: "ETH-USD", last: "20" }],
          }),
        news: async () => [],
        fearGreed: fear,
      },
    });
    expect(tasks.map((task) => task.key)).toEqual([
      "admin_market_quotes",
      "admin_usd_quotes",
      "admin_account_valuation",
      "admin_fear_greed",
    ]);
    const result = await runAdminConsoleCollectorCycle({
      env: { WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED: "1" },
      tasks,
    });
    expect(result.failed).toEqual(["admin_market_quotes"]);
    expect(result.ran).toEqual(["admin_usd_quotes", "admin_account_valuation", "admin_fear_greed"]);
    expect(store.quotes).toHaveLength(1);
    expect(store.fear).toEqual([expect.objectContaining({ value: 0 })]);
    expect(fear).toHaveBeenCalledWith(90);
    store.failTelemetry = true;
    const again = collectorTasksFor({
      now: new Date("2026-09-23T12:06:00.000Z"),
      store,
      fetchers: {
        htx: async () => ({ tickers: [ticker("btcusdt", "1")], sourceTs: null }),
        usd: async () => ({ latest: [], minute: [] }),
        news: async () => [],
        fearGreed: async () => [],
      },
    });
    await expect(again[0]?.run()).resolves.toBeUndefined();
  });

  it("asks for two fear-and-greed points once a row exists", async () => {
    const store = memoryStore(true);
    const fear = vi.fn(async () => []);
    const tasks = collectorTasksFor({
      now: new Date("2026-09-23T12:05:00.000Z"),
      store,
      fetchers: {
        htx: async () => ({ tickers: [], sourceTs: null }),
        usd: async () => ({ latest: [], minute: [] }),
        news: async () => [],
        fearGreed: fear,
      },
    });
    await tasks.find((task) => task.key === "admin_fear_greed")?.run();
    expect(fear).toHaveBeenCalledWith(2);
  });

  it("reads an RSS guid and leaves getLatest on its one-point URL", async () => {
    const rss = new RssFeedClient({
      fetchImpl: async () =>
        new Response(
          `<rss><channel><item><title>ETH note</title><link>https://example.com/a?id=1&amp;utm_source=z</link><guid>g-1</guid><description>body</description></item></channel></rss>`,
        ),
    });
    const items = await rss.fetchFeed("https://example.com/feed");
    expect(items[0]?.guid).toBe("g-1");
    const calls: string[] = [];
    const client = new AlternativeMeFearGreedClient({
      fetchImpl: async (url) => {
        calls.push(String(url));
        return Response.json({
          data: [{ value: "0", value_classification: "Extreme Fear", timestamp: "1" }],
        });
      },
    });
    await client.getLatest();
    await client.getHistory(90);
    expect(calls[0]).toContain("limit=1");
    expect(calls[0]).not.toContain("format=json");
    expect(calls[1]).toContain("limit=90");
  });

  it("refuses the local seed off loopback or without the flag", () => {
    expect(() => assertAdminConsoleSeedLocal({ NODE_ENV: "test" })).toThrow(
      "SEED_REFUSED:WAIA_ADMIN_CONSOLE_SEED_LOCAL",
    );
    expect(() =>
      assertAdminConsoleSeedLocal({
        NODE_ENV: "test",
        WAIA_ADMIN_CONSOLE_SEED_LOCAL: "1",
        DATABASE_URL_POSTGRES: "postgres://waia:secret@db.internal:5432/waia",
      }),
    ).toThrow("SEED_REFUSED:HOST");
    expect(
      assertAdminConsoleSeedLocal({
        NODE_ENV: "test",
        WAIA_ADMIN_CONSOLE_SEED_LOCAL: "1",
        DATABASE_URL_POSTGRES: "postgres://waia:secret@127.0.0.1:5432/waia",
      }).hostname,
    ).toBe("127.0.0.1");
  });

  it("opens a resolved incident as regressed when the same fingerprint returns", () => {
    expect(incidentAfterDiagnostic(null).status).toBe("new");
    expect(
      incidentAfterDiagnostic({ status: "resolved", occurrences: 2, stateVersion: 4 }),
    ).toMatchObject({
      status: "regressed",
      occurrences: 3,
      history: { from: "resolved", to: "regressed" },
    });
  });
});

describe("admin console host diagnostics", () => {
  it("records a process error and does not throw when the write fails", async () => {
    const target = new EventEmitter();
    const seen: unknown[] = [];
    const uninstall = installHostDiagnostics({
      service: "observation-host",
      target,
      record: async ({ error }) => {
        seen.push(error);
      },
    });
    target.emit("uncaughtException", new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(1);
    uninstall();
    await expect(
      reportHostFailure(
        async () => {
          throw new Error("db down");
        },
        "observation-host",
        new Error("boom"),
      ),
    ).resolves.toBeUndefined();
    const exit = vi.fn();
    installHostDiagnostics({
      service: "observation-host",
      target,
      exitOnUncaught: true,
      exit,
      record: async () => {
        throw new Error("db down");
      },
    });
    target.emit("uncaughtException", new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
