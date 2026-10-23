"""WAIA-S algebra: renormalised weights, Q, and the fee-aware card."""

from __future__ import annotations

import math
import unittest

import numpy as np

from research.forecast_journal.models.waia_s import apply_waia, signal


def _row(**overrides):
    base = {
        "price": 110.0,
        "atr_4h": 2.0,
        "atr_1h": 2.0,
        "atr_15m": 2.0,
        "ema20_4h": 110.0,
        "ema50_4h": 100.0,
        "ema200_4h": 100.0,
        "ema20_slope_4h": 1.0,
        "vwap_4h": 100.0,
        "ema20_15m": 100.0,
        "ema20_slope_15m": 1.0,
        "vwap_15m": 100.0,
        "cvd_ratio_1h": 1.0,
        "funding_z": -3.0,
        "basis": -0.002,
        "swing_low": 108.4,
        "swing_high": 120.0,
    }
    base.update(overrides)
    return base


class WaiaTests(unittest.TestCase):
    def test_full_components_without_liquidity(self) -> None:
        scored = apply_waia(__import__("pandas").DataFrame([_row()]), fee=0.0005)
        row = scored.iloc[0]
        self.assertAlmostEqual(row["T"], 1.0, places=6)
        self.assertAlmostEqual(row["M"], 1.0, places=6)
        self.assertAlmostEqual(row["P"], 1.0, places=6)
        self.assertTrue(math.isnan(row["L"]))
        self.assertAlmostEqual(row["Q"], 1.0, places=6)
        self.assertAlmostEqual(row["S"], 100.0 * math.tanh(1.0), places=6)
        self.assertEqual(row["side"], "long")
        # 2*ATR target is nearer than the opposite swing and still clears 1.8R.
        self.assertAlmostEqual(row["entry"], 110.0 - 0.6, places=6)
        self.assertAlmostEqual(row["target"], row["entry"] + 4.0, places=6)
        self.assertGreaterEqual(row["expected_r"], 1.8)

    def test_missing_basis_reduces_q(self) -> None:
        scored = apply_waia(__import__("pandas").DataFrame([_row(basis=np.nan)]), fee=0.0005)
        row = scored.iloc[0]
        self.assertAlmostEqual(row["Q"], 7.0 / 8.0, places=6)
        self.assertAlmostEqual(row["S"], 100.0 * math.tanh(1.0) * 7.0 / 8.0, places=6)

    def test_short_gate(self) -> None:
        mirrored = _row(
            price=90.0,
            ema20_4h=90.0,
            ema50_4h=100.0,
            ema200_4h=100.0,
            ema20_slope_4h=-1.0,
            vwap_4h=100.0,
            ema20_15m=100.0,
            ema20_slope_15m=-1.0,
            vwap_15m=100.0,
            cvd_ratio_1h=-1.0,
            funding_z=3.0,
            basis=0.002,
            swing_high=91.6,
            swing_low=80.0,
        )
        score, side, card = signal(mirrored)
        self.assertLess(score, -40)
        self.assertEqual(side, "short")
        self.assertIsNotNone(card)
        self.assertGreater(card["entry"], 90.0)
        self.assertGreaterEqual(card["expected_r"], 1.8)

    def test_scalar_matches_frame(self) -> None:
        features = _row()
        score, side, card = signal(features)
        frame = apply_waia(__import__("pandas").DataFrame([features]))
        self.assertAlmostEqual(score, float(frame.iloc[0]["S"]))
        self.assertEqual(side, frame.iloc[0]["side"])
        self.assertAlmostEqual(card["target"], float(frame.iloc[0]["target"]))

    def test_weak_score_stays_flat(self) -> None:
        features = _row(ema20_slope_4h=0.0, ema20_slope_15m=0.0, cvd_ratio_1h=0.0, funding_z=0.0, basis=0.0, price=100.0, ema20_4h=100.0, ema50_4h=100.0, ema200_4h=100.0, vwap_4h=100.0, ema20_15m=100.0, vwap_15m=100.0)
        score, side, card = signal(features)
        self.assertAlmostEqual(score, 0.0, places=6)
        self.assertEqual(side, "flat")
        self.assertIsNone(card)


if __name__ == "__main__":
    unittest.main()
