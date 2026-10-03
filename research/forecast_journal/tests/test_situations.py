"""S1 reclaim timing, the 0.3 ATR stop, and the situational scorer."""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from research.forecast_journal.intraday.execute import simulate_levels
from research.forecast_journal.intraday.scorer import score_minute
from research.forecast_journal.intraday.situations import s1_arrays


def _book(n: int = 40) -> pd.DataFrame:
    high = np.full(n, 101.0)
    low = np.full(n, 99.0)
    close = np.full(n, 100.0)
    open_ = np.full(n, 100.0)
    high[10] = 105.0
    close[10] = 104.0
    high[14] = 106.0
    low[14] = 104.0
    open_[14] = 104.0
    close[14] = 105.5
    high[15] = 105.2
    low[15] = 103.0
    open_[15] = 105.4
    close[15] = 104.0
    return pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "atr_1h": np.full(n, 10.0),
            "prior_high_24": np.full(n, 110.0),
            "prior_low_24": np.full(n, 90.0),
        }
    )


class SituationTests(unittest.TestCase):
    def test_s1_reclaim_is_one_to_three_bars_and_stop_is_beyond_extreme(self) -> None:
        frame = _book()
        side, stop, target = s1_arrays(frame, wing=2)
        self.assertEqual(int(side[14]), 0)
        self.assertEqual(int(side[15]), -1)
        self.assertAlmostEqual(float(stop[15]), 106.0 + 0.3 * 10.0)
        self.assertLess(float(target[15]), 104.0)

    def test_same_bar_reclaim_does_not_fire(self) -> None:
        frame = _book()
        frame.loc[14, "close"] = 104.0
        side, _stop, _target = s1_arrays(frame, wing=2)
        self.assertEqual(int(side[14]), 0)
        self.assertEqual(int(side[15]), 0)

    def test_future_bars_do_not_change_the_reclaim(self) -> None:
        frame = _book(40)
        frame.loc[20, "high"] = 250.0
        frame.loc[21, "low"] = 10.0
        early = s1_arrays(frame.iloc[:16].reset_index(drop=True), wing=2)
        late = s1_arrays(frame, wing=2)
        self.assertEqual(int(early[0][15]), int(late[0][15]))
        self.assertAlmostEqual(float(early[1][15]), float(late[1][15]))
        self.assertAlmostEqual(float(early[2][15]), float(late[2][15]))

    def test_simulate_levels_stops_out_before_the_target_on_the_same_bar(self) -> None:
        ts = np.arange(5, dtype=np.int64) * 900 + 1_700_000_000
        frame = pd.DataFrame(
            {
                "ts": ts,
                "open": [100, 100, 100, 100, 100],
                "high": [101, 112, 101, 101, 101],
                "low": [99, 89, 99, 99, 99],
                "close": [100, 100, 100, 100, 100],
                "atr_bar": [0, 0, 0, 0, 0],
                "atr_1h": [10, 10, 10, 10, 10],
                "symbol": ["BTC"] * 5,
            }
        )
        side = np.zeros(5, dtype=np.int8)
        side[0] = -1
        stop = np.full(5, np.nan)
        target = np.full(5, np.nan)
        stop[0] = 110.0
        target[0] = 90.0
        trades = simulate_levels(frame, side, stop, target, fee=0.0005)
        self.assertEqual(len(trades), 1)
        self.assertEqual(trades[0]["first_hit"], "stop")
        self.assertLess(trades[0]["r_achieved"], 0)

    def test_scorer_does_not_fire_a_15m_pass_on_a_1m_row(self) -> None:
        features = {
            "study": "situations",
            "decision_tf": "1m",
            "price": 100.0,
            "atr_1h": 2.0,
            "atr_bar": 0.2,
            "S1_side": "long",
            "S1_stop": 98.0,
            "S1_target": 104.0,
        }
        state = {"armed": {"15m": ["S1"], "1m": []}, "reason_ru": "15m only"}
        score, side, card = score_minute(features, state=state)
        self.assertEqual(score, 0.0)
        self.assertEqual(side, "flat")
        self.assertFalse(card["actionable"])

        features["decision_tf"] = "15m"
        score, side, card = score_minute(features, state=state)
        self.assertEqual(side, "long")
        self.assertTrue(card["actionable"])
        self.assertAlmostEqual(card["stop"], 98.0)
        self.assertGreater(card["entry"], 100.0)


if __name__ == "__main__":
    unittest.main()
