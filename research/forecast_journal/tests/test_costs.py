"""Flat round-trip costs and the two stop widths that turn bp into R."""

from __future__ import annotations

import unittest

from research.forecast_journal.intraday.costs import CSV_COLUMNS, cost_in_r, r_pair


class CostTests(unittest.TestCase):
    def test_scratch_trade_loses_the_round_trip_in_r(self) -> None:
        gross, net = r_pair("long", 100.0, 99.65, 100.0, 10.0)
        self.assertAlmostEqual(gross, 0.0)
        # 10 bp on a stop that is 0.35% of price is 0.10/0.35 R.
        self.assertAlmostEqual(net, -0.10 / 0.35, places=9)
        self.assertAlmostEqual(cost_in_r(100.0, 0.35, 10.0), 0.10 / 0.35, places=9)

    def test_wider_stop_eats_fewer_r(self) -> None:
        tight = cost_in_r(100.0, 0.35, 10.0)
        wide = cost_in_r(100.0, 2.5 * 0.80, 10.0)
        self.assertGreater(tight, wide)
        self.assertAlmostEqual(wide, 0.10 / 2.0, places=9)

    def test_five_and_fifteen_scale_the_same_prices(self) -> None:
        gross, net5 = r_pair("short", 100.0, 101.0, 99.0, 5.0)
        _, net15 = r_pair("short", 100.0, 101.0, 99.0, 15.0)
        self.assertAlmostEqual(gross, 1.0)
        self.assertAlmostEqual(net5, (1.0 - 0.05) / 1.0)
        self.assertAlmostEqual(net15, (1.0 - 0.15) / 1.0)

    def test_csv_columns_match_the_requested_header(self) -> None:
        self.assertEqual(
            CSV_COLUMNS,
            (
                "situation",
                "symbol",
                "entry_time_utc",
                "side",
                "entry",
                "stop",
                "target",
                "exit_time_utc",
                "exit",
                "r_gross",
                "r_net",
                "cost_bp",
            ),
        )


if __name__ == "__main__":
    unittest.main()
