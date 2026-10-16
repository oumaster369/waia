import datetime as dt
import unittest

import support
from autoexec.autostops import (
    adverse_slippage_bps,
    entries_blocked_reason,
    evaluate_equity_stops,
    note_slippage,
    record_close,
    situation_blocked,
)
from autoexec.state import fresh_state
from autoexec.timeutil import MSK, iso_week


class AutostopTest(unittest.TestCase):
    def setUp(self):
        self.now = support.WHEN
        self.cfg = support.cfg()
        self.state = fresh_state()
        self.state["day"] = "2026-10-02"
        self.state["day_start_equity"] = 10_000
        self.state["week"] = iso_week(self.now)
        self.state["week_start_equity"] = 10_000

    def test_daily_loss_halts_until_midnight(self):
        events = evaluate_equity_stops(self.state, 9_500, self.now, self.cfg)
        self.assertTrue(any(event["kind"] == "daily_stop" for event in events))
        self.assertEqual(self.state["halted_day"], "2026-10-02")
        self.assertEqual(entries_blocked_reason(self.state, self.now, 1, self.cfg), "daily_loss")
        next_day = dt.datetime(2026, 10, 3, 0, 0, tzinfo=MSK)
        evaluate_equity_stops(self.state, 9_500, next_day, self.cfg)
        self.assertIsNone(self.state["halted_day"])
        self.assertIsNone(entries_blocked_reason(self.state, next_day, 1, self.cfg))

    def test_four_losses_disable_situation_for_24h(self):
        for _ in range(3):
            record_close(self.state, "news", -1, self.now, self.cfg)
        self.assertFalse(situation_blocked(self.state, "news", self.now))
        events = record_close(self.state, "news", -1, self.now, self.cfg)
        self.assertTrue(any(event["reason"] == "situation_streak" for event in events))
        self.assertTrue(situation_blocked(self.state, "news", self.now))
        self.assertFalse(situation_blocked(self.state, "other", self.now))
        later = self.now + dt.timedelta(hours=24, seconds=1)
        self.assertFalse(situation_blocked(self.state, "news", later))

    def test_win_resets_streak(self):
        for _ in range(3):
            record_close(self.state, "news", -1, self.now, self.cfg)
        record_close(self.state, "news", 0.2, self.now, self.cfg)
        for _ in range(3):
            record_close(self.state, "news", -1, self.now, self.cfg)
        self.assertFalse(situation_blocked(self.state, "news", self.now))

    def test_weekly_drawdown_until_manual_enable(self):
        wide = support.cfg(daily_loss_stop_pct=50)
        events = evaluate_equity_stops(self.state, 9_100, self.now, wide)
        self.assertTrue(any(event.get("reason") == "weekly_drawdown" for event in events))
        self.assertTrue(self.state["halted_week"])
        self.assertEqual(entries_blocked_reason(self.state, self.now, 1, wide), "weekly_drawdown")
        from autoexec.state import manual_enable

        manual_enable(self.state, 9_100, self.now)
        self.assertFalse(self.state["halted_week"])
        self.assertIsNone(entries_blocked_reason(self.state, self.now, 1, wide))

    def test_stale_data_blocks_entries(self):
        self.assertEqual(entries_blocked_reason(self.state, self.now, 61, self.cfg), "stale_data")
        self.assertIsNone(entries_blocked_reason(self.state, self.now, 60, self.cfg))
        self.assertEqual(entries_blocked_reason(self.state, self.now, None, self.cfg), "stale_data")

    def test_slippage_switch(self):
        self.assertAlmostEqual(adverse_slippage_bps("long", 100, 100.2), 20)
        self.assertAlmostEqual(adverse_slippage_bps("short", 100, 99.8), 20)
        quiet = note_slippage(self.state, "long", 100, 100.1, self.cfg)
        self.assertIsNone(quiet)
        event = note_slippage(self.state, "long", 100, 100.2, self.cfg)
        self.assertEqual(event["reason"], "slippage")
        self.assertTrue(self.state["slippage_halt"])
        self.assertEqual(entries_blocked_reason(self.state, self.now, 1, self.cfg), "slippage")

    def test_average_r_switch(self):
        narrow = support.cfg(avg_r_window=3, min_avg_r=0.0)
        record_close(self.state, "s", -1, self.now, narrow)
        record_close(self.state, "s", -1, self.now, narrow)
        self.assertFalse(self.state["avg_r_halt"])
        events = record_close(self.state, "s", -1, self.now, narrow)
        self.assertTrue(any(event["reason"] == "avg_r" for event in events))
        self.assertTrue(self.state["avg_r_halt"])


if __name__ == "__main__":
    unittest.main()
