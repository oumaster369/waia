"""Score one radar minute.

`minute_features` turns the trailing 1-minute window into one row.
`score_minute` reads that row and returns `(score, side, card)`.

The card is actionable only when the study armed a setup. Arming requires a
Benjamini–Hochberg win on the ranking window and a positive holdout. Otherwise
the function stays flat and says so.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping

import numpy as np
import pandas as pd

from research.forecast_journal.intraday.constants import GBM_FEATURES, MINUTE_FEATURES
from research.forecast_journal.intraday.execute import plan_card
from research.forecast_journal.intraday.features import build_minute_frame
from research.forecast_journal.intraday.setups import SETUPS

STATE_PATH = Path(__file__).with_name("armed.json")
MODEL_PATH = Path(__file__).with_name("gbm_model.joblib")

GBM_MIN_P = 0.40
GBM_EDGE = 0.10


def minute_features(
    window: pd.DataFrame,
    *,
    symbol: str = "BTC",
    hourly: pd.DataFrame | None = None,
    funding: pd.DataFrame | None = None,
    oi: pd.DataFrame | None = None,
    liquidations: pd.DataFrame | None = None,
    h4: pd.DataFrame | None = None,
    decision_tf: str | None = None,
) -> dict:
    """Last closed bar.

    Pass `decision_tf` (`1m`, `5m`, or `15m`) to score a situation. The returned
    row carries `S1_side` … `S6_highvol_side`. Without it, the row is the older
    sweep state used by the first intraday pass.
    """
    if decision_tf:
        from research.forecast_journal.intraday.situations import situation_features

        return situation_features(window, hourly, h4, symbol=symbol, decision_tf=decision_tf)
    frame = build_minute_frame(
        window,
        hourly,
        funding,
        oi,
        liquidations,
        symbol=symbol,
        with_labels=False,
    )
    if frame.empty:
        return {}
    last = frame.iloc[-1]
    row = {}
    for name in MINUTE_FEATURES:
        value = last[name] if name in frame.columns else None
        row[name] = _plain(value)
    return row


def score_minute(features: Mapping, *, state: dict | None = None) -> tuple[float, str, dict | None]:
    """`(score, side, card)` for one closed bar.

    A row with `S1_side` is a situational read. It can fire only a setup the
    study armed for that row's `decision_tf`. A 15-minute pass does not arm
    the 1-minute row.
    """
    if "S1_side" in features or features.get("study") == "situations":
        return score_situation(features, state=state)
    return _score_legacy(features, state=state)


def score_situation(features: Mapping, *, state: dict | None = None) -> tuple[float, str, dict | None]:
    if not features:
        return 0.0, "flat", None
    loaded = state if state is not None else _read_situation_state()
    tf = str(features.get("decision_tf") or "1m")
    armed_map = loaded.get("armed") if isinstance(loaded.get("armed"), dict) else {}
    armed_ids = [str(sid) for sid in (armed_map.get(tf) or [])]
    fired = [sid for sid in armed_ids if features.get(f"{sid}_side") in ("long", "short")]
    if not fired:
        reason = loaded.get("reason_ru") or loaded.get("headline_ru") or "Ни одна ситуация не прошла проверку."
        if not armed_ids and not loaded:
            reason = "Разбор ситуаций ещё не записан."
        return 0.0, "flat", {
            "actionable": False,
            "side": "flat",
            "decision_tf": tf,
            "armed": armed_ids,
            "fired": [],
            "reason": reason,
        }
    sid = fired[0]
    side = str(features[f"{sid}_side"])
    card = _situation_card(side, features, sid)
    if card is None:
        return 0.0, "flat", {
            "actionable": False,
            "side": "flat",
            "decision_tf": tf,
            "armed": armed_ids,
            "setup_id": sid,
            "reason": "стоп и цель не оставляют карточку после комиссии",
        }
    score = 100.0 if side == "long" else -100.0
    card.update({"actionable": True, "decision_tf": tf, "armed": armed_ids, "setup_id": sid, "score": score})
    return score, side, card


def _situation_card(side: str, features: Mapping, sid: str) -> dict | None:
    from research.forecast_journal.intraday.execute import _geometry_ok, slip_amount

    price = _num(features.get("price"))
    stop = _num(features.get(f"{sid}_stop"))
    target = _num(features.get(f"{sid}_target"))
    atr_bar = _num(features.get("atr_bar")) or 0.0
    atr_h = _num(features.get("atr_1h"))
    if price is None or stop is None or target is None:
        return None
    slip = slip_amount(price, atr_bar)
    entry = price + slip if side == "long" else price - slip
    atr = atr_h if atr_h is not None else float("nan")
    if not _geometry_ok(side, entry, stop, target, atr, 0.0005):
        return None
    risk = (entry - stop) if side == "long" else (stop - entry)
    reward = (target - entry) if side == "long" else (entry - target)
    return {
        "side": side,
        "entry": float(entry),
        "stop": float(stop),
        "target": float(target),
        "expected_r": float((reward - 0.0005 * (entry + target)) / risk),
        "fee_per_side": 0.0005,
        "slip": slip,
    }


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return number


def _read_situation_state() -> dict:
    path = Path(__file__).with_name("situations_armed.json")
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _score_legacy(features: Mapping, *, state: dict | None = None) -> tuple[float, str, dict | None]:
    """`(score, side, card)` for one minute row.

    `score` is 100 * (P(up move) - P(down move)) when the booster is on disk,
    else 0. `side` is flat unless the armed setup fires and the pool/stop
    geometry is valid.
    """
    if not features:
        return 0.0, "flat", None
    frame = pd.DataFrame([dict(features)])
    matches = []
    for setup_id, (_formula, fn) in SETUPS.items():
        if str(fn(frame)[0]) != "flat":
            matches.append(setup_id)
    loaded = state if state is not None else _read_state()
    probability = _probability(features)
    score = 0.0 if probability is None else float((probability["p_up"] - probability["p_down"]) * 100.0)
    setup_id = loaded.get("setup_id") if loaded.get("armed") else None
    side = "flat"
    if setup_id == "gbm_intraday" and probability is not None:
        side = gbm_direction(probability["p_up"], probability["p_down"])
    elif setup_id in SETUPS:
        side = str(SETUPS[setup_id][1](frame)[0])
    if side == "flat":
        if not matches and probability is None:
            return 0.0, "flat", None
        return score, "flat", {
            "actionable": False,
            "side": "flat",
            "matches": matches,
            "probability": probability,
            "setup_id": loaded.get("setup_id"),
            "armed": bool(loaded.get("armed")),
            "reason": loaded.get("reason") or "no armed setup fired",
        }
    card = plan_card(side, dict(features))
    if card is None:
        return score, "flat", {
            "actionable": False,
            "matches": matches,
            "probability": probability,
            "setup_id": setup_id,
            "armed": True,
            "reason": "stop and next pool did not leave a usable card",
        }
    formula = SETUPS[setup_id][0] if setup_id in SETUPS else loaded.get("formula", "")
    card.update(
        {
            "actionable": True,
            "matches": matches,
            "probability": probability,
            "setup_id": setup_id,
            "armed": True,
            "formula": formula,
            "score": score,
        }
    )
    return score, side, card


def gbm_direction(p_up: float, p_down: float) -> str:
    if np.isfinite(p_up) and p_up >= GBM_MIN_P and p_up >= p_down + GBM_EDGE:
        return "long"
    if np.isfinite(p_down) and p_down >= GBM_MIN_P and p_down >= p_up + GBM_EDGE:
        return "short"
    return "flat"


def _probability(features: Mapping) -> dict | None:
    if not MODEL_PATH.exists():
        return None
    try:
        import joblib
    except Exception:
        return None
    bundle = joblib.load(MODEL_PATH)
    return bundle.probability(features)


def _read_state() -> dict:
    if not STATE_PATH.exists():
        return {"armed": False, "setup_id": None, "reason": "no intraday study has been written yet"}
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def _plain(value):
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return number


class GbmBundle:
    """Median-imputed gradient booster. Fit only on rows whose label had ended."""

    def __init__(self, model, columns: list[str], medians: np.ndarray, classes: list[int]) -> None:
        self.model = model
        self.columns = list(columns)
        self.medians = np.asarray(medians, dtype=float)
        self.classes = [int(c) for c in classes]

    def matrix(self, frame: pd.DataFrame) -> np.ndarray:
        cols = []
        for name, median in zip(self.columns, self.medians):
            if name in frame.columns:
                values = pd.to_numeric(frame[name], errors="coerce").to_numpy(dtype=float)
            else:
                values = np.full(len(frame), np.nan)
            fill = 0.0 if not np.isfinite(median) else float(median)
            cols.append(np.where(np.isfinite(values), values, fill))
        return np.column_stack(cols) if cols else np.zeros((len(frame), 0))

    def predict_sides(self, frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        proba = self.model.predict_proba(self.matrix(frame))
        by_class = {int(label): proba[:, i] for i, label in enumerate(self.model.classes_)}
        p_down = by_class.get(0, np.zeros(len(frame)))
        p_up = by_class.get(2, np.zeros(len(frame)))
        side = np.full(len(frame), "flat", dtype=object)
        for i in range(len(frame)):
            side[i] = gbm_direction(float(p_up[i]), float(p_down[i]))
        return side, np.asarray(p_up, dtype=float), np.asarray(p_down, dtype=float)

    def probability(self, features: Mapping) -> dict:
        frame = pd.DataFrame([dict(features)])
        _side, p_up, p_down = self.predict_sides(frame)
        up = float(p_up[0])
        down = float(p_down[0])
        return {"p_up": up, "p_down": down, "p_flat": float(max(0.0, 1.0 - up - down))}
