import unittest

from autoexec.breakeven import breakeven_price, favorable_r, next_stop


class BreakevenTest(unittest.TestCase):
    def test_not_before_one_r(self):
        moved = next_stop(
            direction="long",
            entry=100,
            initial_stop=90,
            current_stop=90,
            price=109,
            fee_rt=0.001,
            tick=0.1,
            trigger_r=1,
            trail_enabled=False,
            trail_distance_r=1,
        )
        self.assertIsNone(moved)
        self.assertAlmostEqual(favorable_r("long", 100, 109, 10), 0.9)

    def test_long_moves_to_entry_plus_fees(self):
        moved = next_stop(
            direction="long",
            entry=100,
            initial_stop=90,
            current_stop=90,
            price=110,
            fee_rt=0.001,
            tick=0.1,
            trigger_r=1,
            trail_enabled=False,
            trail_distance_r=1,
        )
        self.assertEqual(moved, breakeven_price("long", 100, 0.001, 0.1))
        self.assertGreaterEqual(moved, 100 * 1.001)

    def test_short_moves_to_entry_minus_fees(self):
        moved = next_stop(
            direction="short",
            entry=100,
            initial_stop=110,
            current_stop=110,
            price=90,
            fee_rt=0.001,
            tick=0.1,
            trigger_r=1,
            trail_enabled=False,
            trail_distance_r=1,
        )
        self.assertEqual(moved, 99.9)
        self.assertLessEqual(moved, 100 * 0.999)

    def test_never_loosens(self):
        moved = next_stop(
            direction="long",
            entry=100,
            initial_stop=90,
            current_stop=105,
            price=112,
            fee_rt=0.001,
            tick=0.1,
            trigger_r=1,
            trail_enabled=False,
            trail_distance_r=1,
        )
        self.assertIsNone(moved)

    def test_trail_ratchets_above_breakeven(self):
        moved = next_stop(
            direction="long",
            entry=100,
            initial_stop=90,
            current_stop=100.1,
            price=130,
            fee_rt=0.001,
            tick=0.1,
            trigger_r=1,
            trail_enabled=True,
            trail_distance_r=1,
        )
        self.assertEqual(moved, 120)

    def test_trigger_r_is_parameter(self):
        moved = next_stop(
            direction="long",
            entry=100,
            initial_stop=90,
            current_stop=90,
            price=105,
            fee_rt=0.001,
            tick=0.1,
            trigger_r=0.5,
            trail_enabled=False,
            trail_distance_r=1,
        )
        self.assertEqual(moved, 100.1)


if __name__ == "__main__":
    unittest.main()
