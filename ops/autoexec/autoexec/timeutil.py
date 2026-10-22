"""Время комитета: МСК, без перехода на летнее."""

from __future__ import annotations

import datetime as dt

MSK = dt.timezone(dt.timedelta(hours=3))


class Clock:
    """Подменяемые часы для тестов. По умолчанию — системные МСК."""

    def __init__(self, current: dt.datetime | None = None):
        self._current = current

    def now(self) -> dt.datetime:
        if self._current is None:
            return dt.datetime.now(MSK)
        if self._current.tzinfo is None:
            return self._current.replace(tzinfo=MSK)
        return self._current.astimezone(MSK)

    def advance(self, seconds: float) -> None:
        self._current = self.now() + dt.timedelta(seconds=seconds)


def parse_msk(value: str | None) -> dt.datetime | None:
    """'YYYY-MM-DD HH:MM MSK' или ISO с офсетом. Пустое значение — None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("МСК", "MSK")
    if text.endswith("MSK"):
        text = text[: -len("MSK")].strip()
        parsed = dt.datetime.strptime(text, "%Y-%m-%d %H:%M")
        return parsed.replace(tzinfo=MSK)
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=MSK)
    return parsed.astimezone(MSK)


def iso_week(moment: dt.datetime) -> str:
    local = moment.astimezone(MSK)
    return local.strftime("%G-W%V")


def today_msk(moment: dt.datetime) -> str:
    return moment.astimezone(MSK).strftime("%Y-%m-%d")
