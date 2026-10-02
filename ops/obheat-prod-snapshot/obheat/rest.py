"""Shared REST governors for venues.

The collector must never turn websocket sequence trouble into REST hammering.
Each venue has one governor that tracks observed exchange weight, Retry-After
ban windows and per-resource cooldowns.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Mapping


@dataclass
class RestStats:
    requests: int = 0
    blocked: int = 0
    failures: int = 0
    used_weight_1m: int = 0
    banned_until: float = 0.0


class RestGovernor:
    def __init__(self, venue: str, max_weight_1m: int = 900) -> None:
        self.venue = venue
        self.max_weight_1m = max_weight_1m
        self.stats = RestStats()
        self._lock = asyncio.Lock()
        self._next_at: dict[str, float] = {}
        self._backoff = 1.0

    def snapshot(self) -> dict:
        return {
            "requests": self.stats.requests,
            "blocked": self.stats.blocked,
            "failures": self.stats.failures,
            "used_weight_1m": self.stats.used_weight_1m,
            "banned_until": self.stats.banned_until or None,
        }

    def is_banned(self) -> bool:
        return time.time() < self.stats.banned_until

    async def wait_turn(self, key: str, min_interval: float) -> bool:
        """Return False when a venue-wide ban/weight cap prevents the call."""
        async with self._lock:
            now = time.time()
            if now < self.stats.banned_until or self.stats.used_weight_1m >= self.max_weight_1m:
                self.stats.blocked += 1
                return False
            next_at = self._next_at.get(key, 0.0)
            if now < next_at:
                self.stats.blocked += 1
                return False
            self._next_at[key] = now + min_interval + random.uniform(0.0, min(5.0, min_interval * 0.2))
            self.stats.requests += 1
            return True

    def ok(self, headers: Mapping[str, str] | None = None) -> None:
        if headers:
            used = _header_int(headers, "x-mbx-used-weight-1m")
            if used is not None:
                self.stats.used_weight_1m = used
        self._backoff = 1.0

    def fail(self, status: int | None = None, headers: Mapping[str, str] | None = None) -> None:
        self.stats.failures += 1
        if headers:
            used = _header_int(headers, "x-mbx-used-weight-1m")
            if used is not None:
                self.stats.used_weight_1m = used
        retry_after = _retry_after(headers or {})
        if status in {418, 429}:
            self.stats.banned_until = max(time.time() + (retry_after or 300.0), self.stats.banned_until)
            return
        self.stats.banned_until = max(time.time() + self._backoff, self.stats.banned_until)
        self._backoff = min(self._backoff * 2, 300.0)


_GOVERNORS: dict[str, RestGovernor] = {}


def governor(venue: str) -> RestGovernor:
    venue = venue.upper()
    if venue not in _GOVERNORS:
        cap = 900 if venue == "BINANCE" else 60
        _GOVERNORS[venue] = RestGovernor(venue, cap)
    return _GOVERNORS[venue]


def _header_int(headers: Mapping[str, str], name: str) -> int | None:
    for key, value in headers.items():
        if key.lower() == name.lower():
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _retry_after(headers: Mapping[str, str]) -> float | None:
    raw = None
    for key, value in headers.items():
        if key.lower() == "retry-after":
            raw = value
            break
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return None
        return max(0.0, parsed.timestamp() - time.time())
