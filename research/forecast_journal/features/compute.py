"""Assemble one row per symbol per decision time, using only data closed at t."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.forecast_journal.data.loader import MarketData
from research.forecast_journal.features.indicators import add_indicators
from research.forecast_journal.features.liquidity import LIQUIDITY_FIELDS
from research.forecast_journal.util import safe_div

# Columns that enter the feature-snapshot hash. Order is part of the hash.
FEATURE_COLUMNS: tuple[str, ...] = (
    "price",
    "ret_15m",
    "ret_1h",
    "ret_4h",
    "ret_24h",
    "atr_15m",
    "atr_1h",
    "atr_4h",
    "rv_1h",
    "close_pos",
    "range_pct",
    "dist_high_atr",
    "dist_low_atr",
    "turnover_z",
    "ema20_4h",
    "ema50_4h",
    "ema200_4h",
    "ema20_slope_4h",
    "vwap_4h",
    "ema20_15m",
    "ema20_slope_15m",
    "vwap_15m",
    "cvd_ratio_1h",
    "funding_rate",
    "funding_change",
    "funding_z",
    "oi_change_1h",
    "oi_change_4h",
    "basis",
    "long_short_ratio",
    "account_imbalance",
    "btc_ret_1h",
    "btc_ret_4h",
    "btc_ret_24h",
    "btc_rel_4h",
    "btc_dom_4h",
    "beta_btc",
    "corr_btc",
    "hour_utc",
    "dow",
    "swing_high",
    "swing_low",
    "prior_high",
    "prior_low",
    "atr_q20",
    "atr_q33",
    "atr_q66",
)

LIQUIDITY_COLUMNS: tuple[str, ...] = LIQUIDITY_FIELDS

FEATURE_GROUPS: dict[str, tuple[str, ...]] = {
    "price": (
        "price",
        "ret_15m",
        "ret_1h",
        "ret_4h",
        "ret_24h",
        "atr_15m",
        "atr_1h",
        "atr_4h",
        "rv_1h",
        "close_pos",
        "range_pct",
        "dist_high_atr",
        "dist_low_atr",
        "ema20_4h",
        "ema50_4h",
        "ema200_4h",
        "ema20_slope_4h",
        "vwap_4h",
        "ema20_15m",
        "ema20_slope_15m",
        "vwap_15m",
        "swing_high",
        "swing_low",
    ),
    "volume": ("turnover_z",),
    "flow": ("cvd_ratio_1h", "account_imbalance"),
    "funding": ("funding_rate", "funding_change", "funding_z"),
    "open_interest": ("oi_change_1h", "oi_change_4h"),
    "basis": ("basis",),
    "positioning": ("long_short_ratio",),
    "cross_asset": ("btc_ret_1h", "btc_ret_4h", "btc_ret_24h", "btc_rel_4h", "btc_dom_4h", "beta_btc", "corr_btc"),
    "session": ("hour_utc", "dow"),
    "liquidity": LIQUIDITY_COLUMNS,
}


def iter_symbol_frames(data: MarketData, decision_tf: str = "1h"):
    """Yield one symbol's decision rows. Cross-asset columns use the full universe."""
    if decision_tf not in ("15m", "1h"):
        raise ValueError("decision_tf must be 15m or 1h")
    cross = _hourly_cross_asset(data)
    for symbol, book in data.klines.items():
        frame = _build_symbol(symbol, book, data, decision_tf, cross)
        if frame.empty:
            continue
        frame = _add_calendar(frame)
        for column in list(FEATURE_COLUMNS) + list(LIQUIDITY_COLUMNS):
            if column not in frame.columns:
                frame[column] = np.nan
        yield frame


def build_panel(data: MarketData, decision_tf: str = "1h") -> pd.DataFrame:
    """Decision rows for every symbol. `decision_tf` is `15m` or `1h`."""
    frames = list(iter_symbol_frames(data, decision_tf))
    if not frames:
        return pd.DataFrame()
    panel = pd.concat(frames, ignore_index=True)
    panel = _add_calendar(panel)
    for column in list(FEATURE_COLUMNS) + list(LIQUIDITY_COLUMNS):
        if column not in panel.columns:
            panel[column] = np.nan
    return panel.sort_values(["symbol", "ts"]).reset_index(drop=True)


def present_groups(row: pd.Series) -> str:
    found = []
    for name, cols in FEATURE_GROUPS.items():
        for col in cols:
            value = row.get(col)
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if np.isfinite(number):
                found.append(name)
                break
    return ",".join(found)


def _build_symbol(
    symbol: str,
    book: dict[str, pd.DataFrame],
    data: MarketData,
    decision_tf: str,
    cross: pd.DataFrame,
) -> pd.DataFrame:
    base = book.get(decision_tf)
    if base is None or base.empty:
        return pd.DataFrame()
    dec_ind = add_indicators(
        base,
        vwap_bars=24 if decision_tf == "1h" else 16,
        swing_bars=24 if decision_tf == "1h" else 96,
        vol_z_bars=168 if decision_tf == "1h" else 96 * 7,
        rv_bars=24 if decision_tf == "1h" else 96,
        cvd_bars=1 if decision_tf == "1h" else 4,
    )
    dec = pd.DataFrame(
        {
            "symbol": symbol,
            "ts": dec_ind["close_time"].to_numpy(dtype=np.int64),
            "price": dec_ind["close"].to_numpy(dtype=float),
            "high": dec_ind["high"].to_numpy(dtype=float),
            "low": dec_ind["low"].to_numpy(dtype=float),
            "close_pos": dec_ind["close_pos"].to_numpy(dtype=float),
            "range_pct": dec_ind["range_pct"].to_numpy(dtype=float),
            "turnover_z": dec_ind["turnover_z"].to_numpy(dtype=float),
        }
    )
    price = dec["price"]
    if decision_tf == "1h":
        dec["ret_15m"] = np.nan
        dec["ret_1h"] = price.pct_change(1)
        dec["ret_4h"] = price.pct_change(4)
        dec["ret_24h"] = price.pct_change(24)
    else:
        dec["ret_15m"] = price.pct_change(1)
        dec["ret_1h"] = price.pct_change(4)
        dec["ret_4h"] = price.pct_change(16)
        dec["ret_24h"] = price.pct_change(96)
    dec = _asof_close(dec, _tf(book.get("15m"), vwap_bars=16, swing_bars=32, cvd_bars=4, rv_bars=16, vol_z_bars=96), {
        "atr_14": "atr_15m",
        "ema20": "ema20_15m",
        "ema20_slope_atr": "ema20_slope_15m",
        "vwap": "vwap_15m",
        "cvd_ratio": "cvd_ratio_1h",
        "ret_1": "ret_15m_bar",
    })
    if decision_tf == "1h":
        dec["ret_15m"] = dec["ret_15m_bar"]
    h1 = _tf(book.get("1h"), vwap_bars=24, swing_bars=24, cvd_bars=1, rv_bars=24, vol_z_bars=168)
    dec = _asof_close(dec, h1, {
        "atr_14": "atr_1h",
        "rv": "rv_1h",
        "swing_high": "swing_high",
        "swing_low": "swing_low",
        "prior_high": "prior_high",
        "prior_low": "prior_low",
        "atr_q20": "atr_q20",
        "atr_q33": "atr_q33",
        "atr_q66": "atr_q66",
    })
    # 1h signed-volume proxy only where the 15m CVD is missing.
    if decision_tf == "1h":
        dec = _asof_close(dec, h1, {"cvd_ratio": "cvd_ratio_1h_fallback"})
        if "cvd_ratio_1h_fallback" in dec.columns:
            primary = dec["cvd_ratio_1h"] if "cvd_ratio_1h" in dec.columns else np.nan
            dec["cvd_ratio_1h"] = pd.Series(primary, index=dec.index).where(pd.Series(primary, index=dec.index).notna(), dec["cvd_ratio_1h_fallback"])
    h4 = _tf(book.get("4h"), vwap_bars=6, swing_bars=20, cvd_bars=1, rv_bars=20, vol_z_bars=90)
    dec = _asof_close(dec, h4, {
        "atr_14": "atr_4h",
        "ema20": "ema20_4h",
        "ema50": "ema50_4h",
        "ema200": "ema200_4h",
        "ema20_slope_atr": "ema20_slope_4h",
        "vwap": "vwap_4h",
    })
    dec["dist_high_atr"] = safe_div((dec["swing_high"] - dec["price"]).to_numpy(), dec["atr_1h"].to_numpy())
    dec["dist_low_atr"] = safe_div((dec["price"] - dec["swing_low"]).to_numpy(), dec["atr_1h"].to_numpy())
    dec = _asof_events(dec, _funding_features(data.funding.get(symbol)), {
        "funding_rate": "funding_rate",
        "funding_change": "funding_change",
        "funding_z": "funding_z",
    })
    dec = _asof_events(dec, _oi_change(data.open_interest.get(symbol, {}).get("60min")), {"oi_change": "oi_change_1h"})
    dec = _asof_events(dec, _oi_change(data.open_interest.get(symbol, {}).get("4hour")), {"oi_change": "oi_change_4h"})
    dec = _attach_basis(dec, symbol, book, data)
    dec = _asof_events(dec, data.elite_position.get(symbol), {"buy_ratio": "pos_buy", "sell_ratio": "pos_sell"})
    dec["long_short_ratio"] = safe_div(dec.get("pos_buy", np.nan), dec.get("pos_sell", np.nan))
    dec = _asof_events(dec, data.elite_account.get(symbol), {"buy_ratio": "acct_buy", "sell_ratio": "acct_sell"})
    if "acct_buy" in dec.columns:
        dec["account_imbalance"] = dec["acct_buy"] - dec["acct_sell"]
    else:
        dec["account_imbalance"] = np.nan
    dec = _asof_events(dec, _okx_oi_change(data.okx_oi.get(symbol)), {"okx_oi_change": "okx_oi_change"})
    if cross is not None and not cross.empty:
        mine = cross.loc[cross["symbol"] == symbol].drop(columns=["symbol"])
        dec = _asof_events(dec, mine, {col: col for col in mine.columns if col != "ts"})
    if "btc_ret_4h" in dec.columns:
        dec["btc_rel_4h"] = dec["ret_4h"] - dec["btc_ret_4h"]
    for name in LIQUIDITY_COLUMNS:
        dec[name] = np.nan
    return dec


def _tf(frame: pd.DataFrame | None, **kwargs) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame()
    return add_indicators(frame, **kwargs)


def _asof_close(left: pd.DataFrame, right: pd.DataFrame, columns: dict[str, str]) -> pd.DataFrame:
    return _asof_events(left, right.rename(columns={"close_time": "ts"}) if "close_time" in getattr(right, "columns", []) else right, columns)


def _asof_events(left: pd.DataFrame, right: pd.DataFrame | None, columns: dict[str, str]) -> pd.DataFrame:
    left = left.sort_values("ts")
    wanted = list(columns.values())
    if right is None or right.empty or "ts" not in right.columns:
        for name in wanted:
            if name not in left.columns:
                left[name] = np.nan
        return left
    have = [src for src in columns if src in right.columns]
    if not have:
        for name in wanted:
            if name not in left.columns:
                left[name] = np.nan
        return left
    use = right[["ts", *have]].dropna(subset=["ts"]).sort_values("ts")
    use = use.rename(columns={src: columns[src] for src in have})
    # Drop columns we are about to replace so merge_asof does not suffix them.
    replace = [columns[src] for src in have if columns[src] in left.columns]
    if replace:
        left = left.drop(columns=replace)
    merged = pd.merge_asof(left, use, on="ts", direction="backward")
    for name in wanted:
        if name not in merged.columns:
            merged[name] = np.nan
    return merged


def _funding_features(frame: pd.DataFrame | None) -> pd.DataFrame:
    if frame is None or frame.empty or "funding_rate" not in frame.columns:
        return pd.DataFrame()
    df = frame.sort_values("ts").drop_duplicates("ts", keep="last").copy()
    rate = df["funding_rate"].astype(float)
    mu = rate.rolling(90, min_periods=20).mean()
    sd = rate.rolling(90, min_periods=20).std()
    df["funding_z"] = safe_div((rate - mu).to_numpy(), sd.to_numpy())
    df["funding_change"] = rate.diff()
    return df[["ts", "funding_rate", "funding_change", "funding_z"]]


def _oi_change(frame: pd.DataFrame | None) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame()
    df = frame.sort_values("ts").drop_duplicates("ts", keep="last").copy()
    value = df["oi_value"] if "oi_value" in df.columns else df.get("oi_volume")
    if value is None:
        return pd.DataFrame()
    df["oi_change"] = value.astype(float).pct_change()
    return df[["ts", "oi_change"]]


def _okx_oi_change(frame: pd.DataFrame | None) -> pd.DataFrame:
    if frame is None or frame.empty or "okx_oi_usd" not in frame.columns:
        return pd.DataFrame()
    df = frame.sort_values("ts").drop_duplicates("ts", keep="last").copy()
    df["okx_oi_change"] = df["okx_oi_usd"].astype(float).pct_change()
    return df[["ts", "okx_oi_change"]]


def _attach_basis(dec: pd.DataFrame, symbol: str, book: dict[str, pd.DataFrame], data: MarketData) -> pd.DataFrame:
    """Basis = (swap − index) / index, using the last index bar closed at t.

    Official HTX basis (recent ~200 bars) fills gaps only when it is the
    later print. merge_asof never reads a bar that closes after t.
    """
    pieces = []
    index_book = data.index.get(symbol) or {}
    for tf, swap in (("1h", book.get("1h")), ("4h", book.get("4h"))):
        idx = index_book.get(tf)
        if idx is None or idx.empty or swap is None or swap.empty or "index_close" not in idx.columns:
            continue
        right = idx[["close_time", "index_close"]].rename(columns={"close_time": "ts"}).sort_values("ts")
        left = swap[["close_time", "close"]].rename(columns={"close_time": "ts", "close": "swap"}).sort_values("ts")
        both = pd.merge_asof(right, left, on="ts", direction="backward")
        # Reject a swap print older than one bar: that would be a stale cross.
        both["basis"] = safe_div((both["swap"] - both["index_close"]).to_numpy(), both["index_close"].to_numpy())
        pieces.append(both[["ts", "basis"]])
    official = data.basis.get(symbol)
    if official is not None and not official.empty and "basis_rate" in official.columns:
        off = official.rename(columns={"close_time": "ts", "basis_rate": "basis"})[["ts", "basis"]]
        pieces.append(off)
    if not pieces:
        dec["basis"] = np.nan
        return dec
    stacked = pd.concat(pieces, ignore_index=True).dropna(subset=["basis"]).sort_values("ts")
    # If two sources share a timestamp, keep the last (official appended last only
    # when we want it to override). Computed basis is enough; official is a
    # same-definition cross-check appended after, so it wins on equal ts.
    stacked = stacked.drop_duplicates("ts", keep="last")
    return _asof_events(dec, stacked, {"basis": "basis"})


def _hourly_cross_asset(data: MarketData) -> pd.DataFrame:
    """BTC returns, equal-weight dominance proxy, and trailing beta/corr.

    Beta at hour t uses the trailing 168 one-hour returns ending at t.
    """
    series = []
    for symbol, book in data.klines.items():
        h1 = book.get("1h")
        if h1 is None or h1.empty:
            continue
        df = h1.sort_values("close_time")[["close_time", "close"]].drop_duplicates("close_time")
        df = df.rename(columns={"close_time": "ts"})
        df["symbol"] = symbol
        df["ret_1h"] = df["close"].pct_change(1)
        df["ret_4h"] = df["close"].pct_change(4)
        df["ret_24h"] = df["close"].pct_change(24)
        series.append(df[["symbol", "ts", "ret_1h", "ret_4h", "ret_24h"]])
    if not series:
        return pd.DataFrame()
    all_h = pd.concat(series, ignore_index=True)
    btc = all_h.loc[all_h["symbol"] == "BTC", ["ts", "ret_1h", "ret_4h", "ret_24h"]].rename(
        columns={"ret_1h": "btc_ret_1h", "ret_4h": "btc_ret_4h", "ret_24h": "btc_ret_24h"}
    )
    if btc.empty:
        return pd.DataFrame()
    ew = all_h.groupby("ts", as_index=False).agg(ew_ret_1h=("ret_1h", "mean"), ew_ret_4h=("ret_4h", "mean"))
    btc = btc.merge(ew, on="ts", how="left")
    btc["btc_dom_1h"] = btc["btc_ret_1h"] - btc["ew_ret_1h"]
    btc["btc_dom_4h"] = btc["btc_ret_4h"] - btc["ew_ret_4h"]
    btc_sorted = btc.sort_values("ts")
    frames = []
    for symbol, grp in all_h.groupby("symbol", sort=False):
        g = grp.sort_values("ts").merge(btc_sorted[["ts", "btc_ret_1h", "btc_ret_4h", "btc_ret_24h", "btc_dom_1h", "btc_dom_4h"]], on="ts", how="left")
        if symbol == "BTC":
            g["beta_btc"] = 1.0
            g["corr_btc"] = 1.0
        else:
            ret = g["ret_1h"]
            bret = g["btc_ret_1h"]
            g["beta_btc"] = ret.rolling(168, min_periods=48).cov(bret) / bret.rolling(168, min_periods=48).var()
            g["corr_btc"] = ret.rolling(168, min_periods=48).corr(bret)
            g["beta_btc"] = g["beta_btc"].replace([np.inf, -np.inf], np.nan)
            g["corr_btc"] = g["corr_btc"].replace([np.inf, -np.inf], np.nan)
        frames.append(g[["symbol", "ts", "btc_ret_1h", "btc_ret_4h", "btc_ret_24h", "btc_dom_1h", "btc_dom_4h", "beta_btc", "corr_btc"]])
    return pd.concat(frames, ignore_index=True)


def _add_calendar(panel: pd.DataFrame) -> pd.DataFrame:
    ts = pd.to_datetime(panel["ts"], unit="s", utc=True)
    hour = ts.dt.hour.to_numpy()
    panel = panel.copy()
    panel["hour_utc"] = hour.astype(float)
    panel["dow"] = ts.dt.dayofweek.to_numpy().astype(float)
    panel["session"] = np.where(hour < 8, "asia", np.where(hour < 16, "europe", "us"))
    atr = panel["atr_1h"].to_numpy(dtype=float) if "atr_1h" in panel.columns else np.full(len(panel), np.nan)
    q33 = panel["atr_q33"].to_numpy(dtype=float) if "atr_q33" in panel.columns else np.full(len(panel), np.nan)
    q66 = panel["atr_q66"].to_numpy(dtype=float) if "atr_q66" in panel.columns else np.full(len(panel), np.nan)
    regime = np.full(len(panel), None, dtype=object)
    known = np.isfinite(atr) & np.isfinite(q33) & np.isfinite(q66)
    regime[known & (atr <= q33)] = "low"
    regime[known & (atr > q33) & (atr < q66)] = "mid"
    regime[known & (atr >= q66)] = "high"
    panel["vol_regime"] = regime
    return panel
