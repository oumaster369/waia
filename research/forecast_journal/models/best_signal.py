"""Pluggable signal.

`signal(features) -> (score, side, card)` is the formula selected on the
development window only. The default, before a study has ranked alternatives,
is the pre-specified WAIA-S rule. A study may replace `SELECTED` with another
registered id; it must not use the holdout to make that choice.

See `research/forecast_journal/models/waia_s.py` for the algebra and
`models/rules.py` for the pre-registered alternatives.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping

import numpy as np
import pandas as pd

from research.forecast_journal.config import DEFAULT_TAKER_FEE, MIN_EXPECTED_R
from research.forecast_journal.journal.trade import apply_market_cards
from research.forecast_journal.models.learned import predict_logistic
from research.forecast_journal.models.rules import RULES
from research.forecast_journal.models.waia_s import MODEL_ID, signal as waia_signal

# Ranking-window leader after the 2026-10-02 study. No trial passed
# Benjamini–Hochberg, and this rule's untouched holdout mean R was negative.
# See reports/search.md. The constant records the selection rule, not a
# claim that the formula makes money.
SELECTED = "squeeze_break_strict"

PARAMS_PATH = Path(__file__).with_name("selected_params.json")


def signal(features: Mapping) -> tuple[float, str, dict | None]:
    if SELECTED in (MODEL_ID, "waia_s_v1"):
        return waia_signal(features)
    if SELECTED == "logistic_l2":
        return _logistic_signal(features)
    formula, fn = RULES[SELECTED]
    frame = pd.DataFrame([dict(features)])
    side = fn(frame)
    price = float(features.get("price", np.nan))
    atr = float(features.get("atr_1h", np.nan))
    fee = float(features.get("fee_per_side", DEFAULT_TAKER_FEE))
    side, entry, stop, target, reward = apply_market_cards(side, np.array([price]), np.array([atr]), fee, MIN_EXPECTED_R)
    score = 100.0 if side[0] == "long" else (-100.0 if side[0] == "short" else 0.0)
    if side[0] == "flat":
        return score, "flat", None
    card = {
        "side": str(side[0]),
        "entry": float(entry[0]),
        "stop": float(stop[0]),
        "target": float(target[0]),
        "expected_r": float(reward[0]),
        "fee_per_side": fee,
        "formula": formula,
        "model_id": SELECTED,
    }
    return score, str(side[0]), card


def _logistic_signal(features: Mapping) -> tuple[float, str, dict | None]:
    """Frozen L2 logistic chosen on the inner split and fit before the holdout."""
    if not PARAMS_PATH.exists():
        return float("nan"), "flat", None
    params = json.loads(PARAMS_PATH.read_text(encoding="utf-8"))
    cols = list(params["features"])
    row = np.array([[float(features[c]) if features.get(c) is not None else np.nan for c in cols]], dtype=float)
    weights = np.asarray(params["weights"], dtype=float)
    mu = np.asarray(params["mu"], dtype=float)
    sd = np.asarray(params["sd"], dtype=float)
    prob = float(predict_logistic(row, weights, mu, sd)[0])
    long_at = float(params.get("long_at", 0.55))
    short_at = float(params.get("short_at", 0.45))
    side_name = "long" if prob >= long_at else ("short" if prob <= short_at else "flat")
    price = float(features.get("price", np.nan))
    atr = float(features.get("atr_1h", np.nan))
    fee = float(features.get("fee_per_side", DEFAULT_TAKER_FEE))
    sided, entry, stop, target, reward = apply_market_cards(
        np.array([side_name], dtype=object), np.array([price]), np.array([atr]), fee, MIN_EXPECTED_R
    )
    score = (prob - 0.5) * 200.0
    if sided[0] == "flat":
        return score, "flat", None
    card = {
        "side": str(sided[0]),
        "entry": float(entry[0]),
        "stop": float(stop[0]),
        "target": float(target[0]),
        "expected_r": float(reward[0]),
        "fee_per_side": fee,
        "probability_up": prob,
        "formula": params.get("formula", ""),
        "model_id": "logistic_l2",
    }
    return score, str(sided[0]), card
