"""Сторож задержки event loop сборщика.

Если цикл не отмечает пульс дольше порога, процесс завершается с кодом 1.
systemd (Restart=always) поднимает его заново. Тихое зависание на 100% CPU
этого не делает: сокеты просто перестают читаться.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable

LOG = logging.getLogger("obheat.loopwatch")

# Дольше типичного таймаута WS-рукопожатия, короче пяти минут feedwatch.
DEFAULT_LOOP_LAG_S = 20.0


def loop_lag_threshold(default: float = DEFAULT_LOOP_LAG_S) -> float:
    """Порог из OBHEAT_LOOP_LAG_S. 0 выключает сторож. Пусто — default. Мусор — default."""
    raw = os.environ.get("OBHEAT_LOOP_LAG_S", "").strip()
    if raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if value < 0:
        return default
    return value


def start_loop_watch(
    loop,
    *,
    threshold_s: float,
    interval_s: float = 1.0,
    exit_fn: Callable[[int], None] = os._exit,
) -> threading.Event:
    """Поставить пульс на `loop` и поток, который убивает процесс при задержке.

    Вернутое событие останавливает сторож (чистый shutdown до flush). Пока
    цикл не ответил ни разу, ждём не дольше порога — зависший старт тоже выход.
    """
    if threshold_s <= 0:
        raise ValueError("threshold_s must be positive; skip the call to disable")
    if interval_s <= 0 or interval_s >= threshold_s:
        raise ValueError("interval_s must be > 0 and shorter than the threshold")
    stop = threading.Event()
    state: dict[str, float | None] = {"beat": None}

    def beat() -> None:
        state["beat"] = time.monotonic()
        if not stop.is_set():
            loop.call_later(interval_s, beat)

    loop.call_soon(beat)

    def die(lag: float) -> None:
        LOG.error(
            "event loop lag %.1fs exceeds %.1fs; exiting 1 so systemd can restart",
            lag,
            threshold_s,
        )
        for handler in logging.getLogger().handlers:
            try:
                handler.flush()
            except Exception:
                pass
        exit_fn(1)

    def watch() -> None:
        started = time.monotonic()
        while state["beat"] is None:
            if stop.is_set():
                return
            if time.monotonic() - started > threshold_s:
                die(time.monotonic() - started)
                return
            if stop.wait(interval_s):
                return
        while not stop.wait(interval_s):
            beat_at = state["beat"]
            if beat_at is None:
                continue
            lag = time.monotonic() - beat_at
            if lag > threshold_s:
                die(lag)
                return

    threading.Thread(target=watch, name="obheat-loopwatch", daemon=True).start()
    return stop
