"""Отмена неисполненного входа: только явные cancel_if_last_above / below и срок."""

from __future__ import annotations

import datetime as dt

from .timeutil import parse_msk


def price_cancel_reason(last: float, above, below) -> str | None:
    """above срабатывает строго при last > уровня, below — при last < уровня.

    cancel_if_last_beyond намеренно не читается: направление было двусмысленным.
    """
    parts: list[str] = []
    if above is not None and above != "":
        if last > float(above):
            parts.append("cancel_if_last_above")
    if below is not None and below != "":
        if last < float(below):
            parts.append("cancel_if_last_below")
    return "+".join(parts) if parts else None


def should_cancel_pending(pos: dict, last: float | None, now: dt.datetime) -> str | None:
    reasons: list[str] = []
    if last is not None:
        price_reason = price_cancel_reason(
            last,
            pos.get("cancel_if_last_above"),
            pos.get("cancel_if_last_below"),
        )
        if price_reason:
            reasons.append(price_reason)
    expires = parse_msk(pos.get("expires"))
    if expires is not None and now > expires:
        reasons.append("expires")
    entry_expires = pos.get("entry_expires")
    if entry_expires:
        entry_deadline = parse_msk(str(entry_expires))
        if entry_deadline is not None and now > entry_deadline:
            reasons.append("entry_expires")
    return "+".join(reasons) if reasons else None
