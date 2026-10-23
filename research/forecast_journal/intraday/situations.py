"""Situational strategies. Each situation has its own rule. Nothing here is a universal filter.

S1 sweep and reclaim, S2 squeeze break, S3 trend pullback, S4 range fade,
S5 cascade reversal, S6 US-open and data-release momentum. Each base is also
re-run inside trend, range, and high-vol regimes. Thresholds are pre-registered.

Decision time is the bar close. Stops and targets use only that information.
The position fills on the next bar's open.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from research.forecast_journal.data.loader import read_kline
from research.forecast_journal.features.indicators import add_indicators
from research.forecast_journal.intraday.constants import (
    FEE_PER_SIDE,
    FOMC_DATES,
    SITUATION_ADX_RANGE,
    SITUATION_EQUAL_ATR,
    SITUATION_EXT_ATR,
    SITUATION_FLAT_ATR,
    SITUATION_FLAT_SLOPE,
    SITUATION_POOL_ATR,
    SITUATION_SPIKE_Z,
    SITUATION_STOP_ATR,
    SITUATION_VOLUME_Z,
)
from research.forecast_journal.intraday.execute import max_drawdown, simulate_levels
from research.forecast_journal.metrics.stats import benjamini_hochberg, deflated_sharpe, mean_r_test, sharpe_ratio
from research.forecast_journal.util import iso_utc, parse_utc_date

TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400}
BASES = ("S1", "S2", "S3", "S4", "S5", "S6")
FILTERS = ("trend", "range", "highvol")
BURN_SECONDS = 20 * 86400

NAMES_RU = {
    "S1": "Снятие ликвидности и возврат",
    "S2": "Выход из сжатия",
    "S3": "Откат по тренду",
    "S4": "Возврат к середине боковика",
    "S5": "Разворот после каскада",
    "S6": "Импульс на открытии США и данных",
}
FILTERS_RU = {
    "trend": "только по тренду 4ч",
    "range": "только в боковике",
    "highvol": "только при высокой волатильности",
}

FORMULAS = {
    "S1": (
        "Swing high/low confirmed with a 30-minute wing on each side, or two such swings within "
        "0.15·ATR_1h (equal highs/lows). A later bar trades through that level and, one to three bars "
        "after the sweep — not on the sweep bar itself — closes back through it. Entry is the next open. "
        "Stop is the sweep extreme ± 0.3·ATR_1h. Target is the nearer opposite pool (last opposite swing "
        "or the prior 24h extreme) at least 0.25·ATR away."
    ),
    "S2": (
        "ATR_1h is at or below its own trailing 20-day 20th percentile. Close breaks the prior 24h high "
        "or low, the previous close had not, and volume z-score on the break bar is at least 1. "
        "Stop is 0.3·ATR_1h back through the broken level. Target is a measured move of one 24h-range height."
    ),
    "S3": (
        "4h trend: EMA20 vs EMA50, slope in the same direction, price beyond EMA50. The decision bar tags "
        "1h EMA20 or 1h VWAP (24h) and closes back with the trend. Stop is 0.3·ATR_1h beyond the pullback "
        "extreme. Target is the nearer pool in the trend direction."
    ),
    "S4": (
        "4h regime is range: ADX14 < 20, or |EMA20−EMA50| < 0.50·ATR and |slope| < 0.08. Fade a wick through "
        "the prior 24h extreme that closes back inside. Stop is 0.3·ATR_1h beyond that extreme. Target is the range mid."
    ),
    "S5": (
        "Previous bar has volume z-score ≥ 2.5 (liquidation prints are not a 2024 history on the public API, "
        "so they are not required) and price is more than 2·ATR_1h from the 1h EMA20. This bar is the first "
        "reversal bar. Stop is 0.3·ATR_1h beyond the spike extreme. Target is the EMA or the next pool."
    ),
    "S6": (
        "Clock is 13:30–15:30 UTC, or a weekday 12:25–13:05 UTC data slot, or 18:00–18:30 UTC on a pre-listed "
        "FOMC date. Close breaks the prior 30-minute high or low with volume z-score ≥ 1. Stop is 0.3·ATR_1h "
        "beyond the broken level. Target is the next 24h or swing pool, else one 30-minute range beyond the break."
    ),
}

STATE_PATH = Path(__file__).with_name("situations_armed.json")


def swing_wing(bar_seconds: int) -> int:
    return max(2, int(round(1800 / bar_seconds)))


def all_ids() -> list[str]:
    ids = list(BASES)
    for base in BASES:
        for filt in FILTERS:
            ids.append(f"{base}_{filt}")
    return ids


def run_situations(
    data_dir: Path,
    symbols: list[str],
    *,
    timeframes: tuple[str, ...] = ("15m", "5m", "1m"),
    start: str = "2024-01-01",
    fee: float = FEE_PER_SIDE,
    log=print,
) -> dict:
    start_ts = parse_utc_date(start)
    frames = []
    for tf in timeframes:
        log(f"situation study {tf} symbols {','.join(symbols)}")
        frames.append(_run_timeframe(data_dir, symbols, tf, start_ts, fee, log))
    result = _combine(frames, fee)
    _write_state(result)
    return result


def situation_features(
    window: pd.DataFrame,
    hourly: pd.DataFrame | None,
    h4: pd.DataFrame | None,
    *,
    symbol: str = "BTC",
    decision_tf: str = "1m",
) -> dict:
    """Last closed bar, with a side/stop/target for every situation."""
    prep = prepare_frame(window, hourly, h4, decision_tf, symbol)
    if prep.empty:
        return {}
    sigs = signal_table(prep, TF_SECONDS[decision_tf])
    last = len(prep) - 1
    row = {
        "study": "situations",
        "decision_tf": decision_tf,
        "symbol": symbol,
        "ts": int(prep["ts"].iloc[last]),
        "price": float(prep["close"].iloc[last]),
        "atr_1h": _plain(prep["atr_1h"].iloc[last]),
        "atr_bar": _plain(prep["atr_bar"].iloc[last]),
    }
    for sid, (side, stop, target) in sigs.items():
        code = int(side[last])
        row[f"{sid}_side"] = "long" if code > 0 else "short" if code < 0 else "flat"
        row[f"{sid}_stop"] = _plain(stop[last])
        row[f"{sid}_target"] = _plain(target[last])
    return row


def prepare_frame(
    bars: pd.DataFrame,
    hourly: pd.DataFrame | None,
    h4: pd.DataFrame | None,
    decision_tf: str,
    symbol: str,
) -> pd.DataFrame:
    bar_seconds = TF_SECONDS[decision_tf]
    if bars is None or bars.empty:
        return pd.DataFrame()
    df = bars.sort_values("open_time").drop_duplicates("open_time", keep="last").reset_index(drop=True)
    if "close_time" in df.columns and df["close_time"].notna().any():
        df["ts"] = df["close_time"].astype(np.int64)
    else:
        df["ts"] = df["open_time"].astype(np.int64) + bar_seconds
    df["symbol"] = symbol
    weight = df["turnover"].astype(float) if "turnover" in df.columns else df["volume"].astype(float)
    if float(np.nansum(weight.to_numpy())) <= 0 and "volume" in df.columns:
        weight = df["volume"].astype(float)
    df["weight"] = weight
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    close = df["close"].astype(float)
    prev = close.shift(1)
    tr = pd.concat([(high - low), (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    df["atr_bar"] = tr.ewm(alpha=1.0 / 14.0, adjust=False, min_periods=14).mean()
    bars_24h = max(8, 86400 // bar_seconds)
    df["prior_high_24"] = high.shift(1).rolling(bars_24h, min_periods=bars_24h).max()
    df["prior_low_24"] = low.shift(1).rolling(bars_24h, min_periods=bars_24h).min()
    bars_30 = max(1, 1800 // bar_seconds)
    df["prior_high_30"] = high.shift(1).rolling(bars_30, min_periods=bars_30).max()
    df["prior_low_30"] = low.shift(1).rolling(bars_30, min_periods=bars_30).min()
    vol_w = bars_24h
    mu = weight.rolling(vol_w, min_periods=max(20, vol_w // 5)).mean()
    sd = weight.rolling(vol_w, min_periods=max(20, vol_w // 5)).std()
    df["volume_z"] = (weight - mu) / sd.replace(0, np.nan)
    _attach_higher(df, hourly, h4)
    return df


def signal_table(frame: pd.DataFrame, bar_seconds: int) -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Every situation id → (side int8, stop, target). Side +1 long, −1 short."""
    base = {
        "S1": s1_arrays(frame, swing_wing(bar_seconds)),
        "S2": s2_arrays(frame),
        "S3": s3_arrays(frame),
        "S4": s4_arrays(frame),
        "S5": s5_arrays(frame),
        "S6": s6_arrays(frame),
    }
    trend_up = _bool(frame, "trend_up")
    trend_down = _bool(frame, "trend_down")
    is_range = _bool(frame, "is_range")
    high_vol = _bool(frame, "high_vol")
    out: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for sid, (side, stop, target) in base.items():
        out[sid] = (side, stop, target)
        out[f"{sid}_trend"] = (_apply_regime(side, "trend", trend_up, trend_down, is_range, high_vol), stop, target)
        out[f"{sid}_range"] = (_apply_regime(side, "range", trend_up, trend_down, is_range, high_vol), stop, target)
        out[f"{sid}_highvol"] = (_apply_regime(side, "highvol", trend_up, trend_down, is_range, high_vol), stop, target)
    return out


def s1_arrays(frame: pd.DataFrame, wing: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    atr = frame["atr_1h"].to_numpy(dtype=float)
    n = len(frame)
    event_h, event_l = _fractal_events(high, low, wing)
    level_h = _equal_level(event_h, atr, higher=True).shift(1).to_numpy(dtype=float)
    level_l = _equal_level(event_l, atr, higher=False).shift(1).to_numpy(dtype=float)
    reclaim_s, ext_h = _reclaim(high, close, level_h, above=True)
    reclaim_l, ext_l = _reclaim(low, close, level_l, above=False)
    pool_h = _known_swing(event_h).to_numpy(dtype=float)
    pool_l = _known_swing(event_l).to_numpy(dtype=float)
    prior_h = frame["prior_high_24"].to_numpy(dtype=float)
    prior_l = frame["prior_low_24"].to_numpy(dtype=float)
    tgt_long = _nearest_above(close, atr, pool_h, prior_h)
    tgt_short = _nearest_below(close, atr, pool_l, prior_l)
    stop_long = ext_l - SITUATION_STOP_ATR * atr
    stop_short = ext_h + SITUATION_STOP_ATR * atr
    side = _exclusive(reclaim_l, reclaim_s)
    stop = np.where(side > 0, stop_long, np.where(side < 0, stop_short, np.nan))
    target = np.where(side > 0, tgt_long, np.where(side < 0, tgt_short, np.nan))
    _ = n
    return side, stop, target


def s2_arrays(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    close = frame["close"].to_numpy(dtype=float)
    atr = frame["atr_1h"].to_numpy(dtype=float)
    q20 = frame["atr_q20"].to_numpy(dtype=float) if "atr_q20" in frame.columns else np.full(len(frame), np.nan)
    z = frame["volume_z"].to_numpy(dtype=float)
    prior_h = frame["prior_high_24"].to_numpy(dtype=float)
    prior_l = frame["prior_low_24"].to_numpy(dtype=float)
    prev_close = np.roll(close, 1)
    prev_close[0] = np.nan
    squeeze = np.isfinite(atr) & np.isfinite(q20) & (atr <= q20)
    vol = np.isfinite(z) & (z >= SITUATION_VOLUME_Z)
    long = squeeze & vol & np.isfinite(prior_h) & (close > prior_h) & (prev_close <= prior_h)
    short = squeeze & vol & np.isfinite(prior_l) & (close < prior_l) & (prev_close >= prior_l)
    height = prior_h - prior_l
    stop_long = prior_h - SITUATION_STOP_ATR * atr
    stop_short = prior_l + SITUATION_STOP_ATR * atr
    tgt_long = prior_h + height
    tgt_short = prior_l - height
    return _pack_side(long, short, stop_long, stop_short, tgt_long, tgt_short)


def s3_arrays(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    open_ = frame["open"].to_numpy(dtype=float)
    atr = frame["atr_1h"].to_numpy(dtype=float)
    ema = frame["ema20_1h"].to_numpy(dtype=float) if "ema20_1h" in frame.columns else np.full(len(frame), np.nan)
    vwap = frame["vwap_1h"].to_numpy(dtype=float) if "vwap_1h" in frame.columns else np.full(len(frame), np.nan)
    trend_up = _bool(frame, "trend_up")
    trend_down = _bool(frame, "trend_down")
    tag_long = (np.isfinite(ema) & (low <= ema) & (close > ema)) | (np.isfinite(vwap) & (low <= vwap) & (close > vwap))
    tag_short = (np.isfinite(ema) & (high >= ema) & (close < ema)) | (np.isfinite(vwap) & (high >= vwap) & (close < vwap))
    long = trend_up & tag_long & (close > open_)
    short = trend_down & tag_short & (close < open_)
    event_h, event_l = _fractal_events(high, low, swing_wing(_bar_seconds(frame)))
    pool_h = _known_swing(event_h).to_numpy(dtype=float)
    pool_l = _known_swing(event_l).to_numpy(dtype=float)
    prior_h = frame["prior_high_24"].to_numpy(dtype=float)
    prior_l = frame["prior_low_24"].to_numpy(dtype=float)
    tgt_long = _nearest_above(close, atr, pool_h, prior_h)
    tgt_short = _nearest_below(close, atr, pool_l, prior_l)
    return _pack_side(long, short, low - SITUATION_STOP_ATR * atr, high + SITUATION_STOP_ATR * atr, tgt_long, tgt_short)


def s4_arrays(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    open_ = frame["open"].to_numpy(dtype=float)
    atr = frame["atr_1h"].to_numpy(dtype=float)
    prior_h = frame["prior_high_24"].to_numpy(dtype=float)
    prior_l = frame["prior_low_24"].to_numpy(dtype=float)
    is_range = _bool(frame, "is_range")
    mid = (prior_h + prior_l) / 2.0
    long = is_range & np.isfinite(prior_l) & (low <= prior_l) & (close > prior_l) & (close > open_)
    short = is_range & np.isfinite(prior_h) & (high >= prior_h) & (close < prior_h) & (close < open_)
    return _pack_side(long, short, low - SITUATION_STOP_ATR * atr, high + SITUATION_STOP_ATR * atr, mid, mid)


def s5_arrays(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    open_ = frame["open"].to_numpy(dtype=float)
    atr = frame["atr_1h"].to_numpy(dtype=float)
    ema = frame["ema20_1h"].to_numpy(dtype=float) if "ema20_1h" in frame.columns else np.full(len(frame), np.nan)
    z = frame["volume_z"].to_numpy(dtype=float)
    prev_z = np.roll(z, 1)
    prev_z[0] = np.nan
    prev_close = np.roll(close, 1)
    prev_close[0] = np.nan
    prev_open = np.roll(open_, 1)
    prev_open[0] = np.nan
    prev_high = np.roll(high, 1)
    prev_high[0] = np.nan
    prev_low = np.roll(low, 1)
    prev_low[0] = np.nan
    spike = np.isfinite(prev_z) & (prev_z >= SITUATION_SPIKE_Z)
    ext_up = np.isfinite(ema) & np.isfinite(atr) & ((prev_close - ema) > SITUATION_EXT_ATR * atr)
    ext_dn = np.isfinite(ema) & np.isfinite(atr) & ((ema - prev_close) > SITUATION_EXT_ATR * atr)
    pushed_up = prev_close > prev_open
    pushed_dn = prev_close < prev_open
    short = spike & ext_up & pushed_up & (close < open_) & (close < prev_close)
    long = spike & ext_dn & pushed_dn & (close > open_) & (close > prev_close)
    prior_h = frame["prior_high_24"].to_numpy(dtype=float)
    prior_l = frame["prior_low_24"].to_numpy(dtype=float)
    tgt_long = _nearest_above(close, atr, ema, prior_h)
    tgt_short = _nearest_below(close, atr, ema, prior_l)
    stop_long = np.minimum(low, prev_low) - SITUATION_STOP_ATR * atr
    stop_short = np.maximum(high, prev_high) + SITUATION_STOP_ATR * atr
    return _pack_side(long, short, stop_long, stop_short, tgt_long, tgt_short)


def s6_arrays(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    close = frame["close"].to_numpy(dtype=float)
    atr = frame["atr_1h"].to_numpy(dtype=float)
    z = frame["volume_z"].to_numpy(dtype=float)
    ts = frame["ts"].to_numpy(dtype=np.int64)
    prior30_h = frame["prior_high_30"].to_numpy(dtype=float)
    prior30_l = frame["prior_low_30"].to_numpy(dtype=float)
    prior_h = frame["prior_high_24"].to_numpy(dtype=float)
    prior_l = frame["prior_low_24"].to_numpy(dtype=float)
    flags = _clock_flags(ts)
    prev_close = np.roll(close, 1)
    prev_close[0] = np.nan
    vol = np.isfinite(z) & (z >= SITUATION_VOLUME_Z)
    long = flags & vol & np.isfinite(prior30_h) & (close > prior30_h) & (prev_close <= prior30_h)
    short = flags & vol & np.isfinite(prior30_l) & (close < prior30_l) & (prev_close >= prior30_l)
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    event_h, event_l = _fractal_events(high, low, swing_wing(_bar_seconds(frame)))
    pool_h = _nearest_above(close, atr, _known_swing(event_h).to_numpy(dtype=float), prior_h)
    pool_l = _nearest_below(close, atr, _known_swing(event_l).to_numpy(dtype=float), prior_l)
    span = np.maximum(prior30_h - prior30_l, 1.5 * atr)
    tgt_long = np.where(np.isfinite(pool_h), pool_h, prior30_h + span)
    tgt_short = np.where(np.isfinite(pool_l), pool_l, prior30_l - span)
    return _pack_side(
        long,
        short,
        prior30_h - SITUATION_STOP_ATR * atr,
        prior30_l + SITUATION_STOP_ATR * atr,
        tgt_long,
        tgt_short,
    )


def resample_ohlc(minute: pd.DataFrame, seconds: int) -> pd.DataFrame:
    if minute is None or minute.empty:
        return pd.DataFrame()
    frame = minute.sort_values("open_time").drop_duplicates("open_time", keep="last")
    bucket = (frame["open_time"].to_numpy(dtype=np.int64) // seconds) * seconds
    work = frame.copy()
    work["bucket"] = bucket
    agg = {"open": "first", "high": "max", "low": "min", "close": "last"}
    for name in ("volume", "turnover", "trades"):
        if name in work.columns:
            agg[name] = "sum"
    out = work.groupby("bucket", sort=True).agg(agg).reset_index().rename(columns={"bucket": "open_time"})
    out["close_time"] = out["open_time"].astype(np.int64) + seconds
    return out


def _run_timeframe(data_dir: Path, symbols: list[str], tf: str, start_ts: int, fee: float, log) -> dict:
    books: dict[str, list[dict]] = {sid: [] for sid in all_ids()}
    used = []
    t1 = start_ts
    notes = []
    bar_seconds = TF_SECONDS[tf]
    for symbol in symbols:
        bars = _load_bars(data_dir, symbol, tf, start_ts - 3 * 86400)
        if bars.empty or len(bars) < 500:
            log(f"  {symbol} {tf}: no bars")
            notes.append(f"{symbol}: no {tf} bars")
            continue
        hourly = read_kline(data_dir, symbol, "1h")
        h4 = read_kline(data_dir, symbol, "4h")
        log(f"  prepare {symbol} {tf} rows {len(bars)}")
        prep = prepare_frame(bars, hourly, h4, tf, symbol)
        del bars, hourly, h4
        if prep.empty:
            continue
        t1 = max(t1, int(prep["ts"].max()))
        used.append(symbol)
        sigs = signal_table(prep, bar_seconds)
        for sid, (side, stop, target) in sigs.items():
            book = simulate_levels(prep, side, stop, target, fee=fee)
            for row in book:
                row["setup_id"] = sid
                row["decision_tf"] = tf
            books[sid].extend(book)
            n_sig = int(np.count_nonzero(side))
            log(f"    {sid}: signals {n_sig} trades {len(book)}")
        del prep, sigs
    t0 = start_ts
    holdout = t0 + int(0.8 * (t1 - t0)) if t1 > t0 else t0
    rank_start = t0 + BURN_SECONDS
    rows = []
    for sid in all_ids():
        book = books[sid]
        ranking = [row for row in book if rank_start <= int(row["ts"]) < holdout]
        held = [row for row in book if int(row["ts"]) >= holdout]
        base = sid.split("_")[0]
        rows.append(
            {
                "setup_id": sid,
                "base": base,
                "filter": sid[len(base) + 1 :] if sid != base else "base",
                "name_ru": NAMES_RU[base],
                "formula": FORMULAS[base],
                "decision_tf": tf,
                "ranking": _metrics(ranking, rank_start, holdout),
                "holdout": _metrics(held, holdout, t1 + 1),
                "blocks": _blocks(ranking, rank_start, holdout),
            }
        )
    _attach_bh(rows)
    leader = _leader(rows)
    selected_r = _r_values([row for row in books.get(leader["setup_id"], []) if rank_start <= int(row["ts"]) < holdout])
    dsr = deflated_sharpe(
        selected_r,
        np.asarray([row["ranking"].get("sharpe") for row in rows], dtype=float),
        n_trials=len(rows),
    )
    passed = _passes(leader)
    return {
        "decision_tf": tf,
        "symbols": used,
        "start": iso_utc(t0),
        "end": iso_utc(t1),
        "holdout_cut": iso_utc(holdout),
        "rank_start": iso_utc(rank_start),
        "path": tf,
        "slippage": "max(2 bp of price, 0.10 * decision-bar ATR) per fill, entry and exit. Not 10% of the hourly ATR.",
        "n_trials": len(rows),
        "leader": leader["setup_id"],
        "passes": passed,
        "deflated_sharpe_ranking": {k: _jsonable(v) for k, v in dsr.items()},
        "notes": notes,
        "setups": rows,
    }


def _combine(frames: list[dict], fee: float) -> dict:
    setups = []
    for frame in frames:
        setups.extend(frame.get("setups") or [])
    # Arming uses one Benjamini–Hochberg pass over every situation × filter × timeframe in this run.
    _attach_bh(setups, key="bh_reject_family")
    by_tf = {}
    for frame in frames:
        tf = frame["decision_tf"]
        if len(frames) == 1:
            armed = [row["setup_id"] for row in frame["setups"] if _passes(row)]
            reason = _reason(frame, armed, family=False)
        else:
            armed = []
            for row in frame["setups"]:
                if row.get("bh_reject_family") and _positive_holdout(row) and _positive_rank(row):
                    armed.append(row["setup_id"])
            reason = _reason(frame, armed, family=True)
        # A pass also has to be the BH winner's holdout, not a later row shopped on the holdout.
        # When several reject, keep those whose own holdout is positive. That is confirmation,
        # not a new search: the holdout is not used to choose which ranking loser to keep.
        by_tf[tf] = {"armed_ids": armed, "leader": frame.get("leader"), "reason_ru": reason, "passes_leader": frame.get("passes")}
    any_pass = any(slot["armed_ids"] for slot in by_tf.values())
    if any_pass:
        headline = "Проходят только ситуации из списка ниже. Остальные к живой торговле не допускаются."
    else:
        headline = "Ни одна ситуация не прошла строгую проверку. Живой скор не включает ни одну из них."
    return {
        "kind": "situations",
        "fee_per_side": fee,
        "timeframes": frames,
        "family_n_trials": len(setups),
        "armed": {tf: slot["armed_ids"] for tf, slot in by_tf.items()},
        "by_timeframe": by_tf,
        "headline_ru": headline,
        "liquidation_note": (
            "Публичные ликвидации HTX — это короткий недавний буфер, не история с 2024 года. "
            "S5 поэтому смотрит на всплеск объёма и перерастяжение больше 2 ATR, а не на ленту ликвидаций."
        ),
    }


def _write_state(result: dict) -> None:
    payload = {
        "armed": result.get("armed") or {},
        "by_timeframe": result.get("by_timeframe") or {},
        "headline_ru": result.get("headline_ru"),
        "reason_ru": result.get("headline_ru"),
    }
    STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_bars(data_dir: Path, symbol: str, tf: str, warmup_ts: int) -> pd.DataFrame:
    if tf == "5m":
        minute = read_kline(data_dir, symbol, "1m")
        if minute.empty:
            return minute
        minute = minute.loc[minute["open_time"] >= warmup_ts - 86400]
        return resample_ohlc(minute, 300)
    bars = read_kline(data_dir, symbol, tf)
    if bars.empty:
        return bars
    return bars.loc[bars["open_time"] >= warmup_ts].reset_index(drop=True)


def _attach_higher(df: pd.DataFrame, hourly: pd.DataFrame | None, h4: pd.DataFrame | None) -> None:
    n = len(df)
    df["atr_1h"] = np.nan
    df["atr_q20"] = np.nan
    df["atr_q66"] = np.nan
    df["ema20_1h"] = np.nan
    df["vwap_1h"] = np.nan
    df["trend_up"] = False
    df["trend_down"] = False
    df["is_range"] = False
    df["high_vol"] = False
    if hourly is not None and not hourly.empty:
        ind = add_indicators(hourly, vwap_bars=24, swing_bars=24, vol_z_bars=24 * 20, atr_n=14)
        ind = _with_close_ts(ind, 3600)
        right = ind[["ts", "atr_14", "atr_q20", "atr_q66", "ema20", "vwap"]].rename(
            columns={"atr_14": "atr_1h", "ema20": "ema20_1h", "vwap": "vwap_1h"}
        )
        merged = pd.merge_asof(df[["ts"]], right.sort_values("ts"), on="ts", direction="backward")
        for name in ("atr_1h", "atr_q20", "atr_q66", "ema20_1h", "vwap_1h"):
            df[name] = merged[name].to_numpy(dtype=float)
        atr = df["atr_1h"].to_numpy(dtype=float)
        q66 = df["atr_q66"].to_numpy(dtype=float)
        df["high_vol"] = np.isfinite(atr) & np.isfinite(q66) & (atr >= q66)
    if h4 is not None and not h4.empty:
        ind = add_indicators(h4, vwap_bars=6, swing_bars=6, vol_z_bars=42, atr_n=14)
        ind = _with_close_ts(ind, 14400)
        ind["adx_14"] = _adx(ind["high"], ind["low"], ind["close"], 14)
        keep = ind[["ts", "ema20", "ema50", "ema20_slope_atr", "atr_14", "close", "adx_14"]].copy()
        atr = keep["atr_14"].to_numpy(dtype=float)
        gap = np.abs(keep["ema20"].to_numpy(dtype=float) - keep["ema50"].to_numpy(dtype=float))
        slope = keep["ema20_slope_atr"].to_numpy(dtype=float)
        adx = keep["adx_14"].to_numpy(dtype=float)
        close = keep["close"].to_numpy(dtype=float)
        ema20 = keep["ema20"].to_numpy(dtype=float)
        ema50 = keep["ema50"].to_numpy(dtype=float)
        flat = np.isfinite(atr) & (atr > 0) & (gap < SITUATION_FLAT_ATR * atr) & np.isfinite(slope) & (np.abs(slope) < SITUATION_FLAT_SLOPE)
        keep["trend_up"] = (ema20 > ema50) & (slope > 0) & (close > ema50)
        keep["trend_down"] = (ema20 < ema50) & (slope < 0) & (close < ema50)
        keep["is_range"] = (np.isfinite(adx) & (adx < SITUATION_ADX_RANGE)) | flat
        merged = pd.merge_asof(
            df[["ts"]],
            keep[["ts", "trend_up", "trend_down", "is_range"]].sort_values("ts"),
            on="ts",
            direction="backward",
        )
        df["trend_up"] = merged["trend_up"].fillna(False).to_numpy(dtype=bool)
        df["trend_down"] = merged["trend_down"].fillna(False).to_numpy(dtype=bool)
        df["is_range"] = merged["is_range"].fillna(False).to_numpy(dtype=bool)
    _ = n


def _with_close_ts(frame: pd.DataFrame, bar_seconds: int) -> pd.DataFrame:
    out = frame.sort_values("open_time").reset_index(drop=True)
    if "close_time" in out.columns and out["close_time"].notna().any():
        out["ts"] = out["close_time"].astype(np.int64)
    else:
        out["ts"] = out["open_time"].astype(np.int64) + bar_seconds
    return out


def _adx(high, low, close, n: int = 14) -> np.ndarray:
    h = pd.Series(np.asarray(high, dtype=float))
    low_s = pd.Series(np.asarray(low, dtype=float))
    c = pd.Series(np.asarray(close, dtype=float))
    up = h.diff()
    dn = -low_s.diff()
    plus_dm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), dtype=float)
    minus_dm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), dtype=float)
    prev = c.shift(1)
    tr = pd.concat([(h - low_s), (h - prev).abs(), (low_s - prev).abs()], axis=1).max(axis=1)
    alpha = 1.0 / n
    atr = tr.ewm(alpha=alpha, adjust=False, min_periods=n).mean()
    pdi = 100.0 * plus_dm.ewm(alpha=alpha, adjust=False, min_periods=n).mean() / atr
    mdi = 100.0 * minus_dm.ewm(alpha=alpha, adjust=False, min_periods=n).mean() / atr
    denom = pdi + mdi
    dx = 100.0 * (pdi - mdi).abs() / denom.replace(0, np.nan)
    return dx.ewm(alpha=alpha, adjust=False, min_periods=n).mean().to_numpy(dtype=float)


def _fractal_events(high: np.ndarray, low: np.ndarray, wing: int) -> tuple[pd.Series, pd.Series]:
    h = pd.Series(np.asarray(high, dtype=float))
    low_s = pd.Series(np.asarray(low, dtype=float))
    center_h = h.shift(wing)
    left_h = h.shift(wing + 1).rolling(wing, min_periods=wing).max()
    right_h = h.rolling(wing, min_periods=wing).max()
    event_h = center_h.where((center_h > left_h) & (center_h > right_h))
    center_l = low_s.shift(wing)
    left_l = low_s.shift(wing + 1).rolling(wing, min_periods=wing).min()
    right_l = low_s.rolling(wing, min_periods=wing).min()
    event_l = center_l.where((center_l < left_l) & (center_l < right_l))
    return event_h, event_l


def _equal_level(event: pd.Series, atr: np.ndarray, *, higher: bool) -> pd.Series:
    last = event.ffill()
    prev = last.shift(1).where(event.notna()).ffill()
    last_v = last.to_numpy(dtype=float)
    prev_v = prev.to_numpy(dtype=float)
    band = SITUATION_EQUAL_ATR * atr
    equal = np.isfinite(last_v) & np.isfinite(prev_v) & np.isfinite(band) & (np.abs(last_v - prev_v) <= band)
    if higher:
        chosen = np.where(equal, np.maximum(last_v, prev_v), last_v)
    else:
        chosen = np.where(equal, np.minimum(last_v, prev_v), last_v)
    return pd.Series(chosen, index=event.index)


def _known_swing(event: pd.Series) -> pd.Series:
    return event.ffill().shift(1)


def _reclaim(extreme: np.ndarray, close: np.ndarray, level: np.ndarray, *, above: bool) -> tuple[np.ndarray, np.ndarray]:
    """Return (reclaim mask, sweep extreme over the sweep-to-reclaim window)."""
    n = len(close)
    reclaim = np.zeros(n, dtype=bool)
    ext = np.full(n, np.nan)
    level_s = pd.Series(level)
    close_s = pd.Series(close)
    ext_s = pd.Series(extreme)
    for k in (1, 2, 3):
        lvl = level_s.shift(k).to_numpy(dtype=float)
        swept = ext_s.shift(k).to_numpy(dtype=float)
        closed = close_s.shift(k).to_numpy(dtype=float)
        if above:
            took = np.isfinite(lvl) & np.isfinite(swept) & (swept > lvl)
            held = np.isfinite(closed) & (closed >= lvl)
            back = np.isfinite(close) & (close < lvl)
        else:
            took = np.isfinite(lvl) & np.isfinite(swept) & (swept < lvl)
            held = np.isfinite(closed) & (closed <= lvl)
            back = np.isfinite(close) & (close > lvl)
        for j in range(1, k):
            mid = close_s.shift(j).to_numpy(dtype=float)
            if above:
                held = held & np.isfinite(mid) & (mid >= lvl)
            else:
                held = held & np.isfinite(mid) & (mid <= lvl)
        fire = took & held & back & ~reclaim
        reclaim |= fire
        window = ext_s.copy()
        for j in range(1, k + 1):
            other = ext_s.shift(j)
            window = np.maximum(window, other) if above else np.minimum(window, other)
        ext = np.where(fire, window, ext)
    return reclaim, ext


def _nearest_above(price: np.ndarray, atr: np.ndarray, *levels: np.ndarray) -> np.ndarray:
    out = np.full(len(price), np.inf)
    floor = price + SITUATION_POOL_ATR * atr
    for level in levels:
        lv = np.asarray(level, dtype=float)
        ok = np.isfinite(lv) & np.isfinite(floor) & (lv > floor)
        out = np.where(ok, np.minimum(out, lv), out)
    out[~np.isfinite(out)] = np.nan
    return out


def _nearest_below(price: np.ndarray, atr: np.ndarray, *levels: np.ndarray) -> np.ndarray:
    out = np.full(len(price), -np.inf)
    cap = price - SITUATION_POOL_ATR * atr
    for level in levels:
        lv = np.asarray(level, dtype=float)
        ok = np.isfinite(lv) & np.isfinite(cap) & (lv < cap)
        out = np.where(ok, np.maximum(out, lv), out)
    out[out == -np.inf] = np.nan
    return out


def _exclusive(long_mask: np.ndarray, short_mask: np.ndarray) -> np.ndarray:
    both = long_mask & short_mask
    side = np.zeros(len(long_mask), dtype=np.int8)
    side[long_mask & ~both] = 1
    side[short_mask & ~both] = -1
    return side


def _pack_side(long_mask, short_mask, stop_long, stop_short, tgt_long, tgt_short):
    side = _exclusive(np.asarray(long_mask, dtype=bool), np.asarray(short_mask, dtype=bool))
    stop = np.where(side > 0, stop_long, np.where(side < 0, stop_short, np.nan))
    target = np.where(side > 0, tgt_long, np.where(side < 0, tgt_short, np.nan))
    return side.astype(np.int8), np.asarray(stop, dtype=float), np.asarray(target, dtype=float)


def _apply_regime(side, kind, trend_up, trend_down, is_range, high_vol) -> np.ndarray:
    out = np.array(side, dtype=np.int8, copy=True)
    if kind == "trend":
        out[(out > 0) & ~trend_up] = 0
        out[(out < 0) & ~trend_down] = 0
    elif kind == "range":
        out[~is_range] = 0
    elif kind == "highvol":
        out[~high_vol] = 0
    return out


def _bool(frame: pd.DataFrame, name: str) -> np.ndarray:
    if name not in frame.columns:
        return np.zeros(len(frame), dtype=bool)
    return np.asarray(frame[name].fillna(False).to_numpy(dtype=bool))


def _bar_seconds(frame: pd.DataFrame) -> int:
    if len(frame) < 2 or "ts" not in frame.columns:
        return 900
    ts = frame["ts"].to_numpy(dtype=np.int64)
    step = int(np.median(np.diff(ts[: min(len(ts), 50)])))
    return step if step > 0 else 900


def _clock_flags(ts: np.ndarray) -> np.ndarray:
    minute_of_day = (ts // 60) % 1440
    weekday = ((ts // 86400) + 3) % 7
    us = (minute_of_day >= 13 * 60 + 30) & (minute_of_day < 15 * 60 + 30)
    data = (weekday < 5) & (minute_of_day >= 12 * 60 + 25) & (minute_of_day < 13 * 60 + 5)
    dates = pd.to_datetime(ts, unit="s", utc=True).strftime("%Y-%m-%d")
    fomc_day = np.asarray(pd.Index(dates).isin(FOMC_DATES))
    fomc = fomc_day & (minute_of_day >= 18 * 60) & (minute_of_day < 18 * 60 + 30)
    return us | data | fomc


def _attach_bh(rows: list[dict], key: str = "bh_reject_0.05") -> None:
    pvals = [np.nan if row["ranking"]["p_value"] is None else row["ranking"]["p_value"] for row in rows]
    rejected, qvals = benjamini_hochberg(pvals, 0.05)
    for row, reject, q in zip(rows, rejected, qvals):
        row[key] = bool(reject) and _positive_rank(row)
        row["q_value" if key == "bh_reject_0.05" else "q_value_family"] = None if not np.isfinite(q) else float(q)
        if key == "bh_reject_0.05":
            row["q_value"] = None if not np.isfinite(q) else float(q)


def _positive_rank(row: dict) -> bool:
    mean = row["ranking"]["expectancy_r"]
    return bool(row["ranking"]["n"] >= 30 and mean is not None and np.isfinite(mean) and mean > 0)


def _positive_holdout(row: dict) -> bool:
    hold = row["holdout"]
    mean = hold["expectancy_r"]
    p = hold["p_value"]
    return bool(hold["n"] >= 30 and mean is not None and np.isfinite(mean) and mean > 0 and p is not None and np.isfinite(p) and p < 0.05)


def _passes(row: dict) -> bool:
    return bool(row.get("bh_reject_0.05") and _positive_holdout(row))


def _leader(rows: list[dict]) -> dict:
    winners = [row for row in rows if row.get("bh_reject_0.05") and _positive_rank(row)]
    eligible = [row for row in rows if _finite(row["ranking"]["expectancy_r"]) and row["ranking"]["n"] >= 30]
    pool = winners or eligible or rows
    return sorted(pool, key=lambda row: row["ranking"]["expectancy_r"] if _finite(row["ranking"]["expectancy_r"]) else -1e9, reverse=True)[0]


def _reason(frame: dict, armed: list[str], *, family: bool) -> str:
    if armed:
        names = ", ".join(armed)
        scope = "по всей семье таймфреймов" if family else "на этом таймфрейме"
        return f"Проходит {scope}: {names}."
    leader = frame.get("leader")
    return (
        f"Лучшая строка на отборе — {leader}. Это не отобранный победитель: "
        "после поправки на число проверок и на нетронутом хвосте ни одна ситуация не подтвердилась. "
        "В скор ничего не включено."
    )


def verdict_ru(row: dict, *, family: bool = False) -> str:
    n = row["ranking"]["n"]
    if n < 30:
        return "мало сделок"
    mean = row["ranking"]["expectancy_r"]
    bh = row.get("bh_reject_family") if family and "bh_reject_family" in row else row.get("bh_reject_0.05")
    if _positive_holdout(row) and bh and mean is not None and mean > 0:
        return "проходит"
    if mean is not None and mean > 0 and bh:
        return "плюс на учебе, хвост не подтвердил"
    if mean is not None and mean > 0:
        return "плюс есть, но после поправки не проходит"
    return "не работает"


def _metrics(book: list[dict], start: int, end: int) -> dict:
    days = max((end - start) / 86400.0, 1e-9)
    empty = {
        "n": 0,
        "hit_rate": None,
        "expectancy_r": None,
        "p_value": None,
        "t": None,
        "sharpe": None,
        "trades_per_day": 0.0,
        "max_drawdown_r": None,
    }
    if not book:
        return empty
    ordered = sorted(book, key=lambda row: (int(row["ts"]), str(row.get("symbol") or "")))
    r = np.asarray([row["r_achieved"] for row in ordered], dtype=float)
    test = mean_r_test(r)
    sharpe = sharpe_ratio(r)
    hits = np.isfinite(r) & (r > 0)
    return {
        "n": int(test["n"]),
        "hit_rate": None if test["n"] == 0 else float(np.mean(hits)),
        "expectancy_r": None if not np.isfinite(test["mean"]) else float(test["mean"]),
        "p_value": None if not np.isfinite(test["p_value"]) else float(test["p_value"]),
        "t": None if not np.isfinite(test["t"]) else float(test["t"]),
        "sharpe": None if not np.isfinite(sharpe) else float(sharpe),
        "trades_per_day": float(len(ordered) / days),
        "max_drawdown_r": None if not np.isfinite(max_drawdown(r)) else float(max_drawdown(r)),
    }


def _blocks(book: list[dict], start: int, end: int, n_blocks: int = 4) -> list[dict]:
    if end <= start:
        return []
    width = (end - start) / n_blocks
    rows = []
    for i in range(n_blocks):
        a = int(start + i * width)
        b = int(start + (i + 1) * width) if i < n_blocks - 1 else end
        chunk = [row for row in book if a <= int(row["ts"]) < b]
        rows.append({"start": iso_utc(a), "end": iso_utc(b), **_metrics(chunk, a, b)})
    return rows


def _r_values(book: list[dict]) -> np.ndarray:
    if not book:
        return np.asarray([], dtype=float)
    ordered = sorted(book, key=lambda row: int(row["ts"]))
    return np.asarray([row["r_achieved"] for row in ordered], dtype=float)


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and np.isfinite(value)


def _plain(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(number):
        return None
    return number


def _jsonable(value):
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value
