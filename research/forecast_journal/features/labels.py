"""Forward labels. These look ahead on purpose and must never be used as features."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.forecast_journal.config import HORIZONS, TIMEFRAMES


def future_excursions(path: pd.DataFrame, horizon_s: int) -> pd.DataFrame:
    """For each bar close, the return and high/low excursion over the next `horizon_s`.

    The window is the next bars whose close is strictly after this close and at
    or before this close + horizon. The current bar is not part of the path.
    Rows whose clock-time gap does not match the horizon are NaN (gaps).
    """
    if path is None or path.empty:
        return pd.DataFrame(columns=["ts", "fwd_ret", "up_exc", "dn_exc"])
    df = path.sort_values("close_time").drop_duplicates("close_time", keep="last")
    close_time = df["close_time"].to_numpy(dtype=np.int64)
    close = df["close"].to_numpy(dtype=float)
    high = df["high"].to_numpy(dtype=float)
    low = df["low"].to_numpy(dtype=float)
    n = len(df)
    period = int(np.median(np.diff(close_time))) if n > 2 else horizon_s
    bars = int(round(horizon_s / period)) if period > 0 else 0
    fwd = np.full(n, np.nan)
    up = np.full(n, np.nan)
    dn = np.full(n, np.nan)
    if bars < 1 or n <= bars:
        return pd.DataFrame({"ts": close_time, "fwd_ret": fwd, "up_exc": up, "dn_exc": dn})
    delta = close_time[bars:] - close_time[:-bars]
    aligned = np.abs(delta - horizon_s) <= max(period, int(horizon_s * 0.05))
    # max/min of highs[i+1 : i+bars+1]
    high_s = pd.Series(high)
    low_s = pd.Series(low)
    future_max = high_s.iloc[::-1].rolling(bars, min_periods=bars).max().iloc[::-1].shift(-1).to_numpy()
    future_min = low_s.iloc[::-1].rolling(bars, min_periods=bars).min().iloc[::-1].shift(-1).to_numpy()
    valid = np.zeros(n, dtype=bool)
    valid[:-bars] = aligned
    price = close
    with np.errstate(divide="ignore", invalid="ignore"):
        fwd_full = np.full(n, np.nan)
        fwd_full[:-bars] = close[bars:] / close[:-bars] - 1.0
        up_full = future_max / price - 1.0
        dn_full = future_min / price - 1.0
    fwd[valid] = fwd_full[valid]
    up[valid] = up_full[valid]
    dn[valid] = dn_full[valid]
    return pd.DataFrame({"ts": close_time, "fwd_ret": fwd, "up_exc": up, "dn_exc": dn})


def attach_labels(panel: pd.DataFrame, klines: dict[str, dict[str, pd.DataFrame]], horizons: tuple[str, ...] = ("1h", "4h", "24h")) -> pd.DataFrame:
    """Attach fwd_ret/up_exc/dn_exc per horizon. Finest available path wins."""
    if panel.empty:
        return panel
    out = panel.copy()
    for horizon in horizons:
        horizon_s = HORIZONS[horizon]
        pieces = []
        for symbol, grp in out.groupby("symbol", sort=False):
            chosen = pd.DataFrame({"ts": grp["ts"].to_numpy()})
            chosen["fwd_ret"] = np.nan
            chosen["up_exc"] = np.nan
            chosen["dn_exc"] = np.nan
            symbol_klines = klines.get(symbol) or {}
            for tf in ("1h", "15m", "1m"):
                path = symbol_klines.get(tf)
                if path is None or path.empty or len(path) < 3:
                    continue
                if TIMEFRAMES[tf] > horizon_s:
                    continue
                table = future_excursions(path, horizon_s)
                filled = chosen[["ts"]].merge(table, on="ts", how="left")
                for col in ("fwd_ret", "up_exc", "dn_exc"):
                    incoming = filled[col].to_numpy(dtype=float, copy=False)
                    current = np.array(chosen[col].to_numpy(dtype=float, copy=True), copy=True)
                    take = np.isfinite(incoming)
                    current[take] = incoming[take]
                    chosen[col] = current
            chosen["symbol"] = symbol
            pieces.append(chosen)
        labels = pd.concat(pieces, ignore_index=True)
        out = out.merge(
            labels.rename(
                columns={
                    "fwd_ret": f"fwd_ret_{horizon}",
                    "up_exc": f"up_exc_{horizon}",
                    "dn_exc": f"dn_exc_{horizon}",
                }
            ),
            on=["symbol", "ts"],
            how="left",
        )
    return out
