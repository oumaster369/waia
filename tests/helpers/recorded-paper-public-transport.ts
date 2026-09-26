/** Synthetic public HTX responses only; no delegation to network. */
export function recordedPublicTransport(now: () => number, record: (path: string) => void = () => {}) {
  return (async (input: RequestInfo | URL) => {
    const u = new URL(String(input)); record(u.pathname);
    if (u.searchParams.get("symbol") !== "btcusdt") throw new Error("FIXTURE_UNEXPECTED_SYMBOL");
    const ts = now(); let body: unknown;
    if (u.pathname === "/market/history/kline") {
      const intervals: Record<string, number> = { "1min": 60_000, "15min": 900_000, "60min": 3_600_000, "4hour": 14_400_000, "1day": 86_400_000 };
      const interval = intervals[u.searchParams.get("period")!]; if (!interval) throw new Error("FIXTURE_UNEXPECTED_INTERVAL");
      body = { status: "ok", ts, data: Array.from({ length: 25 }, (_, i) => ({ id: (Math.floor(ts / interval) * interval - i * interval) / 1000,
        open: 100, high: 102, low: 99, close: 101, amount: 2, vol: 202, count: 3 })) };
    } else if (u.pathname === "/market/detail/merged") body = { status: "ok", ts, tick: { bid: [100, 1], ask: [102, 1], close: 101 } };
    else if (u.pathname === "/market/depth") body = { status: "ok", tick: { ts, bids: [[100, 1]], asks: [[102, 1]] } };
    else if (u.pathname === "/market/history/trade") body = { status: "ok", data: [{ id: 1, price: 101, amount: 1, direction: "buy", ts }] };
    else throw new Error("FIXTURE_UNEXPECTED_ENDPOINT");
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** Admit only this disposable local lane or the exact GitHub native-proof service. */
export function assertRecordedAnalysisTestDatabase(url: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (!url) throw new Error("ISOLATED_LOOPBACK_REQUIRED");
  const u = new URL(url);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  const local = u.port === "54329" && u.username === "waia_validate" && /^\/waia_dee1121(?:_[a-z0-9]+)*$/.test(u.pathname);
  const ci = env.CI === "true" && env.WAIA_PG_INTEGRATION === "1" && env.WAIA_POSTGRES_CLI === "1" &&
    u.port === "5432" && u.username === "waia_it" && u.pathname === "/waia_it";
  if (!loopback || (!local && !ci)) throw new Error("ISOLATED_LOOPBACK_REQUIRED");
}
