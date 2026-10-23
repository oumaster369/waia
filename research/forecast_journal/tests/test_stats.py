"""Inference helpers and the embargo rule."""

from __future__ import annotations

import unittest

import numpy as np

from research.forecast_journal.metrics.stats import (
    benjamini_hochberg,
    brier_score,
    isotonic_fit,
    isotonic_predict,
    student_t_sf,
    train_eligible,
)


class StatsTests(unittest.TestCase):
    def test_student_t_upper_tail(self) -> None:
        # One-sided 5% critical value of t with 10 degrees of freedom.
        self.assertAlmostEqual(student_t_sf(1.8124611228, 10), 0.05, places=3)
        self.assertAlmostEqual(student_t_sf(0.0, 10), 0.5, places=6)

    def test_benjamini_hochberg(self) -> None:
        rejected, qvals = benjamini_hochberg([0.001, 0.04, 0.20], alpha=0.05)
        self.assertTrue(rejected[0])
        self.assertFalse(rejected[1])
        self.assertFalse(rejected[2])
        self.assertLessEqual(qvals[0], 0.05)

    def test_isotonic_pools_a_violation(self) -> None:
        grid, fitted = isotonic_fit([0, 1, 2], [0.0, 1.0, 0.0])
        self.assertTrue(np.all(np.diff(fitted) >= -1e-12))
        pred = isotonic_predict(grid, fitted, [0, 1, 2])
        self.assertEqual(len(pred), 3)

    def test_brier_perfect(self) -> None:
        self.assertAlmostEqual(brier_score([1, 0, 1], [1, 0, 1]), 0.0)

    def test_embargo_drops_overlapping_labels(self) -> None:
        mask = train_eligible(np.array([0, 10, 20]), horizon_s=15, test_start=20)
        self.assertListEqual(mask.tolist(), [True, False, False])


if __name__ == "__main__":
    unittest.main()
