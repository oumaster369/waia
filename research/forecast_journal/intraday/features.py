"""Point-in-time 1-minute state, then a forward label kept in separate columns.

Every feature at bar t uses bars with close_time <= t. The label uses the next
4 hours and must not be fed back into a rule or the booster.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.forecast_journal.features.indicators import add_indicators
from research.forecast_journal.intraday.constants import FOMC_DATES, MINUTE_FEATURES, MOVE_ATR, MOVE_HORIZON_MIN
from research.forecast_journal.util import safe_div

LABEL_COLUMNS = ("label_side", "label_delay_min")


def build_minute_frame(
    minute: pd.DataFrame,
    hourly: pd.DataFrame | None = None,
    funding: pd.DataFrame | None = None,
    oi: pd.DataFrame | None = None,
    liquidations: pd.DataFrame | None = None,
    *,
    symbol: str,
    with_labels: bool = True,
    sweep_recent: int = 30,
    sweep_lookback: int = 360,
) -> pd.DataFrame:
    """One row per closed 1-minute bar."""
    if minute is None or minute.empty:
        return pd.DataFrame(columns=list(MINUTE_FEATURES) + list(LABEL_COLUMNS))
    df = minute.sort_values("open_time").drop_duplicates("open_time", keep="last").reset_index(drop=True)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    close = df["close"].to_numpy(dtype=float)
    open_ = df["open"].to_numpy(dtype=float)
    turnover = df["turnover"].to_numpy(dtype=float) if "turnover" in df.columns else np.zeros(len(df))
    ts = df["close_time"].to_numpy(dtype=np.int64)
    atr_1m = _wilder_atr(high, low, close, 14)
    out = pd.DataFrame(
        {
            "symbol": symbol,
            "ts": ts,
            "price": close,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "atr_1m": atr_1m,
        }
    )
    out = _asof(out, _hourly_atr(hourly), {"atr_1h": "atr_1h"})
    # If the hourly cache is missing, a 60-minute Wilder ATR is the same idea.
    if out["atr_1h"].isna().all():
        out["atr_1h"] = _wilder_atr(high, low, close, 60)
    _add_sweeps(out, sweep_recent, sweep_lookback)
    _add_rounds(out, sweep_recent)
    _add_sessions(out)
    _add_day_week(out, sweep_recent)
    _add_equal_swings(out)
    _add_vol_volume(out, high, low, close, turnover)
    out = _asof(out, _funding_z(funding), {"funding_z": "funding_z", "funding_rate": "funding_rate"})
    out = _asof(out, _oi_change(oi), {"oi_change": "oi_change"})
    out = _asof(out, _liq_roll(liquidations), {"liq_notional_15m": "liq_notional_15m", "liq_imbalance_15m": "liq_imbalance_15m"})
    _add_distances_and_pools(out)
    if with_labels:
        side, delay = first_move(high, low, close, out["atr_1h"].to_numpy(dtype=float), MOVE_HORIZON_MIN, MOVE_ATR)
        out["label_side"] = side
        out["label_delay_min"] = delay
    else:
        out["label_side"] = 0
        out["label_delay_min"] = -1
    for column in MINUTE_FEATURES:
        if column not in out.columns:
            out[column] = np.nan
    return out


def first_move(high, low, close, atr, horizon: int, multiple: float) -> tuple[np.ndarray, np.ndarray]:
    """+1 if the up move prints first, -1 if the down move prints first, else 0.

    A bar that crosses both thresholds in the same minute is left unlabeled.
    """
    high = np.asarray(high, dtype=float)
    low = np.asarray(low, dtype=float)
    close = np.asarray(close, dtype=float)
    atr = np.asarray(atr, dtype=float)
    n = len(close)
    side = np.zeros(n, dtype=np.int8)
    delay = np.full(n, -1, dtype=np.int16)
    thresh = multiple * atr
    unresolved = np.isfinite(thresh) & (thresh > 0) & np.isfinite(close)
    if n <= horizon:
        return side, delay
    unresolved[n - horizon :] = False
    for k in range(1, horizon + 1):
        if not unresolved.any():
            break
        up = unresolved[:-k] & (high[k:] >= close[:-k] + thresh[:-k])
        dn = unresolved[:-k] & (low[k:] <= close[:-k] - thresh[:-k])
        both = up & dn
        only_up = np.flatnonzero(up & ~dn)
        only_dn = np.flatnonzero(dn & ~up)
        side[only_up] = 1
        delay[only_up] = k
        side[only_dn] = -1
        delay[only_dn] = k
        unresolved[only_up] = False
        unresolved[only_dn] = False
        unresolved[np.flatnonzero(both)] = False
    return side, delay


def _wilder_atr(high, low, close, n: int) -> np.ndarray:
    prev = np.empty_like(close)
    prev[0] = close[0]
    prev[1:] = close[:-1]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
    return pd.Series(tr).ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean().to_numpy()


def _hourly_atr(hourly: pd.DataFrame | None) -> pd.DataFrame:
    if hourly is None or hourly.empty:
        return pd.DataFrame(columns=["ts", "atr_1h"])
    ind = add_indicators(hourly, vwap_bars=6, swing_bars=24, cvd_bars=1, rv_bars=24, vol_z_bars=90)
    return pd.DataFrame({"ts": ind["close_time"].to_numpy(dtype=np.int64), "atr_1h": ind["atr_14"].to_numpy(dtype=float)})


def _funding_z(funding: pd.DataFrame | None) -> pd.DataFrame:
    if funding is None or funding.empty or "funding_rate" not in funding.columns:
        return pd.DataFrame(columns=["ts", "funding_z", "funding_rate"])
    df = funding.sort_values("ts").drop_duplicates("ts", keep="last")
    rate = df["funding_rate"].astype(float)
    mu = rate.rolling(90, min_periods=20).mean()
    sd = rate.rolling(90, min_periods=20).std()
    return pd.DataFrame(
        {
            "ts": df["ts"].to_numpy(dtype=np.int64),
            "funding_rate": rate.to_numpy(dtype=float),
            "funding_z": safe_div((rate - mu).to_numpy(), sd.to_numpy()),
        }
    )


def _oi_change(oi: pd.DataFrame | None) -> pd.DataFrame:
    if oi is None or oi.empty or "ts" not in oi.columns:
        return pd.DataFrame(columns=["ts", "oi_change"])
    df = oi.sort_values("ts").drop_duplicates("ts", keep="last")
    value = df["oi_value"] if "oi_value" in df.columns else df.get("oi_volume")
    if value is None:
        return pd.DataFrame(columns=["ts", "oi_change"])
    return pd.DataFrame({"ts": df["ts"].to_numpy(dtype=np.int64), "oi_change": value.astype(float).pct_change().to_numpy()})


def _liq_roll(liq: pd.DataFrame | None) -> pd.DataFrame:
    if liq is None or liq.empty or "ts" not in liq.columns:
        return pd.DataFrame(columns=["ts", "liq_notional_15m", "liq_imbalance_15m"])
    df = liq.sort_values("ts")
    buy = df["buy_turnover"].astype(float) if "buy_turnover" in df.columns else 0.0
    sell = df["sell_turnover"].astype(float) if "sell_turnover" in df.columns else 0.0
    frame = pd.DataFrame({"ts": df["ts"].to_numpy(dtype=np.int64), "buy": buy, "sell": sell})
    frame = frame.groupby("ts", as_index=False)[["buy", "sell"]].sum().sort_values("ts")
    # 15 prints on a sparse liquidation clock, not 15 minutes. The asof onto
    # minute bars then holds the last aggregate. History is only a short buffer.
    roll_b = frame["buy"].rolling(15, min_periods=1).sum()
    roll_s = frame["sell"].rolling(15, min_periods=1).sum()
    total = roll_b + roll_s
    return pd.DataFrame(
        {
            "ts": frame["ts"].to_numpy(dtype=np.int64),
            "liq_notional_15m": total.to_numpy(dtype=float),
            "liq_imbalance_15m": safe_div((roll_b - roll_s).to_numpy(), total.to_numpy()),
        }
    )


def _asof(left: pd.DataFrame, right: pd.DataFrame, columns: dict[str, str]) -> pd.DataFrame:
    left = left.sort_values("ts")
    if right is None or right.empty or "ts" not in right.columns:
        for name in columns.values():
            if name not in left.columns:
                left[name] = np.nan
        return left
    have = [src for src in columns if src in right.columns]
    use = right[["ts", *have]].dropna(subset=["ts"]).sort_values("ts")
    use = use.rename(columns={src: columns[src] for src in have})
    replace = [columns[src] for src in have if columns[src] in left.columns]
    if replace:
        left = left.drop(columns=replace)
    return pd.merge_asof(left, use, on="ts", direction="backward")


def _add_sweeps(out: pd.DataFrame, recent: int, lookback: int) -> None:
    high = out["high"]
    low = out["low"]
    close = out["close"]
    prior_high = high.shift(recent).rolling(lookback, min_periods=max(20, lookback // 6)).max()
    prior_low = low.shift(recent).rolling(lookback, min_periods=max(20, lookback // 6)).min()
    wick_high = high.rolling(recent, min_periods=max(3, recent // 6)).max()
    wick_low = low.rolling(recent, min_periods=max(3, recent // 6)).min()
    out["swept_high_level"] = prior_high
    out["swept_low_level"] = prior_low
    out["sweep_wick_high"] = wick_high
    out["sweep_wick_low"] = wick_low
    out["sweep_high_reclaim"] = ((wick_high > prior_high) & (close < prior_high)).astype(float)
    out["sweep_low_reclaim"] = ((wick_low < prior_low) & (close > prior_low)).astype(float)


def _add_rounds(out: pd.DataFrame, recent: int) -> None:
    ref = out["close"].shift(recent)
    step = 10.0 ** np.floor(np.log10(np.clip(ref.to_numpy(dtype=float), 1e-8, None)) - 1.0)
    step = np.where(np.isfinite(step) & (step > 0), step, np.nan)
    above = np.floor(ref.to_numpy(dtype=float) / step) * step + step
    below = np.ceil(ref.to_numpy(dtype=float) / step) * step - step
    out["round_above"] = above
    out["round_below"] = below
    wick_high = out["sweep_wick_high"].to_numpy(dtype=float)
    wick_low = out["sweep_wick_low"].to_numpy(dtype=float)
    close = out["close"].to_numpy(dtype=float)
    out["sweep_round_high"] = ((wick_high >= above) & (close < above)).astype(float)
    out["sweep_round_low"] = ((wick_low <= below) & (close > below)).astype(float)


def _add_sessions(out: pd.DataFrame) -> None:
    ts = pd.to_datetime(out["ts"], unit="s", utc=True)
    hour = ts.dt.hour.to_numpy()
    minute = ts.dt.minute.to_numpy()
    mod = hour * 60 + minute
    out["hour_utc"] = hour.astype(float)
    # 13:30 and 14:30 UTC cover the NYSE cash open in both daylight and standard time.
    out["us_open"] = ((mod >= 13 * 60 + 30) & (mod < 15 * 60 + 30)).astype(float)
    out["london_open"] = ((hour >= 7) & (hour < 9)).astype(float)
    friday = ts.dt.dayofweek.to_numpy() == 4
    first_week = ts.dt.day.to_numpy() <= 7
    data_clock = ((hour == 12) & (minute >= 25)) | ((hour == 13) & (minute <= 5))
    out["data_clock"] = data_clock.astype(float)
    out["nfp_window"] = (friday & first_week & data_clock).astype(float)
    dates = ts.dt.strftime("%Y-%m-%d")
    fomc_day = dates.isin(FOMC_DATES).to_numpy()
    fomc_time = (hour == 18) & (minute <= 30)
    out["fomc_window"] = (fomc_day & fomc_time).astype(float)


def _add_day_week(out: pd.DataFrame, recent: int) -> None:
    ts = pd.to_datetime(out["ts"], unit="s", utc=True)
    day = ts.dt.strftime("%Y-%m-%d")
    daily = out.assign(_day=day).groupby("_day", sort=True).agg(dh=("high", "max"), dl=("low", "min"))
    daily["pdh"] = daily["dh"].shift(1)
    daily["pdl"] = daily["dl"].shift(1)
    mapped = day.map(daily["pdh"])
    out["pdh"] = mapped.to_numpy(dtype=float)
    out["pdl"] = day.map(daily["pdl"]).to_numpy(dtype=float)
    iso = ts.dt.isocalendar()
    week = (iso["year"].astype(str) + "-" + iso["week"].astype(str)).to_numpy()
    weekly = out.assign(_week=week).groupby("_week", sort=False).agg(wh=("high", "max"), wl=("low", "min"))
    # groupby sort=False does not guarantee chronological weeks. Sort by first ts.
    order = out.assign(_week=week).groupby("_week", sort=False)["ts"].min().sort_values()
    weekly = weekly.loc[order.index]
    weekly["pwh"] = weekly["wh"].shift(1)
    weekly["pwl"] = weekly["wl"].shift(1)
    out["week_high"] = pd.Series(week).map(weekly["pwh"]).to_numpy(dtype=float)
    out["week_low"] = pd.Series(week).map(weekly["pwl"]).to_numpy(dtype=float)
    wick_high = out["sweep_wick_high"]
    wick_low = out["sweep_wick_low"]
    close = out["close"]
    out["sweep_pdh"] = ((wick_high > out["pdh"]) & (close < out["pdh"])).astype(float)
    out["sweep_pdl"] = ((wick_low < out["pdl"]) & (close > out["pdl"])).astype(float)
    out["sweep_week_high"] = ((wick_high > out["week_high"]) & (close < out["week_high"])).astype(float)
    out["sweep_week_low"] = ((wick_low < out["week_low"]) & (close > out["week_low"])).astype(float)
    _ = recent


def _add_equal_swings(out: pd.DataFrame) -> None:
    """Two confirmed swings within 0.15 ATR. A swing is confirmed 15 minutes later."""
    right = 15
    width = 31
    high = out["high"]
    low = out["low"]
    atr = out["atr_1h"]
    is_high = high.shift(right) >= high.rolling(width, min_periods=width).max()
    is_low = low.shift(right) <= low.rolling(width, min_periods=width).min()
    last_h = high.shift(right).where(is_high).ffill()
    last_l = low.shift(right).where(is_low).ffill()
    changed_h = last_h.ne(last_h.shift())
    changed_l = last_l.ne(last_l.shift())
    prev_h = last_h.shift(1).where(changed_h).ffill()
    prev_l = last_l.shift(1).where(changed_l).ffill()
    tol = 0.15 * atr
    eq_h = (last_h - prev_h).abs() <= tol
    eq_l = (last_l - prev_l).abs() <= tol
    out["equal_highs"] = eq_h.fillna(False).astype(float)
    out["equal_lows"] = eq_l.fillna(False).astype(float)
    out["equal_high_level"] = last_h.where(eq_h)
    out["equal_low_level"] = last_l.where(eq_l)


def _add_vol_volume(out, high, low, close, turnover) -> None:
    log_ret = np.log(pd.Series(close)).diff()
    rv = log_ret.rolling(30, min_periods=20).std()
    base = rv.rolling(24 * 60, min_periods=120).median()
    squeeze_now = rv < (0.70 * base)
    out["squeeze"] = squeeze_now.rolling(60, min_periods=1).max().fillna(0).clip(0, 1)
    range_15 = pd.Series(high - low).rolling(15, min_periods=10).mean()
    range_base = pd.Series(high - low).rolling(120, min_periods=30).median()
    expansion = range_15 > (1.8 * range_base)
    out["expansion"] = expansion.fillna(False).astype(float)
    out["squeeze_expansion"] = ((out["squeeze"] > 0) & expansion.fillna(False)).astype(float)
    out["rv_ratio"] = safe_div(rv.to_numpy(), base.to_numpy())
    turn = pd.Series(turnover, dtype=float)
    mu = turn.rolling(240, min_periods=60).mean()
    sd = turn.rolling(240, min_periods=60).std()
    z = pd.Series(safe_div((turn - mu).to_numpy(), sd.to_numpy()))
    out["volume_z"] = z.to_numpy()
    out["volume_burst"] = (z.rolling(5, min_periods=1).max() >= 2.5).fillna(False).astype(float)
    span = high - low
    signed = np.clip(safe_div((2.0 * (close - low) - span), span), -1.0, 1.0) * turnover
    num = pd.Series(signed).rolling(15, min_periods=10).sum()
    den = turn.rolling(15, min_periods=10).sum()
    out["taker_proxy"] = safe_div(num.to_numpy(), den.to_numpy())
    hh = pd.Series(high).rolling(15, min_periods=10).max()
    ll = pd.Series(low).rolling(15, min_periods=10).min()
    out["close_pos_15"] = safe_div((close - ll.to_numpy()), (hh - ll).to_numpy())
    atr = out["atr_1h"].to_numpy(dtype=float)
    out["ret_30m_atr"] = safe_div(close - pd.Series(close).shift(30).to_numpy(), atr)


def _add_distances_and_pools(out: pd.DataFrame) -> None:
    price = out["price"].to_numpy(dtype=float)
    atr = out["atr_1h"].to_numpy(dtype=float)
    out["dist_pdh_atr"] = safe_div(out["pdh"].to_numpy(dtype=float) - price, atr)
    out["dist_pdl_atr"] = safe_div(price - out["pdl"].to_numpy(dtype=float), atr)
    out["dist_week_high_atr"] = safe_div(out["week_high"].to_numpy(dtype=float) - price, atr)
    out["dist_week_low_atr"] = safe_div(price - out["week_low"].to_numpy(dtype=float), atr)
    up_cols = ["pdh", "week_high", "swept_high_level", "round_above", "equal_high_level", "sweep_wick_high"]
    dn_cols = ["pdl", "week_low", "swept_low_level", "round_below", "equal_low_level", "sweep_wick_low"]
    up = np.column_stack([out[name].to_numpy(dtype=float) for name in up_cols])
    dn = np.column_stack([out[name].to_numpy(dtype=float) for name in dn_cols])
    floor = price + 0.25 * np.where(np.isfinite(atr), atr, np.nan)
    cap = price - 0.25 * np.where(np.isfinite(atr), atr, np.nan)
    up = np.where(np.isfinite(up) & (up > floor[:, None]), up, np.inf)
    dn = np.where(np.isfinite(dn) & (dn < cap[:, None]), dn, -np.inf)
    next_up = np.min(up, axis=1)
    next_dn = np.max(dn, axis=1)
    next_up[~np.isfinite(next_up)] = np.nan
    next_dn[~np.isfinite(next_dn)] = np.nan
    out["next_pool_up"] = next_up
    out["next_pool_dn"] = next_dn
