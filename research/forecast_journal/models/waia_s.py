"""WAIA-S directional score.

S = 100 · tanh(w·components) · Q

Weights (T, M, L, P) = (0.30, 0.25, 0.30, 0.15). When a component is absent
— L always is, on history without the liquidity feed — the remaining weights
are renormalised to 1. Q is the share of *required* atoms present inside the
components that are active. Optional atoms (order-book imbalance, long/short
ratio, L) do not reduce Q when they are missing.

T = mean(
    clip((price − EMA50_4h) / ATR_4h / 2),
    clip((price − EMA200_4h) / ATR_4h / 2),
    clip(EMA20_4h slope in ATR units),
    4h direction,
)
4h direction = mean(
    clip(EMA20_4h slope / ATR_4h),
    clip((EMA20_4h − EMA50_4h) / ATR_4h / 2),
    clip((price − VWAP_4h) / ATR_4h / 2),
)

M = mean(
    15m direction,
    clip(CVD_1h / turnover_1h),
    clip(imbalance) if the liquidity feed is present,
)
15m direction = mean(
    clip(EMA20_15m slope in ATR),
    clip((price − EMA20_15m) / ATR_15m / 2),
    clip((price − VWAP_15m) / ATR_15m / 2),
)

P = mean(
    −clip(funding_z / 3),
    −clip(basis / 0.002),
    −clip(long_short_ratio − 1) if a long/short print is available,
)

clip is clip(x, −1, 1). CVD / turnover is the kline close-location proxy
summed over the last hour, not a true taker feed (HTX klines do not publish
taker buy volume).

LONG if S ≥ 40 and T ≥ −0.3. SHORT if S ≤ −40 and T ≤ 0.3.
Entry is a 0.3·ATR_1h pullback. Stop is 0.5·ATR_1h beyond the 24h swing.
Target is the nearer of the opposite swing and 2·ATR_1h that still has
net RR ≥ 1.8 after taker fees on both sides.
"""

from __future__ import annotations

from typing import Mapping

import numpy as np
import pandas as pd

from research.forecast_journal.config import DEFAULT_TAKER_FEE, MIN_EXPECTED_R, WAIA_WEIGHTS
from research.forecast_journal.features.liquidity import liquidity_magnet
from research.forecast_journal.journal.trade import expected_r, pick_target
from research.forecast_journal.util import clip_unit, nanmean_rows, safe_div

MODEL_ID = "waia_s_v1"


def apply_waia(
    frame: pd.DataFrame,
    fee: float = DEFAULT_TAKER_FEE,
    min_rr: float = MIN_EXPECTED_R,
    drop: tuple[str, ...] = (),
) -> pd.DataFrame:
    df = frame.copy()
    n = len(df)
    if n == 0:
        return df
    price = _col(df, "price")
    atr4 = _col(df, "atr_4h")
    atr1 = _col(df, "atr_1h")
    atr15 = _col(df, "atr_15m")
    ema20 = _col(df, "ema20_4h")
    ema50 = _col(df, "ema50_4h")
    ema200 = _col(df, "ema200_4h")
    slope4 = _col(df, "ema20_slope_4h")
    vwap4 = _col(df, "vwap_4h")
    ema20_15 = _col(df, "ema20_15m")
    slope15 = _col(df, "ema20_slope_15m")
    vwap15 = _col(df, "vwap_15m")

    dist50 = clip_unit(safe_div(price - ema50, atr4) / 2.0)
    dist200 = clip_unit(safe_div(price - ema200, atr4) / 2.0)
    slope = clip_unit(slope4)
    dir_cross = clip_unit(safe_div(ema20 - ema50, atr4) / 2.0)
    dir_vwap = clip_unit(safe_div(price - vwap4, atr4) / 2.0)
    direction, _ = nanmean_rows(np.column_stack([slope, dir_cross, dir_vwap]))
    t_atoms = np.column_stack([dist50, dist200, slope, direction])
    t_score, t_count = nanmean_rows(t_atoms)

    dir15_level = clip_unit(safe_div(price - ema20_15, atr15) / 2.0)
    dir15_vwap = clip_unit(safe_div(price - vwap15, atr15) / 2.0)
    dir15, _ = nanmean_rows(np.column_stack([clip_unit(slope15), dir15_level, dir15_vwap]))
    cvd = clip_unit(_col(df, "cvd_ratio_1h"))
    imbalance = clip_unit(_col(df, "imbalance"))
    m_req = np.column_stack([dir15, cvd])
    m_score, m_count = nanmean_rows(np.column_stack([dir15, cvd, imbalance]))

    funding_term = -clip_unit(safe_div(_col(df, "funding_z"), 3.0))
    basis_term = -clip_unit(safe_div(_col(df, "basis"), 0.002))
    ls = _col(df, "long_short_ratio")
    ls_term = -clip_unit(ls - 1.0)
    ls_term[~np.isfinite(ls)] = np.nan
    p_score, _ = nanmean_rows(np.column_stack([funding_term, basis_term, ls_term]))
    p_req_count = np.isfinite(np.column_stack([funding_term, basis_term])).sum(axis=1).astype(float)

    l_score = _liquidity_column(df)

    # `drop` removes a component from the blend only. The long/short gate still
    # sees the original T, so an ablation measures that component's effect on S.
    dropped = set(drop)
    t_for_blend = np.full(n, np.nan) if "T" in dropped else t_score
    if "M" in dropped:
        m_score = np.full(n, np.nan)
    if "L" in dropped:
        l_score = np.full(n, np.nan)
    if "P" in dropped:
        p_score = np.full(n, np.nan)
    m_req_count = np.isfinite(m_req).sum(axis=1).astype(float)
    t_present = np.isfinite(t_for_blend)
    m_present = np.isfinite(m_score)
    p_present = np.isfinite(p_score)
    q_num = np.where(t_present, t_count, 0.0) + np.where(m_present, m_req_count, 0.0) + np.where(p_present, p_req_count, 0.0)
    q_den = 4.0 * t_present + 2.0 * m_present + 2.0 * p_present
    quality = np.full(n, np.nan)
    np.divide(q_num, q_den, out=quality, where=q_den > 0)
    values = np.column_stack([t_for_blend, m_score, l_score, p_score])
    weights = np.array([WAIA_WEIGHTS["T"], WAIA_WEIGHTS["M"], WAIA_WEIGHTS["L"], WAIA_WEIGHTS["P"]], dtype=float)
    present = np.isfinite(values)
    weighted = np.where(present, values * weights, 0.0)
    wsum = (present * weights).sum(axis=1)
    inner = np.full(n, np.nan)
    np.divide(weighted.sum(axis=1), wsum, out=inner, where=wsum > 0)
    score = 100.0 * np.tanh(inner) * quality
    # The gate needs T. A score without a trend component is not a WAIA-S signal.
    score = np.where(np.isfinite(t_score), score, np.nan)

    side = np.full(n, "flat", dtype=object)
    side[(score >= 40.0) & (t_score >= -0.3)] = "long"
    side[(score <= -40.0) & (t_score <= 0.3)] = "short"

    entry = np.full(n, np.nan)
    stop = np.full(n, np.nan)
    target = np.full(n, np.nan)
    reward = np.full(n, np.nan)
    swing_high = _col(df, "swing_high")
    swing_low = _col(df, "swing_low")
    long = side == "long"
    short = side == "short"
    entry[long] = price[long] - 0.3 * atr1[long]
    entry[short] = price[short] + 0.3 * atr1[short]
    stop[long] = swing_low[long] - 0.5 * atr1[long]
    stop[short] = swing_high[short] + 0.5 * atr1[short]
    for idx in np.flatnonzero(long | short):
        if not np.isfinite(entry[idx]) or not np.isfinite(stop[idx]) or not np.isfinite(atr1[idx]) or atr1[idx] <= 0:
            side[idx] = "flat"
            entry[idx] = np.nan
            stop[idx] = np.nan
            continue
        opposite = float(swing_high[idx] if side[idx] == "long" else swing_low[idx])
        two_atr = float(entry[idx] + 2.0 * atr1[idx] if side[idx] == "long" else entry[idx] - 2.0 * atr1[idx])
        chosen, er = pick_target(str(side[idx]), float(entry[idx]), float(stop[idx]), opposite, two_atr, fee, min_rr)
        if not np.isfinite(chosen):
            side[idx] = "flat"
            entry[idx] = np.nan
            stop[idx] = np.nan
            continue
        target[idx] = chosen
        reward[idx] = er

    df["T"] = t_score
    df["M"] = m_score
    df["L"] = l_score
    df["P"] = p_score
    df["Q"] = quality
    df["S"] = score
    df["score"] = score
    df["side"] = side
    df["entry"] = entry
    df["stop"] = stop
    df["target"] = target
    df["expected_r"] = reward
    df["model_id"] = MODEL_ID
    return df


def signal(features: Mapping, fee: float | None = None, min_rr: float = MIN_EXPECTED_R) -> tuple[float, str, dict | None]:
    """`signal(features) -> (score, side, card)`.

    `card` is None when the rule is flat or the reward/risk after fees is
    below the minimum. Fee defaults to the HTX taker (0.05% per side) and
    can be overridden with `features["fee_per_side"]`.
    """
    fee_used = DEFAULT_TAKER_FEE if fee is None else fee
    if fee is None and features.get("fee_per_side") is not None:
        fee_used = float(features["fee_per_side"])
    scored = apply_waia(pd.DataFrame([dict(features)]), fee=fee_used, min_rr=min_rr)
    row = scored.iloc[0]
    score = float(row["S"]) if np.isfinite(row["S"]) else float("nan")
    side = str(row["side"])
    if side == "flat" or not np.isfinite(row["entry"]):
        return score, "flat", None
    card = {
        "side": side,
        "entry": float(row["entry"]),
        "stop": float(row["stop"]),
        "target": float(row["target"]),
        "expected_r": float(row["expected_r"]),
        "fee_per_side": fee_used,
    }
    return score, side, card


def _col(df: pd.DataFrame, name: str) -> np.ndarray:
    if name not in df.columns:
        return np.full(len(df), np.nan)
    return pd.to_numeric(df[name], errors="coerce").to_numpy(dtype=float)


def _liquidity_column(df: pd.DataFrame) -> np.ndarray:
    n = len(df)
    if "liq_last" not in df.columns and "imbalance" not in df.columns:
        return np.full(n, np.nan)
    # Vectorised mirror of liquidity_magnet: tanh of weighted (up-down), blended with wall imbalance.
    weights = np.array([0.40, 0.30, 0.20, 0.10])
    suffixes = ("0_5", "1", "2", "3")
    num = np.zeros(n)
    den = np.zeros(n)
    for weight, suffix in zip(weights, suffixes):
        up = _col(df, f"liq_magnet_up_{suffix}")
        down = _col(df, f"liq_magnet_dn_{suffix}")
        ok = np.isfinite(up) | np.isfinite(down)
        num[ok] += weight * (np.where(np.isfinite(up), up, 0.0)[ok] - np.where(np.isfinite(down), down, 0.0)[ok])
        den[ok] += weight
    ratio = np.full(n, np.nan)
    np.divide(num, den, out=ratio, where=den > 0)
    magnet = np.tanh(ratio)
    imb = _col(df, "imbalance")
    out = np.full(n, np.nan)
    both = np.isfinite(magnet) & np.isfinite(imb)
    only_m = np.isfinite(magnet) & ~np.isfinite(imb)
    only_i = ~np.isfinite(magnet) & np.isfinite(imb)
    out[both] = np.clip((magnet[both] + imb[both]) / 2.0, -1.0, 1.0)
    out[only_m] = np.clip(magnet[only_m], -1.0, 1.0)
    out[only_i] = np.clip(imb[only_i], -1.0, 1.0)
    # Keep the scalar helper honest: a one-row frame must match liquidity_magnet.
    if n == 1 and not np.isfinite(out[0]):
        out[0] = liquidity_magnet(df.iloc[0].to_dict())
    return out


def component_ablation(frame: pd.DataFrame, fee: float = DEFAULT_TAKER_FEE) -> dict[str, pd.DataFrame]:
    """S with components removed from the blend. Weights and Q are renormalised.

    The entry gate still uses the original T, including when T itself is
    removed from the blend, so `no_T` asks "what if the score ignored trend"
    rather than "delete every row".
    """
    variants = {
        "full": apply_waia(frame, fee=fee),
        "no_T": apply_waia(frame, fee=fee, drop=("T",)),
        "no_M": apply_waia(frame, fee=fee, drop=("M",)),
        "no_P": apply_waia(frame, fee=fee, drop=("P",)),
        "no_L": apply_waia(frame, fee=fee, drop=("L",)),
        "T_only": apply_waia(frame, fee=fee, drop=("M", "P", "L")),
        "M_only": apply_waia(frame, fee=fee, drop=("T", "P", "L")),
        "P_only": apply_waia(frame, fee=fee, drop=("T", "M", "L")),
    }
    return variants
