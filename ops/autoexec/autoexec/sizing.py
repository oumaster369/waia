"""Размер позиции: 0,75% equity на сделку, кластер BTC+ETH в одну сторону."""

from __future__ import annotations

import math


def risk_budget_usdt(equity: float, risk_pct: float) -> float:
    return equity * risk_pct / 100.0


def cluster_used_usdt(coin: str, direction: str, positions: list[dict], cluster: set[str]) -> float:
    if coin not in cluster:
        return 0.0
    used = 0.0
    for pos in positions:
        status = pos.get("status")
        if status not in ("pending", "open", "closing", "dry_pending", "planned"):
            continue
        other = str(pos.get("coin") or "").upper()
        if other in cluster and pos.get("direction") == direction:
            used += float(pos.get("risk_usdt") or 0)
    return used


def size_position(
    *,
    equity: float,
    entry: float,
    stop: float,
    contract_size: float,
    risk_pct: float,
    leverage: int,
    coin: str,
    direction: str,
    positions: list[dict],
    cluster: set[str],
    max_risk_usdt: float | None = None,
) -> dict | None:
    """Целое число контрактов. None, если даже 1 контракт не влезает в остаток риска."""
    if entry <= 0 or contract_size <= 0 or equity <= 0:
        return None
    distance = abs(entry - stop) / entry
    if distance <= 0:
        return None
    budget = risk_budget_usdt(equity, risk_pct)
    used = cluster_used_usdt(coin, direction, positions, cluster)
    if coin in cluster:
        budget = max(0.0, budget - used)
    if max_risk_usdt is not None:
        budget = min(budget, float(max_risk_usdt))
    if budget <= 0:
        return None
    notional_cap = budget / distance
    contracts = math.floor(notional_cap / (contract_size * entry))
    if contracts < 1:
        return None
    notional = contracts * contract_size * entry
    risk_usdt = contracts * contract_size * abs(entry - stop)
    if risk_usdt - budget > 1e-6:
        return None
    margin = notional / leverage if leverage else notional
    return {
        "contracts": int(contracts),
        "notional": round(notional, 2),
        "margin": round(margin, 2),
        "risk_usdt": round(risk_usdt, 4),
        "distance": distance,
    }
