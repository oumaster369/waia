"""Автостопы: день, серия по ситуации, неделя, проскальзывание, средний R, тишина данных."""

from __future__ import annotations

import datetime as dt

from .timeutil import iso_week, parse_msk, today_msk


def evaluate_equity_stops(state: dict, equity: float, now: dt.datetime, cfg: dict) -> list[dict]:
    """Обновляет базы дня и недели. Возвращает только новые события."""
    events: list[dict] = []
    today = today_msk(now)
    week = iso_week(now)
    if state.get("day") != today:
        state["day"] = today
        state["day_start_equity"] = equity
        state["halted_day"] = None
        events.append({"kind": "day_start", "equity": round(equity, 2)})
    if state.get("week_start_equity") is None or (state.get("week") != week and not state.get("halted_week")):
        state["week"] = week
        state["week_start_equity"] = equity
    elif state.get("week") != week:
        state["week"] = week

    start = state.get("day_start_equity")
    daily = float(cfg["daily_loss_stop_pct"])
    if start is not None and float(start) > 0 and equity <= float(start) * (1.0 - daily / 100.0):
        if state.get("halted_day") != today:
            state["halted_day"] = today
            events.append(
                {
                    "kind": "daily_stop",
                    "reason": "daily_loss",
                    "equity": round(equity, 2),
                    "start": round(float(start), 2),
                }
            )
    wstart = state.get("week_start_equity")
    weekly = float(cfg["weekly_drawdown_stop_pct"])
    if (
        wstart is not None
        and float(wstart) > 0
        and not state.get("halted_week")
        and equity <= float(wstart) * (1.0 - weekly / 100.0)
    ):
        state["halted_week"] = True
        events.append(
            {
                "kind": "autostop",
                "reason": "weekly_drawdown",
                "equity": round(equity, 2),
                "start": round(float(wstart), 2),
            }
        )
    return events


def situation_blocked(state: dict, situation: str, now: dt.datetime) -> bool:
    raw = (state.get("situation_halts") or {}).get(situation)
    if not raw:
        return False
    until = parse_msk(str(raw))
    if until is None:
        return False
    return now < until


def record_close(state: dict, situation: str, r_multiple: float, now: dt.datetime, cfg: dict) -> list[dict]:
    """Убыток увеличивает серию ситуации, неотрицательный R её сбрасывает."""
    events: list[dict] = []
    streaks = state.setdefault("situation_streaks", {})
    if r_multiple < 0:
        streaks[situation] = int(streaks.get(situation) or 0) + 1
    else:
        streaks[situation] = 0
    limit = int(cfg["situation_loss_streak"])
    if streaks[situation] >= limit:
        until = now + dt.timedelta(hours=float(cfg["situation_halt_hours"]))
        state.setdefault("situation_halts", {})[situation] = until.isoformat(timespec="seconds")
        streaks[situation] = 0
        events.append({"kind": "autostop", "reason": "situation_streak", "situation": situation, "until": state["situation_halts"][situation]})
    closed = state.setdefault("closed_r", [])
    closed.append(float(r_multiple))
    window = int(cfg["avg_r_window"])
    if window > 0 and len(closed) >= window and not state.get("avg_r_halt"):
        sample = closed[-window:]
        avg = sum(sample) / len(sample)
        if avg < float(cfg["min_avg_r"]):
            state["avg_r_halt"] = True
            events.append({"kind": "autostop", "reason": "avg_r", "avg_r": round(avg, 4), "window": window})
    return events


def adverse_slippage_bps(direction: str, planned: float, fill: float) -> float:
    if planned <= 0:
        return 0.0
    if direction == "long":
        return (fill - planned) / planned * 10000.0
    if direction == "short":
        return (planned - fill) / planned * 10000.0
    return 0.0


def note_slippage(state: dict, direction: str, planned: float, fill: float, cfg: dict) -> dict | None:
    bps = adverse_slippage_bps(direction, planned, fill)
    if bps <= float(cfg["max_slippage_bps"]):
        return None
    event = {"kind": "autostop", "reason": "slippage", "slippage_bps": round(bps, 2), "direction": direction}
    if cfg.get("slippage_halt"):
        state["slippage_halt"] = True
    return event


def entries_blocked_reason(state: dict, now: dt.datetime, data_age_sec: float | None, cfg: dict) -> str | None:
    if state.get("operator_disabled"):
        return "operator_disabled"
    if state.get("halted_week"):
        return "weekly_drawdown"
    if state.get("slippage_halt"):
        return "slippage"
    if state.get("avg_r_halt"):
        return "avg_r"
    if state.get("halted_day") == today_msk(now):
        return "daily_loss"
    max_age = float(cfg["data_max_age_sec"])
    if data_age_sec is None or data_age_sec > max_age:
        return "stale_data"
    return None
