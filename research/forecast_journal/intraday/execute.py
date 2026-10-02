"""Market cards: stop beyond the swept level, target at the next pool.

Entry is the next minute's open, worsened by slippage. The same slippage is
paid again on the way out. The taker fee is charged on both fill prices.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.forecast_journal.intraday.constants import (
    FEE_PER_SIDE,
    MAX_HOLD_MIN,
    MAX_RISK_ATR,
    MIN_REWARD_OVER_RISK,
    SLIP_ATR_FRAC,
    SLIP_BPS,
    STOP_BUFFER_ATR,
)
from research.forecast_journal.journal.trade import achieved_r


def slip_amount(price: float, atr_1m: float) -> float:
    floor = abs(price) * SLIP_BPS if np.isfinite(price) else 0.0
    extra = SLIP_ATR_FRAC * atr_1m if np.isfinite(atr_1m) and atr_1m > 0 else 0.0
    return float(max(floor, extra))


def plan_card(side: str, row: dict, fee: float = FEE_PER_SIDE) -> dict | None:
    """Geometry known at the close. The backtest replaces entry with the next open."""
    price = float(row.get("price", np.nan))
    atr_h = float(row.get("atr_1h", np.nan))
    atr_m = float(row.get("atr_1m", np.nan))
    if side not in ("long", "short") or not np.isfinite(price) or not np.isfinite(atr_h) or atr_h <= 0:
        return None
    buffer = STOP_BUFFER_ATR * atr_h
    slip = slip_amount(price, atr_m)
    if side == "long":
        invalid = _finite_min(row.get("swept_low_level"), row.get("sweep_wick_low"), row.get("pdl") if _flag(row, "sweep_pdl") else np.nan)
        if not np.isfinite(invalid):
            invalid = row.get("sweep_wick_low")
        stop = float(invalid) - buffer if np.isfinite(invalid) else np.nan
        target = float(row.get("next_pool_up", np.nan))
        entry = price + slip
    else:
        invalid = _finite_max(row.get("swept_high_level"), row.get("sweep_wick_high"), row.get("pdh") if _flag(row, "sweep_pdh") else np.nan)
        if not np.isfinite(invalid):
            invalid = row.get("sweep_wick_high")
        stop = float(invalid) + buffer if np.isfinite(invalid) else np.nan
        target = float(row.get("next_pool_dn", np.nan))
        entry = price - slip
    if not np.isfinite(stop) or not np.isfinite(target):
        return None
    risk = (entry - stop) if side == "long" else (stop - entry)
    reward = (target - entry) if side == "long" else (entry - target)
    if not np.isfinite(risk) or risk <= 0 or risk > MAX_RISK_ATR * atr_h:
        return None
    if not np.isfinite(reward) or reward <= 0 or reward / risk < MIN_REWARD_OVER_RISK:
        return None
    net = reward - fee * (entry + target)
    if net <= 0:
        return None
    return {
        "side": side,
        "entry": float(entry),
        "stop": float(stop),
        "target": float(target),
        "expected_r": float(net / risk),
        "fee_per_side": fee,
        "slip": slip,
    }


def _flag(row: dict, name: str) -> bool:
    try:
        return float(row.get(name, 0) or 0) > 0.5
    except (TypeError, ValueError):
        return False


def _finite_min(*values) -> float:
    nums = [float(v) for v in values if v is not None and np.isfinite(float(v))]
    return float(min(nums)) if nums else float("nan")


def _finite_max(*values) -> float:
    nums = [float(v) for v in values if v is not None and np.isfinite(float(v))]
    return float(max(nums)) if nums else float("nan")


def simulate_book(frame: pd.DataFrame, side: np.ndarray, fee: float = FEE_PER_SIDE) -> list[dict]:
    """One position at a time. Decision at minute close, fill on the next open."""
    if frame.empty:
        return []
    ts = frame["ts"].to_numpy(dtype=np.int64)
    open_ = frame["open"].to_numpy(dtype=float)
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    atr_m = frame["atr_1m"].to_numpy(dtype=float)
    needed = (
        "price",
        "atr_1h",
        "atr_1m",
        "swept_low_level",
        "swept_high_level",
        "sweep_wick_low",
        "sweep_wick_high",
        "sweep_pdl",
        "sweep_pdh",
        "pdl",
        "pdh",
        "next_pool_up",
        "next_pool_dn",
    )
    columns = {name: frame[name].to_numpy(dtype=float) if name in frame.columns else np.full(len(frame), np.nan) for name in needed}
    indexes = np.flatnonzero(np.isin(side, ("long", "short")))
    trades = []
    busy_until = -1
    symbol = str(frame["symbol"].iloc[0]) if "symbol" in frame.columns and len(frame) else ""
    for idx in indexes:
        if int(ts[idx]) < busy_until:
            continue
        if idx + 1 >= len(frame):
            continue
        row = {name: float(values[idx]) for name, values in columns.items()}
        card = plan_card(str(side[idx]), row, fee)
        if card is None:
            continue
        slip = slip_amount(float(open_[idx + 1]), float(atr_m[idx]))
        fill = float(open_[idx + 1] + slip) if card["side"] == "long" else float(open_[idx + 1] - slip)
        # Keep the planned stop/target. Re-check that the slipped open still has room.
        risk = (fill - card["stop"]) if card["side"] == "long" else (card["stop"] - fill)
        if not np.isfinite(risk) or risk <= 0:
            continue
        result = _walk(card["side"], fill, card["stop"], card["target"], high, low, close, open_, ts, idx + 1, fee, slip)
        result.update(
            {
                "symbol": symbol,
                "ts": int(ts[idx]),
                "side": card["side"],
                "entry_plan": card["entry"],
                "stop": card["stop"],
                "target": card["target"],
                "expected_r": card["expected_r"],
            }
        )
        trades.append(result)
        busy_until = int(result["exit_ts"])
    return trades


def simulate_levels(
    frame: pd.DataFrame,
    side: np.ndarray,
    stop: np.ndarray,
    target: np.ndarray,
    *,
    fee: float = FEE_PER_SIDE,
    atr_slip: np.ndarray | None = None,
    atr_1h: np.ndarray | None = None,
    atr_cap: np.ndarray | None = None,
    max_risk_mult: float = MAX_RISK_ATR,
    min_rr: float = MIN_REWARD_OVER_RISK,
    require_atr: bool = False,
    count_from_ts: int | None = None,
    stats: dict | None = None,
) -> list[dict]:
    """Fill the next open. Stop and target are known at the signal close.

    `side` is +1 long, −1 short, 0 flat. Slippage uses `atr_slip` of the
    decision bar (its own ATR), not the hourly ATR.

    `atr_cap` is the ATR that caps the stop, known at the signal close.
    When it is omitted the cap is the hourly ATR. `stats` counts signals,
    filter skips, and taken trades. Counts ignore bars before `count_from_ts`,
    but those bars still occupy the symbol so a later signal can be blocked.
    """
    if frame.empty:
        return []
    ts = frame["ts"].to_numpy(dtype=np.int64)
    open_ = frame["open"].to_numpy(dtype=float)
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    close = frame["close"].to_numpy(dtype=float)
    side_i = np.asarray(side)
    stop_a = np.asarray(stop, dtype=float)
    target_a = np.asarray(target, dtype=float)
    if atr_slip is None:
        atr_slip = frame["atr_bar"].to_numpy(dtype=float) if "atr_bar" in frame.columns else np.zeros(len(frame))
    else:
        atr_slip = np.asarray(atr_slip, dtype=float)
    if atr_1h is None:
        atr_1h = frame["atr_1h"].to_numpy(dtype=float) if "atr_1h" in frame.columns else np.full(len(frame), np.nan)
    else:
        atr_1h = np.asarray(atr_1h, dtype=float)
    cap = np.asarray(atr_1h if atr_cap is None else atr_cap, dtype=float)
    if side_i.dtype.kind in "iuf":
        indexes = np.flatnonzero(side_i != 0)
    else:
        indexes = np.flatnonzero((side_i == "long") | (side_i == "short"))
    if stats is not None:
        stats["signals"] = 0
        stats["skipped_overlap"] = 0
        stats["skipped_gate"] = 0
        stats["taken"] = 0
    trades = []
    busy_until = -1
    symbol = str(frame["symbol"].iloc[0]) if "symbol" in frame.columns and len(frame) else ""
    for idx in indexes:
        counted = count_from_ts is None or int(ts[idx]) >= count_from_ts
        if counted and stats is not None:
            stats["signals"] += 1
        if int(ts[idx]) < busy_until or idx + 1 >= len(frame):
            if counted and stats is not None:
                stats["skipped_overlap"] += 1
            continue
        trade_side = "long" if (side_i.dtype.kind in "iuf" and side_i[idx] > 0) or side_i[idx] == "long" else "short"
        stop_px = float(stop_a[idx])
        target_px = float(target_a[idx])
        atr_h = float(cap[idx]) if idx < len(cap) else float("nan")
        slip_plan = slip_amount(float(close[idx]), float(atr_slip[idx]))
        planned = float(close[idx] + slip_plan) if trade_side == "long" else float(close[idx] - slip_plan)
        if not _geometry_ok(
            trade_side, planned, stop_px, target_px, atr_h, fee,
            max_risk=max_risk_mult, min_rr=min_rr, require_atr=require_atr,
        ):
            if counted and stats is not None:
                stats["skipped_gate"] += 1
            continue
        slip = slip_amount(float(open_[idx + 1]), float(atr_slip[idx]))
        fill = float(open_[idx + 1] + slip) if trade_side == "long" else float(open_[idx + 1] - slip)
        if not _geometry_ok(
            trade_side, fill, stop_px, target_px, atr_h, fee,
            max_risk=max_risk_mult, min_rr=min_rr, require_atr=require_atr,
        ):
            if counted and stats is not None:
                stats["skipped_gate"] += 1
            continue
        result = _walk(trade_side, fill, stop_px, target_px, high, low, close, open_, ts, idx + 1, fee, slip, clock=True)
        reward = (target_px - fill) if trade_side == "long" else (fill - target_px)
        risk = (fill - stop_px) if trade_side == "long" else (stop_px - fill)
        net = reward - fee * (fill + target_px)
        result.update(
            {
                "symbol": symbol,
                "ts": int(ts[idx]),
                "side": trade_side,
                "entry_plan": planned,
                "stop": stop_px,
                "target": target_px,
                "expected_r": float(net / risk) if risk > 0 else float("nan"),
            }
        )
        trades.append(result)
        busy_until = int(result["exit_ts"])
        if counted and stats is not None:
            stats["taken"] += 1
    return trades


def _geometry_ok(
    side: str,
    entry: float,
    stop: float,
    target: float,
    atr_h: float,
    fee: float,
    *,
    max_risk: float = MAX_RISK_ATR,
    min_rr: float = MIN_REWARD_OVER_RISK,
    require_atr: bool = False,
) -> bool:
    if side == "long":
        risk = entry - stop
        reward = target - entry
    else:
        risk = stop - entry
        reward = entry - target
    if not np.isfinite(risk) or risk <= 0 or not np.isfinite(reward) or reward <= 0:
        return False
    if require_atr and (not np.isfinite(atr_h) or atr_h <= 0):
        return False
    if np.isfinite(atr_h) and atr_h > 0 and risk > max_risk * atr_h:
        return False
    net = reward - fee * (entry + target)
    return bool(net > 0 and net / risk >= min_rr)


def _walk(
    side, fill, stop, target, high, low, close, open_, ts, start, fee, slip,
    clock: bool = False, hold_until_ts: int | None = None,
) -> dict:
    decision_ts = int(ts[start - 1])
    t_end = int(hold_until_ts) if hold_until_ts is not None else decision_ts + MAX_HOLD_MIN * 60
    max_high = -np.inf
    min_low = np.inf
    last_close = fill
    last_ts = int(ts[start])
    r_at = {15: np.nan, 60: np.nan, 240: np.nan, 480: np.nan}
    for j in range(start, len(ts)):
        if int(ts[j]) > t_end and j > start:
            break
        bar_open = float(open_[j])
        bar_high = float(high[j])
        bar_low = float(low[j])
        bar_close = float(close[j])
        max_high = max(max_high, bar_high)
        min_low = min(min_low, bar_low)
        reason, exit_raw = _resolve(side, bar_open, bar_high, bar_low, stop, target, j == start)
        elapsed = (int(ts[j]) - decision_ts) / 60.0
        minute = j - start + 1
        mark = elapsed if clock else float(minute)
        if reason is None and ((not clock and minute in r_at) or (clock and any(abs(mark - h) < 1e-6 or mark >= h for h in r_at))):
            px = _r(side, fill, stop, _worse(side, bar_close, slip), fee)
            if clock:
                for horizon in r_at:
                    if mark + 1e-9 >= horizon and not np.isfinite(r_at[horizon]):
                        r_at[horizon] = px
            elif minute in r_at:
                r_at[minute] = px
        if reason is not None:
            exit_price = _worse(side, exit_raw, slip)
            achieved = _r(side, fill, stop, exit_price, fee)
            for horizon in r_at:
                if mark <= horizon and not np.isfinite(r_at[horizon]):
                    r_at[horizon] = achieved
            return _pack(True, reason, fill, exit_price, int(ts[j]), achieved, side, max_high, min_low, r_at)
        last_close = bar_close
        last_ts = int(ts[j])
        if (clock and int(ts[j]) >= t_end) or (not clock and minute >= MAX_HOLD_MIN):
            break
    exit_price = _worse(side, last_close, slip)
    achieved = _r(side, fill, stop, exit_price, fee)
    for horizon, value in list(r_at.items()):
        if not np.isfinite(value):
            r_at[horizon] = achieved
    return _pack(True, "expiry", fill, exit_price, last_ts, achieved, side, max_high, min_low, r_at)


def _resolve(side, bar_open, bar_high, bar_low, stop, target, first_bar: bool):
    if side == "long":
        if bar_open <= stop:
            return "stop", bar_open
        # The entry bar can still stop out after the open fill.
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
    _ = first_bar
    return None, None


def _worse(side: str, price: float, slip: float) -> float:
    if side == "long":
        return float(price) - slip
    return float(price) + slip


def _r(side, fill, stop, exit_price, fee) -> float:
    return achieved_r(side, fill, stop, exit_price, fee)


def _pack(filled, reason, fill, exit_price, exit_ts, achieved, side, max_high, min_low, r_at) -> dict:
    mfe = mae = float("nan")
    if np.isfinite(fill) and fill > 0 and np.isfinite(max_high) and np.isfinite(min_low):
        up = max_high / fill - 1.0
        down = min_low / fill - 1.0
        if side == "long":
            mfe, mae = float(up), float(down)
        else:
            mfe, mae = float(-down), float(-up)
    return {
        "filled": filled,
        "first_hit": reason,
        "fill_price": float(fill),
        "exit_price": float(exit_price),
        "exit_ts": int(exit_ts),
        "r_achieved": float(achieved) if np.isfinite(achieved) else 0.0,
        "mfe": mfe,
        "mae": mae,
        "r_15m": r_at[15],
        "r_1h": r_at[60],
        "r_4h": r_at[240],
        "r_8h": r_at[480],
    }


def max_drawdown(r: np.ndarray) -> float:
    x = np.asarray(r, dtype=float)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return float("nan")
    equity = np.cumsum(x)
    peak = np.maximum.accumulate(equity)
    return float(np.max(peak - equity))
