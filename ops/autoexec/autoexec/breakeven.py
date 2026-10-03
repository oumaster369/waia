"""Перенос стопа в безубыток после +1R и необязательный трейлинг."""

from __future__ import annotations

import math


def r_distance(entry: float, initial_stop: float) -> float:
    return abs(entry - initial_stop)


def favorable_r(direction: str, entry: float, price: float, distance: float) -> float:
    if distance <= 0:
        return 0.0
    if direction == "long":
        return (price - entry) / distance
    if direction == "short":
        return (entry - price) / distance
    return 0.0


def _ceil_tick(price: float, tick: float) -> float:
    if tick <= 0:
        return price
    steps = price / tick
    nearest = round(steps)
    if abs(steps - nearest) < 1e-8:
        return round(nearest * tick, 10)
    return round(math.ceil(steps - 1e-12) * tick, 10)


def _floor_tick(price: float, tick: float) -> float:
    if tick <= 0:
        return price
    steps = price / tick
    nearest = round(steps)
    if abs(steps - nearest) < 1e-8:
        return round(nearest * tick, 10)
    return round(math.floor(steps + 1e-12) * tick, 10)


def breakeven_price(direction: str, entry: float, fee_rt: float, tick: float) -> float:
    """Стоп, который покрывает круг комиссий. Лонг округляется вверх, шорт — вниз."""
    if direction == "long":
        return _ceil_tick(entry * (1.0 + fee_rt), tick)
    return _floor_tick(entry * (1.0 - fee_rt), tick)


def next_stop(
    *,
    direction: str,
    entry: float,
    initial_stop: float,
    current_stop: float,
    price: float,
    fee_rt: float,
    tick: float,
    trigger_r: float,
    trail_enabled: bool,
    trail_distance_r: float,
) -> float | None:
    """Новый стоп только уже текущего. None — переносить нечего."""
    distance = r_distance(entry, initial_stop)
    if distance <= 0:
        return None
    if favorable_r(direction, entry, price, distance) + 1e-12 < trigger_r:
        return None
    be = breakeven_price(direction, entry, fee_rt, tick)
    candidate = be
    if trail_enabled and trail_distance_r > 0:
        if direction == "long":
            trail = _floor_tick(price - trail_distance_r * distance, tick)
            candidate = max(be, trail)
        else:
            trail = _ceil_tick(price + trail_distance_r * distance, tick)
            candidate = min(be, trail)
    if direction == "long":
        if candidate > current_stop + 1e-12 and candidate < price:
            return candidate
        return None
    if direction == "short":
        if candidate < current_stop - 1e-12 and candidate > price:
            return candidate
        return None
    return None
