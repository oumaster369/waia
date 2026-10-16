"""Pre-registered rule families. Thresholds are constants, not fit on the holdout.

Each rule returns an object array of 'long' / 'short' / 'flat'. The trade card
(entry, stop, target) is attached later and is the same ATR card for every rule,
so differences are the signal rather than the exit geometry.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _sides(long_mask, short_mask) -> np.ndarray:
    long_mask = np.asarray(long_mask, dtype=bool)
    short_mask = np.asarray(short_mask, dtype=bool)
    side = np.full(long_mask.shape, "flat", dtype=object)
    side[long_mask & ~short_mask] = "long"
    side[short_mask & ~long_mask] = "short"
    return side


def _num(df: pd.DataFrame, name: str) -> np.ndarray:
    if name not in df.columns:
        return np.full(len(df), np.nan)
    return pd.to_numeric(df[name], errors="coerce").to_numpy(dtype=float)


def trend_stack(df: pd.DataFrame) -> np.ndarray:
    price, e20, e50, e200 = _num(df, "price"), _num(df, "ema20_4h"), _num(df, "ema50_4h"), _num(df, "ema200_4h")
    long = (price > e50) & (e20 > e50) & (e50 > e200)
    short = (price < e50) & (e20 < e50) & (e50 < e200)
    return _sides(long, short)


def trend_t(df: pd.DataFrame, level: float = 0.40) -> np.ndarray:
    t = _num(df, "T")
    return _sides(t >= level, t <= -level)


def momentum_align(df: pd.DataFrame) -> np.ndarray:
    r1, r4 = _num(df, "ret_1h"), _num(df, "ret_4h")
    return _sides((r1 > 0) & (r4 > 0), (r1 < 0) & (r4 < 0))


def momentum_24h(df: pd.DataFrame) -> np.ndarray:
    r = _num(df, "ret_24h")
    return _sides(r > 0, r < 0)


def mean_revert_atr(df: pd.DataFrame, k: float = 2.0) -> np.ndarray:
    price, ema, atr = _num(df, "price"), _num(df, "ema20_4h"), _num(df, "atr_4h")
    z = (price - ema) / atr
    return _sides(z <= -k, z >= k)


def mean_revert_close(df: pd.DataFrame) -> np.ndarray:
    pos, r = _num(df, "close_pos"), _num(df, "ret_1h")
    return _sides((pos <= 0.15) & (r < 0), (pos >= 0.85) & (r > 0))


def squeeze_break(df: pd.DataFrame, strict: bool = False) -> np.ndarray:
    atr, q20 = _num(df, "atr_1h"), _num(df, "atr_q20")
    price, hi, lo = _num(df, "price"), _num(df, "prior_high"), _num(df, "prior_low")
    if strict:
        compressed = atr <= q20 * 0.85
    else:
        compressed = atr <= q20
    return _sides(compressed & (price > hi), compressed & (price < lo))


def funding_fade(df: pd.DataFrame, z: float = 1.5) -> np.ndarray:
    fz = _num(df, "funding_z")
    return _sides(fz <= -z, fz >= z)


def basis_fade(df: pd.DataFrame, level: float = 0.002) -> np.ndarray:
    basis = _num(df, "basis")
    return _sides(basis <= -level, basis >= level)


def funding_and_basis(df: pd.DataFrame) -> np.ndarray:
    fz, basis = _num(df, "funding_z"), _num(df, "basis")
    long = (fz <= -1.0) & (basis <= -0.001)
    short = (fz >= 1.0) & (basis >= 0.001)
    return _sides(long, short)


def btc_lead(df: pd.DataFrame, column: str, threshold: float) -> np.ndarray:
    btc = _num(df, column)
    beta = _num(df, "beta_btc")
    symbol = df["symbol"].astype(str).to_numpy() if "symbol" in df.columns else np.array([""] * len(df))
    tradable = symbol != "BTC"
    aligned = np.isfinite(beta) & (beta > 0.3)
    return _sides(tradable & aligned & (btc > threshold), tradable & aligned & (btc < -threshold))


def session_filter(df: pd.DataFrame, base, session: str) -> np.ndarray:
    side = base(df)
    sess = df["session"].astype(str).to_numpy() if "session" in df.columns else np.array([""] * len(df))
    side = side.copy()
    side[sess != session] = "flat"
    return side


def wick_reversal(df: pd.DataFrame) -> np.ndarray:
    pos, vol, rng = _num(df, "close_pos"), _num(df, "turnover_z"), _num(df, "range_pct")
    active = (vol >= 2.0) & (rng > 0)
    return _sides(active & (pos <= 0.20), active & (pos >= 0.80))


def wick_continuation(df: pd.DataFrame) -> np.ndarray:
    pos, vol, r = _num(df, "close_pos"), _num(df, "turnover_z"), _num(df, "ret_1h")
    active = vol >= 2.0
    return _sides(active & (pos >= 0.80) & (r > 0), active & (pos <= 0.20) & (r < 0))


def vol_spike_fade(df: pd.DataFrame) -> np.ndarray:
    vol, r, atr, price = _num(df, "turnover_z"), _num(df, "ret_1h"), _num(df, "atr_1h"), _num(df, "price")
    large = np.abs(r) > (atr / price)
    return _sides((vol >= 2.5) & large & (r < 0), (vol >= 2.5) & large & (r > 0))


def regime_trend(df: pd.DataFrame) -> np.ndarray:
    side = trend_t(df, 0.25)
    regime = df["vol_regime"].astype(str).to_numpy() if "vol_regime" in df.columns else np.array([""] * len(df))
    side = side.copy()
    side[regime != "high"] = "flat"
    return side


def regime_revert(df: pd.DataFrame) -> np.ndarray:
    side = mean_revert_atr(df, 1.5)
    regime = df["vol_regime"].astype(str).to_numpy() if "vol_regime" in df.columns else np.array([""] * len(df))
    side = side.copy()
    side[regime != "low"] = "flat"
    return side


def relative_strength(df: pd.DataFrame) -> np.ndarray:
    rel, r = _num(df, "btc_rel_4h"), _num(df, "ret_4h")
    # btc_rel_4h = symbol ret − BTC ret. Positive means the symbol led BTC.
    return _sides((rel > 0.005) & (r > 0), (rel < -0.005) & (r < 0))


def weekday_momentum(df: pd.DataFrame) -> np.ndarray:
    side = momentum_align(df)
    dow = _num(df, "dow")
    side = side.copy()
    side[dow >= 4] = "flat"  # Friday=4, weekend off
    return side


# id -> (formula text, function)
RULES: dict[str, tuple[str, callable]] = {
    "trend_stack": (
        "LONG if price>EMA50_4h and EMA20>EMA50>EMA200; SHORT the mirror.",
        trend_stack,
    ),
    "trend_T_0.40": (
        "LONG if T>=0.40; SHORT if T<=-0.40. T is the WAIA-S trend component.",
        lambda df: trend_t(df, 0.40),
    ),
    "trend_T_0.25": (
        "LONG if T>=0.25; SHORT if T<=-0.25.",
        lambda df: trend_t(df, 0.25),
    ),
    "momentum_1h_4h": (
        "LONG if ret_1h>0 and ret_4h>0; SHORT if both are negative.",
        momentum_align,
    ),
    "momentum_24h": (
        "LONG if ret_24h>0; SHORT if ret_24h<0.",
        momentum_24h,
    ),
    "mr_atr_2": (
        "LONG if (price-EMA20_4h)/ATR_4h<=-2; SHORT if >=+2.",
        lambda df: mean_revert_atr(df, 2.0),
    ),
    "mr_atr_1.5": (
        "LONG if (price-EMA20_4h)/ATR_4h<=-1.5; SHORT if >=+1.5.",
        lambda df: mean_revert_atr(df, 1.5),
    ),
    "mr_close_extreme": (
        "LONG if close is in the bottom 15% of the bar and ret_1h<0; SHORT the mirror.",
        mean_revert_close,
    ),
    "squeeze_break": (
        "LONG if ATR_1h<=its trailing 20th percentile and price>prior 24-bar high; SHORT the mirror.",
        lambda df: squeeze_break(df, False),
    ),
    "squeeze_break_strict": (
        "Same breakout, but ATR_1h<=0.85× its trailing 20th percentile.",
        lambda df: squeeze_break(df, True),
    ),
    "funding_fade_1.5": (
        "LONG if funding_z<=-1.5; SHORT if funding_z>=1.5.",
        lambda df: funding_fade(df, 1.5),
    ),
    "funding_fade_2": (
        "LONG if funding_z<=-2; SHORT if funding_z>=2.",
        lambda df: funding_fade(df, 2.0),
    ),
    "basis_fade": (
        "LONG if basis<=-0.002; SHORT if basis>=0.002. basis=(swap-index)/index.",
        lambda df: basis_fade(df, 0.002),
    ),
    "funding_basis_fade": (
        "LONG if funding_z<=-1 and basis<=-0.001; SHORT the mirror.",
        funding_and_basis,
    ),
    "btc_lead_1h": (
        "For alts with beta_BTC>0.3: LONG if BTC ret_1h>0.001; SHORT if <-0.001. BTC itself is flat.",
        lambda df: btc_lead(df, "btc_ret_1h", 0.001),
    ),
    "btc_lead_4h": (
        "For alts with beta_BTC>0.3: LONG if BTC ret_4h>0.002; SHORT if <-0.002.",
        lambda df: btc_lead(df, "btc_ret_4h", 0.002),
    ),
    "session_us_trend": (
        "trend_stack, but only during the US session (16:00–24:00 UTC).",
        lambda df: session_filter(df, trend_stack, "us"),
    ),
    "session_eu_trend": (
        "trend_stack, but only during the Europe session (08:00–16:00 UTC).",
        lambda df: session_filter(df, trend_stack, "europe"),
    ),
    "session_asia_mr": (
        "mr_atr_2, but only during the Asia session (00:00–08:00 UTC).",
        lambda df: session_filter(df, lambda d: mean_revert_atr(d, 2.0), "asia"),
    ),
    "wick_reversal": (
        "LONG after a high-volume bar that closes in the bottom 20% of its range; SHORT the mirror. Wick + volume is the liquidation-cascade proxy.",
        wick_reversal,
    ),
    "wick_continuation": (
        "LONG after a high-volume bar that closes in the top 20% and ret_1h>0; SHORT the mirror.",
        wick_continuation,
    ),
    "vol_spike_fade": (
        "Fade ret_1h when turnover z>=2.5 and |ret_1h| exceeds ATR_1h/price.",
        vol_spike_fade,
    ),
    "highvol_trend": (
        "trend_T at 0.25, only in the high ATR regime (ATR above its trailing 66th percentile).",
        regime_trend,
    ),
    "lowvol_revert": (
        "mr_atr_1.5, only in the low ATR regime.",
        regime_revert,
    ),
    "relative_strength": (
        "LONG if ret_4h>0 and ret_4h exceeds BTC ret_4h by 0.5pp; SHORT the mirror.",
        relative_strength,
    ),
    "weekday_momentum": (
        "momentum_1h_4h on Monday–Thursday UTC only.",
        weekday_momentum,
    ),
}
