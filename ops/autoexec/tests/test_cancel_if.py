import datetime as dt
import unittest

import support
from autoexec.cancel_rules import price_cancel_reason, should_cancel_pending
from autoexec.timeutil import MSK


class CancelIfTest(unittest.TestCase):
    def test_above_is_strict(self):
        self.assertIsNone(price_cancel_reason(100, 100, None))
        self.assertEqual(price_cancel_reason(100.01, 100, None), "cancel_if_last_above")

    def test_below_is_strict(self):
        self.assertIsNone(price_cancel_reason(100, None, 100))
        self.assertEqual(price_cancel_reason(99.99, None, 100), "cancel_if_last_below")

    def test_beyond_is_ignored(self):
        pos = {
            "direction": "long",
            "cancel_if_last_beyond": 95,
            "expires": "2026-10-02 18:00 MSK",
        }
        now = dt.datetime(2026, 10, 2, 12, 0, tzinfo=MSK)
        self.assertIsNone(should_cancel_pending(pos, 90, now))

    def test_expiry_cancels_without_price_rule(self):
        pos = {"expires": "2026-10-02 18:00 MSK"}
        later = dt.datetime(2026, 10, 2, 18, 1, tzinfo=MSK)
        self.assertEqual(should_cancel_pending(pos, 100, later), "expires")

    def test_both_price_rules_can_fire(self):
        self.assertEqual(price_cancel_reason(101, 100, 99), "cancel_if_last_above")
        self.assertEqual(price_cancel_reason(98, 100, 99), "cancel_if_last_below")

    def test_signoff_window_matches_expiry(self):
        pos = {
            "cancel_if_last_above": 101_000,
            "expires": "2026-10-02 18:00 MSK",
        }
        early = support.WHEN
        self.assertIsNone(should_cancel_pending(pos, 100_000, early))
        late = dt.datetime(2026, 10, 2, 18, 5, tzinfo=MSK)
        self.assertIn("expires", should_cancel_pending(pos, 100_000, late))


if __name__ == "__main__":
    unittest.main()
