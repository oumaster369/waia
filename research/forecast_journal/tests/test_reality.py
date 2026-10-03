"""Path-dependent fills, stops, targets, and fees."""

from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from research.forecast_journal.journal.trade import PathBars, achieved_r, expected_r, simulate_trade


def _path(rows: list[tuple]) -> PathBars:
    frame = pd.DataFrame(rows, columns=["open_time", "open", "high", "low", "close"])
    frame["close_time"] = frame["open_time"] + 60
    return PathBars.from_frame(frame, "1m")


class RealityTests(unittest.TestCase):
    def test_target_then_r_after_fees(self) -> None:
        path = _path(
            [
                (1_000, 100.5, 100.8, 99.7, 100.6),
                (1_060, 100.6, 102.2, 100.4, 102.0),
            ]
        )
        result = simulate_trade(path, 1_000, 3_600, "long", 100.0, 99.0, 102.0, 0.0005)
        self.assertTrue(result["filled"])
        self.assertEqual(result["first_hit"], "target")
        self.assertAlmostEqual(result["fill_price"], 100.0)
        self.assertAlmostEqual(result["exit_price"], 102.0)
        self.assertAlmostEqual(result["r_achieved"], achieved_r("long", 100.0, 99.0, 102.0, 0.0005))
        self.assertAlmostEqual(result["r_achieved"], 1.899, places=3)

    def test_stop_and_same_bar_conflict_prefers_stop(self) -> None:
        path = _path(
            [
                (1_000, 100.5, 100.8, 99.7, 100.6),
                (1_060, 100.2, 103.0, 98.0, 101.0),
            ]
        )
        result = simulate_trade(path, 1_000, 3_600, "long", 100.0, 99.0, 102.0, 0.0005)
        self.assertEqual(result["first_hit"], "stop")
        self.assertAlmostEqual(result["exit_price"], 99.0)
        self.assertAlmostEqual(result["r_achieved"], -1.0995, places=4)

    def test_gap_through_stop_exits_at_open(self) -> None:
        path = _path(
            [
                (1_000, 100.2, 100.4, 99.5, 100.1),
                (1_060, 98.0, 98.2, 97.5, 97.8),
            ]
        )
        result = simulate_trade(path, 1_000, 3_600, "long", 100.0, 99.0, 102.0, 0.0005)
        self.assertEqual(result["first_hit"], "stop")
        self.assertAlmostEqual(result["exit_price"], 98.0)
        self.assertLess(result["r_achieved"], -2.0)

    def test_unfilled_is_zero_r(self) -> None:
        path = _path([(1_000, 101.0, 101.5, 100.4, 101.2), (1_060, 101.2, 101.6, 100.8, 101.4)])
        result = simulate_trade(path, 1_000, 3_600, "long", 100.0, 99.0, 102.0, 0.0005)
        self.assertFalse(result["filled"])
        self.assertEqual(result["first_hit"], "unfilled")
        self.assertEqual(result["r_achieved"], 0.0)

    def test_signal_bar_is_not_reusable(self) -> None:
        # The bar that opened at 940 closed at 1000 — that is the decision bar.
        # Its low must not fill a limit that is only knowable at the close.
        path = _path(
            [
                (940, 100.0, 100.2, 90.0, 100.0),
                (1_000, 101.0, 101.2, 100.5, 101.0),
            ]
        )
        result = simulate_trade(path, 1_000, 120, "long", 95.0, 90.0, 110.0, 0.0)
        self.assertFalse(result["filled"])

    def test_expected_r_rejects_bad_geometry(self) -> None:
        self.assertTrue(np.isnan(expected_r("long", 100.0, 101.0, 102.0, 0.0005)))
        self.assertGreater(expected_r("short", 100.0, 101.0, 98.0, 0.0005), 1.0)


if __name__ == "__main__":
    unittest.main()
