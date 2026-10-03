"""Pre-registered intraday setups. Thresholds are constants.

Each function returns an object array of long / short / flat. Both sides are
the mirror of the same idea. None of them read the forward label.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _num(df: pd.DataFrame, name: str) -> np.ndarray:
    if name not in df.columns:
        return np.full(len(df), np.nan)
    return pd.to_numeric(df[name], errors="coerce").to_numpy(dtype=float)


def _flag(df: pd.DataFrame, name: str) -> np.ndarray:
    return np.nan_to_num(_num(df, name), nan=0.0) > 0.5


def _sides(long_mask, short_mask) -> np.ndarray:
    long_mask = np.asarray(long_mask, dtype=bool)
    short_mask = np.asarray(short_mask, dtype=bool)
    side = np.full(long_mask.shape, "flat", dtype=object)
    side[long_mask & ~short_mask] = "long"
    side[short_mask & ~long_mask] = "short"
    return side


def sweep_reclaim(df: pd.DataFrame) -> np.ndarray:
    return _sides(_flag(df, "sweep_low_reclaim"), _flag(df, "sweep_high_reclaim"))


def sweep_reclaim_volume(df: pd.DataFrame) -> np.ndarray:
    burst = _flag(df, "volume_burst")
    return _sides(_flag(df, "sweep_low_reclaim") & burst, _flag(df, "sweep_high_reclaim") & burst)


def sweep_round(df: pd.DataFrame) -> np.ndarray:
    return _sides(_flag(df, "sweep_round_low"), _flag(df, "sweep_round_high"))


def sweep_prior_day(df: pd.DataFrame) -> np.ndarray:
    return _sides(_flag(df, "sweep_pdl"), _flag(df, "sweep_pdh"))


def sweep_prior_week(df: pd.DataFrame) -> np.ndarray:
    return _sides(_flag(df, "sweep_week_low"), _flag(df, "sweep_week_high"))


def equal_levels(df: pd.DataFrame) -> np.ndarray:
    return _sides(
        _flag(df, "sweep_low_reclaim") & _flag(df, "equal_lows"),
        _flag(df, "sweep_high_reclaim") & _flag(df, "equal_highs"),
    )


def squeeze_go(df: pd.DataFrame) -> np.ndarray:
    go = _flag(df, "squeeze_expansion")
    up = _num(df, "ret_30m_atr") > 0
    dn = _num(df, "ret_30m_atr") < 0
    return _sides(go & up, go & dn)


def squeeze_fail(df: pd.DataFrame) -> np.ndarray:
    """Expansion that immediately reclaims the other side of the prior 30-minute extreme."""
    fail_long = _flag(df, "squeeze_expansion") & _flag(df, "sweep_low_reclaim")
    fail_short = _flag(df, "squeeze_expansion") & _flag(df, "sweep_high_reclaim")
    return _sides(fail_long, fail_short)


def burst_continuation(df: pd.DataFrame) -> np.ndarray:
    burst = _flag(df, "volume_burst")
    pos = _num(df, "close_pos_15")
    return _sides(burst & (pos >= 0.80) & (_num(df, "ret_30m_atr") > 0), burst & (pos <= 0.20) & (_num(df, "ret_30m_atr") < 0))


def burst_reversal(df: pd.DataFrame) -> np.ndarray:
    burst = _flag(df, "volume_burst")
    pos = _num(df, "close_pos_15")
    # Down push that closes back at the top of its range, and the mirror.
    return _sides(burst & (pos >= 0.80) & (_num(df, "ret_30m_atr") < 0), burst & (pos <= 0.20) & (_num(df, "ret_30m_atr") > 0))


def funding_sweep(df: pd.DataFrame) -> np.ndarray:
    z = _num(df, "funding_z")
    return _sides(_flag(df, "sweep_low_reclaim") & (z <= -2.0), _flag(df, "sweep_high_reclaim") & (z >= 2.0))


def oi_flush(df: pd.DataFrame) -> np.ndarray:
    """Open interest down at least 2% and price reclaims the swept side. Usually missing before the last OI buffer."""
    dropped = _num(df, "oi_change") <= -0.02
    return _sides(_flag(df, "sweep_low_reclaim") & dropped, _flag(df, "sweep_high_reclaim") & dropped)


def us_open_sweep(df: pd.DataFrame) -> np.ndarray:
    gate = _flag(df, "us_open")
    return _sides(_flag(df, "sweep_low_reclaim") & gate, _flag(df, "sweep_high_reclaim") & gate)


def london_sweep(df: pd.DataFrame) -> np.ndarray:
    gate = _flag(df, "london_open")
    return _sides(_flag(df, "sweep_low_reclaim") & gate, _flag(df, "sweep_high_reclaim") & gate)


def release_sweep(df: pd.DataFrame) -> np.ndarray:
    gate = _flag(df, "nfp_window") | _flag(df, "data_clock") | _flag(df, "fomc_window")
    return _sides(_flag(df, "sweep_low_reclaim") & gate, _flag(df, "sweep_high_reclaim") & gate)


SETUPS: dict[str, tuple[str, callable]] = {
    "sweep_reclaim": (
        "LONG after the last 30 minutes trade below the prior 6-hour low and the close reclaims that low. SHORT the mirror at the prior 6-hour high.",
        sweep_reclaim,
    ),
    "sweep_reclaim_volume": (
        "Same reclaim, and turnover over the last 5 minutes is at least 2.5 standard deviations above its trailing 4-hour mean.",
        sweep_reclaim_volume,
    ),
    "sweep_round": (
        "LONG after a sweep and reclaim of the round number just below the price 30 minutes ago. SHORT the round number just above. The step is one order of magnitude below the price (1000 on BTC, 100 on ETH, 10 on SOL).",
        sweep_round,
    ),
    "sweep_prior_day": (
        "LONG after the last 30 minutes take the previous UTC day's low and the close reclaims it. SHORT at the previous day's high.",
        sweep_prior_day,
    ),
    "sweep_prior_week": (
        "LONG after a sweep and reclaim of the previous ISO week's low. SHORT at the previous week's high.",
        sweep_prior_week,
    ),
    "equal_levels": (
        "LONG when two confirmed swing lows sit within 0.15 hourly ATR and the recent one is swept and reclaimed. SHORT at equal highs. A swing is confirmed 15 minutes after it prints.",
        equal_levels,
    ),
    "squeeze_go": (
        "30-minute realised volatility was below 0.7 times its trailing-day median at some point in the last hour, the last 15 minutes expand beyond 1.8 times their 2-hour median range, and the 30-minute return agrees with the direction.",
        squeeze_go,
    ),
    "squeeze_fail": (
        "The same volatility expansion, but price has also reclaimed a swept 6-hour extreme against the break. LONG the failed downside expansion, SHORT the failed upside expansion.",
        squeeze_fail,
    ),
    "burst_continuation": (
        "LONG when a volume burst closes in the top 20% of its 15-minute range and the 30-minute return is positive. SHORT the mirror.",
        burst_continuation,
    ),
    "burst_reversal": (
        "SHORT when a volume burst has a positive 30-minute return but closes in the bottom 20% of its 15-minute range. LONG the mirror.",
        burst_reversal,
    ),
    "funding_sweep": (
        "SHORT a high-side reclaim when funding_z >= 2. LONG a low-side reclaim when funding_z <= -2. funding_z is the last funding print versus the previous 90 prints.",
        funding_sweep,
    ),
    "oi_flush": (
        "LONG a low-side reclaim when open interest just fell by at least 2%. SHORT the high-side mirror. HTX only publishes about 200 recent OI prints, so this is empty on most of the history.",
        oi_flush,
    ),
    "us_open_sweep": (
        "sweep_reclaim restricted to 13:30–15:30 UTC, the window that contains the NYSE cash open in both summer and winter time.",
        us_open_sweep,
    ),
    "london_sweep": (
        "sweep_reclaim restricted to 07:00–09:00 UTC.",
        london_sweep,
    ),
    "release_sweep": (
        "sweep_reclaim during the weekday 12:25–13:05 UTC data slot, the first Friday of the month in that slot (NFP), or 18:00–18:30 UTC on a pre-listed FOMC date.",
        release_sweep,
    ),
}
