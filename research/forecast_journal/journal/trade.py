"""Trade cards, fees, and path-dependent reality.

Same-bar ambiguity: if a bar trades through both the stop and the target,
the stop is assumed to have been hit first. A bar that opens beyond the stop
exits at the open.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class PathBars:
    open_time: np.ndarray
    close_time: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    timeframe: str

    @classmethod
    def from_frame(cls, frame: pd.DataFrame, timeframe: str) -> "PathBars | None":
        if frame is None or frame.empty:
            return None
        df = frame.sort_values("open_time")
        return cls(
            open_time=df["open_time"].to_numpy(dtype=np.int64),
            close_time=df["close_time"].to_numpy(dtype=np.int64),
            open=df["open"].to_numpy(dtype=float),
            high=df["high"].to_numpy(dtype=float),
            low=df["low"].to_numpy(dtype=float),
            close=df["close"].to_numpy(dtype=float),
            timeframe=timeframe,
        )


def expected_r(side: str, entry: float, stop: float, target: float, fee: float) -> float:
    """Net reward at the target divided by the initial price risk. Fees are per side."""
    if side == "long":
        risk = entry - stop
        gross = target - entry
    elif side == "short":
        risk = stop - entry
        gross = entry - target
    else:
        return float("nan")
    if not np.isfinite(risk) or not np.isfinite(gross) or risk <= 0 or gross <= 0:
        return float("nan")
    if not np.isfinite(entry) or not np.isfinite(target) or entry <= 0 or target <= 0:
        return float("nan")
    net = gross - fee * (entry + target)
    return float(net / risk)


def achieved_r(side: str, fill: float, stop: float, exit_price: float, fee: float) -> float:
    if side == "long":
        risk = fill - stop
        gross = exit_price - fill
    elif side == "short":
        risk = stop - fill
        gross = fill - exit_price
    else:
        return float("nan")
    if not np.isfinite(risk) or risk <= 0 or not np.isfinite(gross) or not np.isfinite(exit_price):
        return float("nan")
    net = gross - fee * (fill + exit_price)
    return float(net / risk)


def pick_target(side: str, entry: float, stop: float, opposite_swing: float, two_atr: float, fee: float, min_rr: float) -> tuple[float, float]:
    """Nearest target among the opposite swing and the 2·ATR mark that clears `min_rr`."""
    candidates: list[tuple[float, float, float]] = []
    for target in (opposite_swing, two_atr):
        reward = expected_r(side, entry, stop, float(target) if target is not None else float("nan"), fee)
        if np.isfinite(reward) and reward + 1e-12 >= min_rr:
            candidates.append((abs(float(target) - entry), float(target), reward))
    if not candidates:
        return float("nan"), float("nan")
    candidates.sort()
    _, target, reward = candidates[0]
    return target, reward


def apply_market_cards(
    side: np.ndarray,
    price: np.ndarray,
    atr: np.ndarray,
    fee: float,
    min_rr: float,
    stop_mult: float = 1.0,
    target_mult: float = 2.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Market entry at `price`, stop/target in ATR. Cards that miss `min_rr` become flat."""
    side = np.array(side, dtype=object, copy=True)
    price = np.asarray(price, dtype=float)
    atr = np.asarray(atr, dtype=float)
    entry = price.copy()
    stop = np.full(len(side), np.nan)
    target = np.full(len(side), np.nan)
    long = side == "long"
    short = side == "short"
    stop[long] = price[long] - stop_mult * atr[long]
    stop[short] = price[short] + stop_mult * atr[short]
    target[long] = price[long] + target_mult * atr[long]
    target[short] = price[short] - target_mult * atr[short]
    reward = np.full(len(side), np.nan)
    for idx in np.flatnonzero(long | short):
        reward[idx] = expected_r(str(side[idx]), float(entry[idx]), float(stop[idx]), float(target[idx]), fee)
        if not np.isfinite(reward[idx]) or reward[idx] < min_rr:
            side[idx] = "flat"
            entry[idx] = np.nan
            stop[idx] = np.nan
            target[idx] = np.nan
            reward[idx] = np.nan
    return side, entry, stop, target, reward


def simulate_trade(
    path: PathBars,
    decision_ts: int,
    horizon_s: int,
    side: str,
    entry: float,
    stop: float,
    target: float,
    fee: float,
) -> dict:
    """Fill and manage one card on bars that open at or after the decision."""
    t_end = int(decision_ts) + int(horizon_s)
    base = {
        "filled": False,
        "first_hit": "unfilled",
        "fill_price": float("nan"),
        "exit_price": float("nan"),
        "exit_ts": t_end,
        "r_achieved": 0.0,
        "mfe": float("nan"),
        "mae": float("nan"),
        "path_tf": path.timeframe,
    }
    if side not in ("long", "short") or path is None or len(path.open_time) == 0:
        base["first_hit"] = "no_trade" if side not in ("long", "short") else "unfilled"
        base["r_achieved"] = float("nan") if side not in ("long", "short") else 0.0
        return base
    i = int(np.searchsorted(path.open_time, int(decision_ts), side="left"))
    filled = False
    fill_price = float("nan")
    max_high = -np.inf
    min_low = np.inf
    last_close = float("nan")
    last_ct = t_end
    while i < len(path.open_time) and int(path.close_time[i]) <= t_end:
        bar_open = float(path.open[i])
        bar_high = float(path.high[i])
        bar_low = float(path.low[i])
        bar_close = float(path.close[i])
        if not filled:
            if side == "long" and bar_low <= entry:
                fill_price = bar_open if bar_open <= entry else float(entry)
                filled = True
            elif side == "short" and bar_high >= entry:
                fill_price = bar_open if bar_open >= entry else float(entry)
                filled = True
            if not filled:
                i += 1
                continue
        max_high = max(max_high, bar_high)
        min_low = min(min_low, bar_low)
        reason, exit_price = _resolve_bar(side, bar_open, bar_high, bar_low, stop, target)
        if reason is not None:
            return _closed(base, side, fill_price, stop, exit_price, int(path.close_time[i]), reason, max_high, min_low, fee, path.timeframe)
        last_close = bar_close
        last_ct = int(path.close_time[i])
        i += 1
    if not filled:
        return base
    return _closed(base, side, fill_price, stop, last_close, last_ct, "expiry", max_high, min_low, fee, path.timeframe)


def _resolve_bar(side: str, bar_open: float, bar_high: float, bar_low: float, stop: float, target: float):
    if side == "long":
        if bar_open <= stop:
            return "stop", bar_open
        hit_stop = bar_low <= stop
        hit_target = bar_high >= target
        if hit_stop and hit_target:
            return "stop", float(stop)
        if hit_stop:
            return "stop", float(stop)
        if hit_target:
            return "target", float(target)
        return None, None
    if bar_open >= stop:
        return "stop", bar_open
    hit_stop = bar_high >= stop
    hit_target = bar_low <= target
    if hit_stop and hit_target:
        return "stop", float(stop)
    if hit_stop:
        return "stop", float(stop)
    if hit_target:
        return "target", float(target)
    return None, None


def _closed(base, side, fill, stop, exit_price, exit_ts, reason, max_high, min_low, fee, tf) -> dict:
    out = dict(base)
    out["filled"] = True
    out["first_hit"] = reason
    out["fill_price"] = float(fill)
    out["exit_price"] = float(exit_price)
    out["exit_ts"] = int(exit_ts)
    out["r_achieved"] = achieved_r(side, float(fill), float(stop), float(exit_price), fee)
    if np.isfinite(fill) and fill > 0 and np.isfinite(max_high) and np.isfinite(min_low):
        up = max_high / fill - 1.0
        down = min_low / fill - 1.0
        if side == "long":
            out["mfe"] = float(up)
            out["mae"] = float(down)
        else:
            out["mfe"] = float(-down)  # favourable move is a decline
            out["mae"] = float(-up)
    out["path_tf"] = tf
    return out


def choose_path(
    paths: dict[str, PathBars | None],
    decision_ts: int,
    horizon_s: int,
    preference: tuple[str, ...] = ("1m", "15m", "1h"),
) -> PathBars | None:
    t_end = int(decision_ts) + int(horizon_s)
    for name in preference:
        path = paths.get(name)
        if path is None or len(path.close_time) == 0:
            continue
        if int(path.open_time[0]) <= int(decision_ts) and int(path.close_time[-1]) >= t_end - _period_guess(path):
            # Coverage of the forward window, not merely of the decision stamp.
            if int(path.close_time[-1]) >= t_end - _period_guess(path) and int(path.open_time[0]) <= decision_ts:
                start = int(np.searchsorted(path.open_time, int(decision_ts), side="left"))
                if start < len(path.open_time) and int(path.close_time[min(len(path.close_time) - 1, start)]) <= t_end:
                    if int(path.close_time[-1]) >= decision_ts:
                        return path
    for name in preference:
        if paths.get(name) is not None:
            return paths[name]
    return None


def _period_guess(path: PathBars) -> int:
    if len(path.close_time) < 2:
        return 60
    return int(np.median(np.diff(path.close_time[: min(50, len(path.close_time))])))


def iter_nonoverlapping(
    orders: pd.DataFrame,
    path_map: dict[str, dict[str, PathBars | None]],
    horizon_s: int,
    fee: float,
    preference: tuple[str, ...] = ("1m", "15m", "1h"),
) -> list[dict]:
    """Submit a card only when the symbol is flat. Unfilled cards occupy the book until the horizon."""
    if orders.empty:
        return []
    results = []
    view = orders.sort_values(["symbol", "ts"])
    for symbol, grp in view.groupby("symbol", sort=False):
        paths = path_map.get(symbol) or {}
        busy_until = -1
        for row in grp.itertuples(index=False):
            ts = int(row.ts)
            if ts < busy_until:
                continue
            side = str(row.side)
            path = choose_path(paths, ts, horizon_s, preference)
            if path is None or side not in ("long", "short"):
                continue
            result = simulate_trade(
                path,
                ts,
                horizon_s,
                side,
                float(row.entry),
                float(row.stop),
                float(row.target),
                fee,
            )
            result.update(
                {
                    "symbol": symbol,
                    "ts": ts,
                    "side": side,
                    "entry": float(row.entry),
                    "stop": float(row.stop),
                    "target": float(row.target),
                    "expected_r": float(getattr(row, "expected_r", np.nan)),
                    "horizon_s": horizon_s,
                }
            )
            for extra in ("session", "vol_regime", "model_id", "score", "decision_tf", "S", "T"):
                if hasattr(row, extra):
                    result[extra] = getattr(row, extra)
            results.append(result)
            busy_until = int(result["exit_ts"])
    return results
