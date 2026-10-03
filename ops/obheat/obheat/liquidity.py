"""Снимок ликвидности для /api/liquidity и SSE.

Стены — измеренный стакан. Кластеры ликвидаций — та же модель, что у /levels
(недавний объём по плечам), помеченная как оценка. Magnet — доля доллара
внутри полосы 0.5/1/2/3% выше и ниже середины.
"""

from __future__ import annotations

from typing import Iterable

BANDS = (0.5, 1.0, 2.0, 3.0)
LEVERAGE_TIERS = (5, 10, 25, 50, 100)
MAINTENANCE_MARGIN = 0.004
SYMBOL_ALIASES = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "BTCUSDT": "BTCUSDT",
    "ETHUSDT": "ETHUSDT",
}


def canonical_symbol(symbol: str) -> str:
    key = symbol.strip().upper()
    if key not in SYMBOL_ALIASES:
        raise ValueError("symbol must be BTC, ETH, BTCUSDT or ETHUSDT")
    return SYMBOL_ALIASES[key]


class WallBook:
    """Память стен между секундами: сколько живёт уровень и куда едет объём."""

    def __init__(self) -> None:
        self._rows: dict[tuple, dict] = {}

    def observe(self, ts: int, venue: str, symbol: str, walls: list[dict]) -> list[dict]:
        seen: set[tuple] = set()
        out = []
        for wall in walls:
            price = round(float(wall["price"]), 4)
            key = (venue, symbol, wall["side"], price)
            seen.add(key)
            prev = self._rows.get(key)
            since = ts if prev is None else int(prev["since"])
            prev_usd = float(wall["usd"]) if prev is None else float(prev["usd"])
            usd = float(wall["usd"])
            if prev is None or prev_usd <= 0:
                trend = "stable"
            elif usd > prev_usd * 1.08:
                trend = "growing"
            elif usd < prev_usd * 0.92:
                trend = "pulled"
            else:
                trend = "stable"
            self._rows[key] = {"since": since, "usd": usd, "coin": wall.get("coin")}
            out.append(
                {
                    "side": wall["side"],
                    "price": float(wall["price"]),
                    "coin": wall.get("coin"),
                    "usd": usd,
                    "persistence_s": max(0, int(ts) - since),
                    "trend": trend,
                }
            )
        stale = [
            key
            for key in self._rows
            if key[0] == venue and key[1] == symbol and key not in seen and int(ts) - int(self._rows[key]["since"]) > 120
        ]
        for key in stale:
            self._rows.pop(key, None)
        return out


def top_walls(column: dict, limit: int = 8) -> list[dict]:
    walls = []
    for side, rows in (("bid", column.get("bids") or []), ("ask", column.get("asks") or [])):
        for price, coin, usd in rows:
            walls.append({"side": side, "price": float(price), "coin": float(coin), "usd": float(usd)})
    walls.sort(key=lambda item: item["usd"], reverse=True)
    return walls[:limit]


def nearest_wall(walls: Iterable[dict], side: str, mid: float | None) -> dict | None:
    chosen = [wall for wall in walls if wall["side"] == side]
    if not chosen:
        return None
    if mid is None:
        return chosen[0]
    return min(chosen, key=lambda wall: abs(float(wall["price"]) - mid))


def estimate_liquidations(columns: list[dict], limit: int = 40) -> list[dict]:
    """Модель плеч 5/10/25/50/100x. Не биржевой факт."""
    buckets: dict[tuple[str, float], float] = {}
    tiers = LEVERAGE_TIERS
    mm = MAINTENANCE_MARGIN
    for col in columns[-240:]:
        for trade in col.get("trades") or []:
            price = trade.get("price")
            usd = trade.get("usd") or 0
            if not price or usd <= 0:
                continue
            side = "long" if trade.get("side") == "buy" else "short"
            for lev in tiers:
                if side == "long":
                    level = price * (1 - (1 / lev) + mm)
                    liq_side = "longs"
                else:
                    level = price * (1 + (1 / lev) - mm)
                    liq_side = "shorts"
                rounded = round(level / 10) * 10 if price > 10000 else round(level * 2) / 2
                buckets[(liq_side, rounded)] = buckets.get((liq_side, rounded), 0.0) + usd / len(tiers)
    rows = [{"side": side, "price": price, "usd": usd} for (side, price), usd in buckets.items()]
    rows.sort(key=lambda item: item["usd"], reverse=True)
    return rows[:limit]


def with_distance(rows: list[dict], mid: float | None) -> list[dict]:
    out = []
    for row in rows:
        item = dict(row)
        if mid:
            item["distance_pct"] = (float(row["price"]) - mid) / mid * 100.0
        else:
            item["distance_pct"] = None
        out.append(item)
    return out


def magnet_scores(mid: float | None, bids: list, asks: list, clusters: list[dict]) -> dict:
    """up — доллары выше середины (asks + шорты), down — ниже (bids + лонги)."""
    scores = {}
    for pct in BANDS:
        if not mid:
            label = str(int(pct)) if float(pct).is_integer() else str(pct)
            scores[label] = {"up": 0.0, "down": 0.0}
            continue
        band = mid * pct / 100.0
        down = sum(float(row[2]) for row in bids or [] if mid - band <= float(row[0]) <= mid)
        up = sum(float(row[2]) for row in asks or [] if mid <= float(row[0]) <= mid + band)
        for cluster in clusters:
            price = float(cluster["price"])
            if abs(price - mid) > band:
                continue
            if cluster["side"] in {"longs", "long"}:
                down += float(cluster["usd"])
            else:
                up += float(cluster["usd"])
        total = up + down
        label = str(int(pct)) if float(pct).is_integer() else str(pct)
        scores[label] = {
            "up": round(up / total, 4) if total else 0.0,
            "down": round(down / total, 4) if total else 0.0,
        }
    return scores


def build_snapshot(
    ts: int,
    symbol: str,
    venue: str,
    column: dict,
    walls: list[dict],
    clusters: list[dict],
    freshness: dict,
) -> dict:
    mid = column.get("mid")
    bids = column.get("bids") or []
    asks = column.get("asks") or []
    best_bid = max((float(row[0]) for row in bids), default=None)
    best_ask = min((float(row[0]) for row in asks), default=None)
    placed = with_distance(walls, mid)
    clusters = with_distance(clusters, mid)
    return {
        "symbol": symbol,
        "venue": venue,
        "ts": ts,
        "last": mid,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "book_ok": bool(column.get("book_ok")),
        "nearest_bid_wall": _public_wall(nearest_wall(placed, "bid", mid), mid),
        "nearest_ask_wall": _public_wall(nearest_wall(placed, "ask", mid), mid),
        "walls": placed[:12],
        "liquidation_clusters": clusters[:12],
        "liquidation_model": "recent-volume leverage tiers 5/10/25/50/100; estimate, not an exchange print",
        "magnet": magnet_scores(mid, bids, asks, clusters),
        "freshness": freshness,
    }


def _public_wall(wall: dict | None, mid: float | None) -> dict | None:
    if wall is None:
        return None
    return {
        "side": wall["side"],
        "price": wall["price"],
        "usd": wall["usd"],
        "coin": wall.get("coin"),
        "persistence_s": wall.get("persistence_s", 0),
        "trend": wall.get("trend", "stable"),
        "distance_pct": None if not mid else (float(wall["price"]) - mid) / mid * 100.0,
    }
