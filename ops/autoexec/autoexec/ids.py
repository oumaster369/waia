"""Стабильный client_order_id: один и тот же после рестарта, без дубля ордера."""

from __future__ import annotations

import hashlib


def make_client_order_id(account_id: str, card_id: str) -> str:
    digest = hashlib.sha256(f"committee-autoexec|{account_id}|{card_id}".encode()).digest()
    number = int.from_bytes(digest[:8], "big") % 10**16
    return f"77{number:016d}"
