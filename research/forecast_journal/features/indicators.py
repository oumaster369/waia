"""Trailing indicators. Every column at row i uses rows [:i] only."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.forecast_journal.util import safe_div


def add_indicators(
    frame: pd.DataFrame,
    *,
    vwap_bars: int,
    swing_bars: int = 24,
    vol_z_bars: int = 120,
    rv_bars: int = 24,
    cvd_bars: int = 1,
    atr_n: int = 14,
) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame()
    df = frame.sort_values("open_time").drop_duplicates("open_time", keep="last").reset_index(drop=True)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    close = df["close"].astype(float)
    turnover = df["turnover"].astype(float) if "turnover" in df.columns else pd.Series(0.0, index=df.index)
    prev = close.shift(1)
    tr = pd.concat([(high - low), (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    df["atr_14"] = tr.ewm(alpha=1.0 / atr_n, adjust=False, min_periods=atr_n).mean()
    df["ema20"] = close.ewm(span=20, adjust=False, min_periods=20).mean()
    df["ema50"] = close.ewm(span=50, adjust=False, min_periods=50).mean()
    df["ema200"] = close.ewm(span=200, adjust=False, min_periods=200).mean()
    df["ema20_slope_atr"] = safe_div((df["ema20"] - df["ema20"].shift(1)).to_numpy(), df["atr_14"].to_numpy())
    typical = (high + low + close) / 3.0
    weight = turnover.where(turnover > 0, df["volume"].astype(float))
    pv = (typical * weight).rolling(vwap_bars, min_periods=max(3, vwap_bars // 3)).sum()
    ww = weight.rolling(vwap_bars, min_periods=max(3, vwap_bars // 3)).sum()
    df["vwap"] = safe_div(pv.to_numpy(), ww.to_numpy())
    span = (high - low).to_numpy()
    df["close_pos"] = safe_div((close - low).to_numpy(), span)
    df["range_pct"] = safe_div(span, close.to_numpy())
    # Close location in [-1, 1]: +1 closes on the high, -1 on the low.
    df["signed_frac"] = np.clip(safe_div((2.0 * (close - low) - (high - low)).to_numpy(), span), -1.0, 1.0)
    signed_turn = df["signed_frac"].to_numpy() * weight.to_numpy()
    cvd = pd.Series(signed_turn).rolling(cvd_bars, min_periods=cvd_bars).sum()
    turn = weight.rolling(cvd_bars, min_periods=cvd_bars).sum()
    df["cvd_ratio"] = safe_div(cvd.to_numpy(), turn.to_numpy())
    log_ret = np.log(close).diff()
    df["rv"] = log_ret.rolling(rv_bars, min_periods=max(5, rv_bars // 2)).std()
    mu = weight.rolling(vol_z_bars, min_periods=max(10, vol_z_bars // 5)).mean()
    sd = weight.rolling(vol_z_bars, min_periods=max(10, vol_z_bars // 5)).std()
    df["turnover_z"] = safe_div((weight - mu).to_numpy(), sd.to_numpy())
    df["swing_high"] = high.rolling(swing_bars, min_periods=max(5, swing_bars // 4)).max()
    df["swing_low"] = low.rolling(swing_bars, min_periods=max(5, swing_bars // 4)).min()
    df["prior_high"] = high.shift(1).rolling(swing_bars, min_periods=max(5, swing_bars // 4)).max()
    df["prior_low"] = low.shift(1).rolling(swing_bars, min_periods=max(5, swing_bars // 4)).min()
    df["atr_q20"] = df["atr_14"].rolling(vol_z_bars, min_periods=max(20, vol_z_bars // 4)).quantile(0.20)
    df["atr_q33"] = df["atr_14"].rolling(vol_z_bars, min_periods=max(20, vol_z_bars // 4)).quantile(0.33)
    df["atr_q66"] = df["atr_14"].rolling(vol_z_bars, min_periods=max(20, vol_z_bars // 4)).quantile(0.66)
    df["ret_1"] = close.pct_change(1)
    return df
