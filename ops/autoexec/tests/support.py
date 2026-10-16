"""Общие фикстуры тестов. Сеть не используется."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = Path(__file__).resolve().parent
for path in (ROOT, TESTS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import datetime as dt

from autoexec.config import load_config
from autoexec.timeutil import MSK, Clock

WHEN = dt.datetime(2026, 10, 2, 12, 0, tzinfo=MSK)


def clock() -> Clock:
    return Clock(WHEN)


def cfg(**overrides) -> dict:
    config = load_config()
    config.update(overrides)
    return config


def btc_card(**overrides) -> dict:
    card = {
        "coin": "BTC",
        "market": "futures",
        "direction": "long",
        "risk_signoff": True,
        "entry": {"type": "limit", "zone": [100000, 100000]},
        "stop": {"price": 97500, "atr_1h": 800},
        "targets": [{"price": 104500, "take_pct": 100}],
        "expires": "2026-10-02 18:00 MSK",
        "thesis_id": "t-btc",
        "card_id": "card-btc-long",
    }
    card.update(overrides)
    return card


def quote(moment: dt.datetime, last: float, bid: float | None = None, ask: float | None = None) -> dict:
    return {
        "last": last,
        "bid": last - 0.1 if bid is None else bid,
        "ask": last + 0.1 if ask is None else ask,
        "ts": moment,
    }
