import { describe, expect, it } from "vitest";

import { fetchHtxKlineBars } from "../../scripts/trader/htx-kline-backfill";

const LIVE = process.env.WAIA_HTX_LIVE_SMOKE === "1";

describe.runIf(LIVE)("HTX candles live smoke", () => {
  it("fetches 5000 forward-paged 1m bars with no gaps", async () => {
    const bars = await fetchHtxKlineBars({
      organizationId: "00000000-0000-4000-8000-0000000272",
      internalSymbol: "BTC/USDT",
      period: "1min",
      size: 2000,
      targetBarCount: 5000,
    });

    expect(bars.length).toBeGreaterThanOrEqual(5000);

    const ids = bars
      .map((bar) => Math.floor(new Date(bar.barOpenTime).getTime() / 1000))
      .sort((a, b) => a - b);

    const gaps = ids.slice(1).filter((id, index) => id - ids[index]! > 60);
    expect(gaps).toHaveLength(0);
  }, 120_000);

  it("fetches 129600 forward-paged 1m bars (~90 days)", async () => {
    const t0 = Date.now();
    const bars = await fetchHtxKlineBars({
      organizationId: "00000000-0000-4000-8000-0000000272",
      internalSymbol: "BTC/USDT",
      period: "1min",
      size: 2000,
      targetBarCount: 129_600,
    });

    expect(bars.length).toBeGreaterThanOrEqual(129_600);

    const ids = bars
      .map((bar) => Math.floor(new Date(bar.barOpenTime).getTime() / 1000))
      .sort((a, b) => a - b);

    const spanDays = (ids.at(-1)! - ids[0]!) / 86_400;
    expect(spanDays).toBeGreaterThanOrEqual(89);

    const gaps = ids.slice(1).filter((id, index) => id - ids[index]! > 60);
    expect(gaps).toHaveLength(0);

    console.info(
      `[htx-live-smoke] 129600 pass count=${bars.length} spanDays=${spanDays.toFixed(2)} elapsedSec=${((Date.now() - t0) / 1000).toFixed(1)}`,
    );
  }, 600_000);
});
