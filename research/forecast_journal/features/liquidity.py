"""Live liquidity endpoint → feature fields, and the L (magnet) score.

History does not have this feed. Missing fields stay NaN and the WAIA-S
weights are renormalised without L.
"""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np

LIQUIDITY_FIELDS = (
    "liq_last",
    "liq_bid_wall_usd",
    "liq_ask_wall_usd",
    "liq_bid_persist",
    "liq_ask_persist",
    "liq_bid_price",
    "liq_ask_price",
    "liq_magnet_up_0_5",
    "liq_magnet_up_1",
    "liq_magnet_up_2",
    "liq_magnet_up_3",
    "liq_magnet_dn_0_5",
    "liq_magnet_dn_1",
    "liq_magnet_dn_2",
    "liq_magnet_dn_3",
    "imbalance",
)

_MAGNET_KEYS = (("0.5", "0_5"), ("1", "1"), ("2", "2"), ("3", "3"))


def empty_liquidity() -> dict[str, float]:
    return {name: float("nan") for name in LIQUIDITY_FIELDS}


def _first(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def _as_float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float("nan")
    if not np.isfinite(number):
        return float("nan")
    return number


def _nearest_wall(walls: Any) -> tuple[float, float, float]:
    """Return (usd, persistence, price) of the nearest wall, if any."""
    if not isinstance(walls, list) or not walls:
        return float("nan"), float("nan"), float("nan")
    best = None
    best_dist = None
    for wall in walls:
        if not isinstance(wall, dict):
            continue
        usd = _as_float(_first(wall, "usd", "size_usd", "notional", "size"))
        persist = _as_float(_first(wall, "persistence", "persist", "strength"))
        price = _as_float(_first(wall, "price", "px"))
        dist = _as_float(_first(wall, "distance_pct", "distance", "dist"))
        rank = abs(dist) if np.isfinite(dist) else (0.0 if best is None else None)
        if rank is None:
            continue
        if best_dist is None or rank < best_dist:
            best = (usd, persist, price)
            best_dist = rank
    if best is None:
        wall = walls[0]
        if isinstance(wall, dict):
            return (
                _as_float(_first(wall, "usd", "size_usd", "notional", "size")),
                _as_float(_first(wall, "persistence", "persist", "strength")),
                _as_float(_first(wall, "price", "px")),
            )
        return float("nan"), float("nan"), float("nan")
    return best


def _magnet_map(payload: Mapping[str, Any], side: str) -> dict[str, float]:
    raw = _first(payload, f"magnet_{side}", f"magnet{side.title()}", f"{side}_magnet")
    out = {suffix: float("nan") for _, suffix in _MAGNET_KEYS}
    if isinstance(raw, dict):
        for label, suffix in _MAGNET_KEYS:
            out[suffix] = _as_float(_first(raw, label, suffix, f"{label}%"))
        return out
    clusters = payload.get("liquidation_clusters") or payload.get("clusters") or []
    if isinstance(clusters, list):
        for cluster in clusters:
            if not isinstance(cluster, dict):
                continue
            cluster_side = str(_first(cluster, "side", "direction") or "").lower()
            if side not in cluster_side and not (
                side == "up" and cluster_side in ("ask", "short", "above") or side == "down" and cluster_side in ("bid", "long", "below")
            ):
                # Accept explicit up/down only when the label matches.
                if cluster_side not in (side, f"{side}side"):
                    continue
            dist = _as_float(_first(cluster, "distance_pct", "distance", "pct"))
            score = _as_float(_first(cluster, "magnet", "magnet_score", "score"))
            for label, suffix in _MAGNET_KEYS:
                if np.isfinite(dist) and abs(dist - float(label)) < 0.15:
                    out[suffix] = score
    return out


def parse_liquidity(payload: Mapping[str, Any] | None) -> dict[str, float]:
    """Tolerant parser for `/api/liquidity?symbol=BTC`.

    Expected fields (aliases accepted): last price, nearest bid/ask walls
    (`usd`/`size_usd`, `persistence`), liquidation clusters with `distance_pct`
    and `magnet`, or maps `magnet_up` / `magnet_down` keyed by 0.5/1/2/3.
    """
    fields = empty_liquidity()
    if not isinstance(payload, dict):
        return fields
    fields["liq_last"] = _as_float(_first(payload, "last", "last_price", "price"))
    bid_usd, bid_persist, bid_price = _nearest_wall(_first(payload, "bid_walls", "bids", "bidWalls") or [])
    ask_usd, ask_persist, ask_price = _nearest_wall(_first(payload, "ask_walls", "asks", "askWalls") or [])
    fields["liq_bid_wall_usd"] = bid_usd
    fields["liq_ask_wall_usd"] = ask_usd
    fields["liq_bid_persist"] = bid_persist
    fields["liq_ask_persist"] = ask_persist
    fields["liq_bid_price"] = bid_price
    fields["liq_ask_price"] = ask_price
    up = _magnet_map(payload, "up")
    down = _magnet_map(payload, "down")
    for _, suffix in _MAGNET_KEYS:
        fields[f"liq_magnet_up_{suffix}"] = up[suffix]
        fields[f"liq_magnet_dn_{suffix}"] = down[suffix]
    bid = bid_usd * bid_persist if np.isfinite(bid_usd) and np.isfinite(bid_persist) else bid_usd
    ask = ask_usd * ask_persist if np.isfinite(ask_usd) and np.isfinite(ask_persist) else ask_usd
    if np.isfinite(bid) or np.isfinite(ask):
        b = bid if np.isfinite(bid) else 0.0
        a = ask if np.isfinite(ask) else 0.0
        denom = b + a
        fields["imbalance"] = (b - a) / denom if denom > 0 else 0.0
    return fields


def liquidity_magnet(fields: Mapping[str, Any]) -> float:
    """L in [-1, 1]. NaN when neither magnets nor walls are present.

    Magnet component is tanh of the persistence-weighted (up − down) score.
    Wall component is clip((bid$·persistence − ask$·persistence) / sum).
    """
    weights = (0.40, 0.30, 0.20, 0.10)
    num = 0.0
    den = 0.0
    any_magnet = False
    for weight, (_, suffix) in zip(weights, _MAGNET_KEYS):
        up = _as_float(fields.get(f"liq_magnet_up_{suffix}"))
        down = _as_float(fields.get(f"liq_magnet_dn_{suffix}"))
        if not np.isfinite(up) and not np.isfinite(down):
            continue
        any_magnet = True
        num += weight * ((up if np.isfinite(up) else 0.0) - (down if np.isfinite(down) else 0.0))
        den += weight
    magnet = float(np.tanh(num / den)) if any_magnet and den > 0 else float("nan")
    imb = _as_float(fields.get("imbalance"))
    parts = [p for p in (magnet, imb) if np.isfinite(p)]
    if not parts:
        return float("nan")
    return float(np.clip(np.mean(parts), -1.0, 1.0))
