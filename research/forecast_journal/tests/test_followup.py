"""Surprise thresholds, the release clock, and the two reward/risk gates."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from research.forecast_journal.intraday.execute import _geometry_ok, _walk, simulate_levels
from research.forecast_journal.intraday.followup import decision_index, pre_index
from research.forecast_journal.intraday.releases import load_releases, surprise_sign


def _stamp(year: int, month: int, day: int, hour: int) -> int:
    return int(datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp())


class ReleaseTests(unittest.TestCase):
    def test_nfp_threshold_is_50k_and_does_not_read_a_later_price(self) -> None:
        self.assertEqual(surprise_sign("nfp", 216.0, 170.0), 0)
        self.assertEqual(surprise_sign("nfp", 220.0, 170.0), 1)
        self.assertEqual(surprise_sign("nfp", 120.0, 170.0), -1)
        # The sign is a function of the calendar print only.
        self.assertEqual(surprise_sign("nfp", 220.0, 170.0), surprise_sign("nfp", 220.0, 170.0))

    def test_unemployment_and_cpi_keep_a_tenth_despite_float_noise(self) -> None:
        noisy = 0.1 - 1e-16
        self.assertEqual(surprise_sign("unemployment", 4.0 + noisy, 4.0), 1)
        self.assertEqual(surprise_sign("cpi", 3.0, 3.0 + noisy), -1)
        self.assertEqual(surprise_sign("unemployment", 4.05, 4.0), 0)
        self.assertEqual(surprise_sign("ism", 50.0, 48.5), 1)
        self.assertEqual(surprise_sign("ism", 50.0, 48.6), 0)

    def test_ism_calendar_matches_the_business_day_rule(self) -> None:
        stamps = {row["release_ts"] for row in load_releases() if row["indicator"] == "ism"}
        self.assertIn(_stamp(2024, 2, 1, 15), stamps)
        self.assertIn(_stamp(2025, 1, 3, 15), stamps)
        self.assertIn(_stamp(2026, 1, 5, 15), stamps)

    def test_decision_bar_opens_after_the_print(self) -> None:
        release = 1_000_000
        open_ts = np.arange(release - 120, release + 1800, 60, dtype=np.int64)
        close_ts = open_ts + 60
        pre = pre_index(close_ts, release)
        self.assertLess(int(close_ts[pre]), release)
        idx = decision_index(close_ts, open_ts, release, 15 * 60)
        self.assertIsNotNone(idx)
        self.assertGreaterEqual(int(close_ts[idx]), release + 15 * 60)
        self.assertGreaterEqual(int(open_ts[idx]), release)
        # A bar that closed after the delay but opened before the print is not the decision.
        early_open = np.asarray([release - 30], dtype=np.int64)
        early_close = np.asarray([release + 20 * 60], dtype=np.int64)
        self.assertIsNone(decision_index(early_close, early_open, release, 15 * 60))


class GateTests(unittest.TestCase):
    def test_net_rr_1_5_passes_1_3_and_fails_1_8(self) -> None:
        entry = 100.0
        stop = 90.0
        reward = 15.1 / 0.9995
        target = entry + reward
        fee = 0.0005
        risk = entry - stop
        net = reward - fee * (entry + target)
        self.assertAlmostEqual(net / risk, 1.5, places=6)
        self.assertTrue(_geometry_ok("long", entry, stop, target, 100.0, fee, min_rr=1.3))
        self.assertFalse(_geometry_ok("long", entry, stop, target, 100.0, fee, min_rr=1.8))

    def test_15m_atr_cap_skips_a_stop_the_hourly_cap_allows(self) -> None:
        ts = np.arange(6, dtype=np.int64) * 60 + 1_700_000_000
        frame = pd.DataFrame(
            {
                "ts": ts,
                "open": np.full(6, 100.0),
                "high": np.full(6, 101.0),
                "low": np.full(6, 99.0),
                "close": np.full(6, 100.0),
                "atr_bar": np.zeros(6),
                "atr_1h": np.full(6, 10.0),
                "symbol": ["BTC"] * 6,
            }
        )
        side = np.zeros(6, dtype=np.int8)
        side[0] = 1
        stop = np.full(6, np.nan)
        target = np.full(6, np.nan)
        stop[0] = 50.0
        target[0] = 200.0
        strict: dict = {}
        taken = simulate_levels(
            frame, side, stop, target, fee=0.0005,
            atr_cap=np.full(6, 10.0), max_risk_mult=2.5, min_rr=1.3, stats=strict,
        )
        self.assertEqual(strict["skipped_gate"], 1)
        self.assertEqual(len(taken), 0)
        loose: dict = {}
        taken = simulate_levels(
            frame, side, stop, target, fee=0.0005,
            atr_cap=np.full(6, 100.0), max_risk_mult=2.5, min_rr=1.3, stats=loose,
        )
        self.assertEqual(loose["skipped_gate"], 0)
        self.assertEqual(loose["taken"], 1)

    def test_hold_until_expires_before_a_later_target(self) -> None:
        ts = np.arange(6, dtype=np.int64) * 60 + 1_700_000_000
        high = np.full(6, 100.5)
        high[5] = 130.0
        trade = _walk(
            "long", 100.0, 90.0, 120.0,
            high, np.full(6, 99.0), np.full(6, 100.0), np.full(6, 100.0),
            ts, 1, 0.0005, 0.0, clock=True, hold_until_ts=int(ts[2]),
        )
        self.assertEqual(trade["first_hit"], "expiry")
        self.assertLess(int(trade["exit_ts"]), int(ts[5]))


if __name__ == "__main__":
    unittest.main()
