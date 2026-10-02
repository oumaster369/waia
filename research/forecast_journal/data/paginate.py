"""Walk a time range backward in windows the exchange will accept."""

from __future__ import annotations

from typing import Callable

Fetch = Callable[[int, int], list[dict]]


def walk_backward(
    fetch: Fetch,
    start: int,
    end: int,
    period_sec: int,
    *,
    max_bars: int = 1400,
    empty_gap_sec: int = 60 * 86400,
    max_requests: int = 8000,
) -> list[dict]:
    """Fetch `[start, end]` by walking from `end` toward `start`.

    `fetch(window_start, window_end)` returns rows with integer `open_time`.
    An empty window accumulates a gap; after `empty_gap_sec` of consecutive
    emptiness the walk stops (listing start, or a long halt). Duplicate
    `open_time` values keep the later copy. Windows that do not overlap the
    request are treated as "endpoint ignored the range" and stop the walk.
    """
    if end < start or period_sec <= 0:
        return []
    step = period_sec * max(1, max_bars - 1)
    cursor_end = int(end)
    empty_seconds = 0
    seen_oldest: int | None = None
    rows: list[dict] = []
    requests = 0
    while cursor_end >= start and requests < max_requests:
        cursor_start = max(int(start), cursor_end - step)
        requests += 1
        batch = fetch(cursor_start, cursor_end) or []
        window = cursor_end - cursor_start
        if not batch:
            empty_seconds += max(window, period_sec)
            if empty_seconds >= empty_gap_sec or cursor_start <= start:
                break
            cursor_end = cursor_start - period_sec
            continue
        times = [int(row["open_time"]) for row in batch]
        oldest = min(times)
        newest = max(times)
        if newest < cursor_start or oldest > cursor_end:
            break
        empty_seconds = 0
        rows.extend(batch)
        if seen_oldest is not None and oldest >= seen_oldest:
            break
        seen_oldest = oldest
        if oldest <= start:
            break
        cursor_end = oldest - period_sec
    return _dedupe(rows, start, end)


def _dedupe(rows: list[dict], start: int, end: int) -> list[dict]:
    kept: dict[int, dict] = {}
    for row in rows:
        ot = int(row["open_time"])
        if ot < start or ot > end:
            continue
        kept[ot] = row
    return [kept[k] for k in sorted(kept)]
