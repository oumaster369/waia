"""L2 logistic regression in numpy, plus an optional sklearn gradient booster."""

from __future__ import annotations

import numpy as np


def fit_logistic(x, y, l2: float = 1.0, steps: int = 120, lr: float = 0.15) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (weights including intercept, train median, train std).

    The intercept is not penalised. Columns are median-imputed and standardised
    with training statistics. NaNs become 0 after standardisation (the typical value).
    """
    raw = np.asarray(x, dtype=float)
    target = np.asarray(y, dtype=float)
    mask = np.isfinite(target)
    raw, target = raw[mask], target[mask]
    if raw.ndim == 1:
        raw = raw.reshape(-1, 1)
    mu = np.nanmedian(raw, axis=0)
    mu = np.where(np.isfinite(mu), mu, 0.0)
    filled = np.where(np.isfinite(raw), raw, mu)
    sd = np.std(filled, axis=0)
    sd = np.where(sd < 1e-8, 1.0, sd)
    z = (filled - mu) / sd
    ones = np.ones((len(z), 1))
    design = np.concatenate([ones, z], axis=1)
    weights = np.zeros(design.shape[1])
    n = max(len(z), 1)
    penalty = np.ones(design.shape[1])
    penalty[0] = 0.0
    for _ in range(steps):
        linear = np.clip(design @ weights, -30, 30)
        prob = 1.0 / (1.0 + np.exp(-linear))
        grad = design.T @ (prob - target) / n + l2 * penalty * weights
        weights -= lr * grad
    return weights, mu, sd


def predict_logistic(x, weights, mu, sd) -> np.ndarray:
    raw = np.asarray(x, dtype=float)
    if raw.ndim == 1:
        raw = raw.reshape(-1, 1)
    filled = np.where(np.isfinite(raw), raw, mu)
    z = (filled - mu) / sd
    design = np.concatenate([np.ones((len(z), 1)), z], axis=1)
    linear = np.clip(design @ weights, -30, 30)
    return 1.0 / (1.0 + np.exp(-linear))


def try_gbm():
    try:
        from sklearn.ensemble import GradientBoostingClassifier
    except Exception:
        return None
    return GradientBoostingClassifier


LEARNED_FEATURES: tuple[str, ...] = (
    "ret_15m",
    "ret_1h",
    "ret_4h",
    "ret_24h",
    "close_pos",
    "range_pct",
    "dist_high_atr",
    "dist_low_atr",
    "turnover_z",
    "ema20_slope_4h",
    "cvd_ratio_1h",
    "funding_z",
    "funding_change",
    "oi_change_1h",
    "oi_change_4h",
    "basis",
    "long_short_ratio",
    "btc_ret_1h",
    "btc_ret_4h",
    "btc_rel_4h",
    "btc_dom_4h",
    "beta_btc",
    "corr_btc",
    "hour_utc",
    "dow",
    "T",
    "M",
    "P",
    "rv_1h",
)
