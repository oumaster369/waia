"""Features at t ignore every bar that was not yet closed, and labels do not leak backward."""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from research.forecast_journal.data.loader import MarketData
from research.forecast_journal.features.compute import FEATURE_COLUMNS, build_panel
from research.forecast_journal.features.labels import future_excursions


def _ohlcv(start: int, step: int, n: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(0.0004, 0.01, n)
    close = 100.0 * np.exp(np.cumsum(rets))
    open_ = np.r_[100.0, close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.random(n) * 0.002)
    low = np.minimum(open_, close) * (1 - rng.random(n) * 0.002)
    open_time = start + np.arange(n) * step
    return pd.DataFrame(
        {
            "open_time": open_time,
            "close_time": open_time + step,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": rng.random(n) * 10 + 1,
            "turnover": rng.random(n) * 1000 + 10,
            "trades": rng.integers(1, 20, n),
        }
    )


def _market(seed: int = 7) -> MarketData:
    start = 1_700_000_000
    data = MarketData()
    data.klines["BTC"] = {
        "1m": pd.DataFrame(),
        "15m": _ohlcv(start, 900, 4 * 900, seed),
        "1h": _ohlcv(start, 3600, 1000, seed + 1),
        "4h": _ohlcv(start, 14400, 260, seed + 2),
    }
    fund_ts = np.arange(start, start + 1000 * 3600, 8 * 3600)
    data.funding["BTC"] = pd.DataFrame({"ts": fund_ts, "funding_rate": np.linspace(-0.0001, 0.0002, len(fund_ts))})
    return data


class PointInTimeTests(unittest.TestCase):
    def test_future_bars_do_not_change_features(self) -> None:
        data = _market()
        panel = build_panel(data, "1h")
        self.assertGreater(len(panel), 100)
        # A decision late enough that EMA200 on 4h exists, with future bars after it.
        usable = panel.dropna(subset=["ema200_4h", "atr_4h", "atr_1h"])
        self.assertGreater(len(usable), 10)
        row = usable.iloc[len(usable) // 2]
        t = int(row["ts"])
        before = row[list(FEATURE_COLUMNS)].astype(float)

        mutated = _market()
        for tf, frame in mutated.klines["BTC"].items():
            if frame is None or frame.empty:
                continue
            future = frame["close_time"] > t
            frame.loc[future, "close"] *= 3
            frame.loc[future, "high"] *= 3
            frame.loc[future, "low"] *= 3
            frame.loc[future, "turnover"] *= 5
        mutated.funding["BTC"].loc[mutated.funding["BTC"]["ts"] > t, "funding_rate"] = 0.05
        panel2 = build_panel(mutated, "1h")
        after = panel2.loc[panel2["ts"] == t].iloc[0][list(FEATURE_COLUMNS)].astype(float)
        pd.testing.assert_series_equal(before.reset_index(drop=True), after.reset_index(drop=True), check_names=False)

    def test_excursion_uses_only_future_bars(self) -> None:
        path = _ohlcv(0, 60, 10, 1)
        # Horizon of 3 minutes → 3 bars ahead.
        table = future_excursions(path, 180)
        # At the first close, forward return is close[3] / close[0] - 1.
        self.assertAlmostEqual(table.iloc[0]["fwd_ret"], path.iloc[3]["close"] / path.iloc[0]["close"] - 1, places=8)
        self.assertTrue(np.isnan(table.iloc[-1]["fwd_ret"]))


if __name__ == "__main__":
    unittest.main()
