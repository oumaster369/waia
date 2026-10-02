"""In-memory heatmap. Request handlers read a prebuilt cache; they do not rescan history."""

from __future__ import annotations

import base64
import json
import threading
import time

import numpy as np

from obheat.health import VENUE_ORDER, health_line, service_ok
from obheat.model import (
    MAX_COLS,
    SPARSE_K,
    SparseRing,
    WallTracker,
    bucket_last,
    choose_dp,
    find_peaks,
    liquidation_clusters,
    magnet_scores,
    nearest_walls,
    pack_levels,
    scatter,
    window_plan,
)

SEC_COLS = 15 * 60
MIN_COLS = 3 * 24 * 60


def _b64(arr: np.ndarray) -> str:
    raw = np.ascontiguousarray(arr, dtype=np.float32).tobytes()
    return base64.b64encode(raw).decode("ascii")


def _items(idx: np.ndarray, val: np.ndarray, n: int) -> list[tuple[int, float]]:
    return [(int(idx[k]), float(val[k])) for k in range(n)]


class _Venue:
    def __init__(self):
        self.bid_i = np.zeros(SPARSE_K, np.int16)
        self.bid_v = np.zeros(SPARSE_K, np.float32)
        self.bid_n = 0
        self.ask_i = np.zeros(SPARSE_K, np.int16)
        self.ask_v = np.zeros(SPARSE_K, np.float32)
        self.ask_n = 0
        self.last = 0.0
        self.best_bid = 0.0
        self.best_ask = 0.0
        self.updated = 0.0
        self.status = "connecting"
        self.gaps = 0
        self.reason = ""
        self.sec = SparseRing(SEC_COLS)
        self.minute = SparseRing(MIN_COLS)


class _Symbol:
    def __init__(self, name: str, dp: float):
        self.name = name
        self.dp = dp
        self.venues = {vid: _Venue() for vid in VENUE_ORDER}
        self.last = 0.0
        self.best_bid = 0.0
        self.best_ask = 0.0
        self.oi_usd = 0.0
        self.long_frac = 0.5
        self.oi_source = "none"
        self.walls = WallTracker()
        self.last_sec = 0
        self.last_min = 0


class Engine:
    def __init__(self, stale_after: float = 20.0):
        self.stale_after = stale_after
        self.lock = threading.Lock()
        self.symbols: dict[str, _Symbol] = {}
        self.cache: dict[tuple, tuple[float, bytes]] = {}
        self.cache_lock = threading.Lock()

    def ensure(self, symbol: str, ref_price: float) -> _Symbol:
        sym = self.symbols.get(symbol)
        if sym is None:
            dp = choose_dp(ref_price if ref_price > 0 else 100.0)
            sym = _Symbol(symbol, dp)
            self.symbols[symbol] = sym
        return sym

    def apply_book(
        self,
        venue: str,
        symbol: str,
        bids: list[tuple[float, float]],
        asks: list[tuple[float, float]],
        last: float,
        best_bid: float,
        best_ask: float,
        now: float | None = None,
    ) -> None:
        now = time.time() if now is None else now
        ref = last or best_bid or best_ask or (bids[0][0] if bids else 0.0)
        with self.lock:
            sym = self.ensure(symbol, ref or 1.0)
            v = sym.venues.get(venue)
            if v is None:
                return
            bi, bv, bn = pack_levels(bids, sym.dp)
            ai, av, an = pack_levels(asks, sym.dp)
            v.bid_i, v.bid_v, v.bid_n = bi, bv, bn
            v.ask_i, v.ask_v, v.ask_n = ai, av, an
            if last > 0:
                v.last = last
                sym.last = last
            if best_bid > 0:
                v.best_bid = best_bid
                sym.best_bid = best_bid
            if best_ask > 0:
                v.best_ask = best_ask
                sym.best_ask = best_ask
            v.updated = now
            if v.status in ("connecting", "reconnecting", "resync", "stale"):
                v.status = "live"
            self._seal(sym, now)

    def apply_health(
        self,
        venue: str,
        symbol: str,
        status: str,
        gaps: int = 0,
        reason: str = "",
        now: float | None = None,
    ) -> None:
        now = time.time() if now is None else now
        with self.lock:
            sym = self.symbols.get(symbol)
            if sym is None:
                sym = self.ensure(symbol, 1.0)
            v = sym.venues.get(venue)
            if v is None:
                return
            v.status = status
            v.gaps = gaps
            v.reason = reason or ""
            v.updated = now

    def apply_oi(self, symbol: str, oi_usd: float, long_frac: float, source: str) -> None:
        with self.lock:
            sym = self.symbols.get(symbol)
            if sym is None:
                sym = self.ensure(symbol, 1.0)
            sym.oi_usd = max(0.0, oi_usd)
            sym.long_frac = min(1.0, max(0.0, long_frac))
            sym.oi_source = source

    def _seal(self, sym: _Symbol, now: float) -> None:
        sec = int(now)
        if sec == sym.last_sec:
            return
        sym.last_sec = sec
        for v in sym.venues.values():
            if v.bid_n == 0 and v.ask_n == 0:
                continue
            v.sec.append(sec, v.bid_i, v.bid_v, v.bid_n, v.ask_i, v.ask_v, v.ask_n, sym.last or v.last)
        minute = sec // 60
        if minute != sym.last_min:
            sym.last_min = minute
            for v in sym.venues.values():
                if v.bid_n == 0 and v.ask_n == 0:
                    continue
                v.minute.append(
                    minute * 60, v.bid_i, v.bid_v, v.bid_n, v.ask_i, v.ask_v, v.ask_n, sym.last or v.last
                )

    def note_clock(self, now: float | None = None) -> None:
        """Seal columns even when a second ticks with no new book message."""
        now = time.time() if now is None else now
        with self.lock:
            for sym in self.symbols.values():
                self._refresh_stale(sym, now)
                self._seal(sym, now)

    def _refresh_stale(self, sym: _Symbol, now: float) -> None:
        for v in sym.venues.values():
            if v.status in ("unavailable", "rate_limited"):
                continue
            if v.status == "connecting" and v.updated <= 0:
                continue
            if v.updated > 0 and (now - v.updated) > self.stale_after and v.status == "live":
                v.status = "stale"

    def freshness(self, symbol: str, now: float | None = None) -> list[dict]:
        now = time.time() if now is None else now
        with self.lock:
            sym = self.symbols.get(symbol)
            if sym is None:
                return []
            self._refresh_stale(sym, now)
            rows = []
            for vid in VENUE_ORDER:
                v = sym.venues[vid]
                age = None if v.updated <= 0 else max(0.0, (now - v.updated) * 1000.0)
                rows.append(
                    {
                        "venue": vid,
                        "status": v.status,
                        "age_ms": None if age is None else round(age, 1),
                        "gaps": v.gaps,
                        "reason": v.reason or None,
                    }
                )
            return rows

    def _selected(self, sym: _Symbol, venues: list[str] | None) -> list[str]:
        if not venues or venues == ["all"]:
            return list(VENUE_ORDER)
        allow = set(venues)
        return [vid for vid in VENUE_ORDER if vid in allow]

    def render_heatmap(self, symbol: str, window: str, venues: list[str] | None = None, now: float | None = None) -> dict:
        now_f = time.time() if now is None else now
        now_i = int(now_f)
        if window not in ("1m", "4h", "12h", "24h", "3d"):
            window = "4h"
        with self.lock:
            sym = self.symbols.get(symbol)
            if sym is None:
                return {"symbol": symbol, "window": window, "empty": True, "health": "", "freshness": []}
            self._refresh_stale(sym, now_f)
            start, bucket, ring_name = window_plan(window, now_i)
            ids = self._selected(sym, venues)
            rings = []
            slots = []
            for vid in ids:
                v = sym.venues[vid]
                if v.status == "unavailable":
                    continue
                ring = v.sec if ring_name == "sec" else v.minute
                picked = bucket_last(ring.slice_since(start), ring.ts, bucket)
                if not picked and ring_name == "sec":
                    # Short window before the first second seals: show the live book as one column.
                    continue
                rings.append(ring)
                slots.append(picked)
            grid = scatter(rings, slots, sym.dp) if rings else None
            fresh = []
            for vid in VENUE_ORDER:
                v = sym.venues[vid]
                age = None if v.updated <= 0 else max(0.0, (now_f - v.updated) * 1000.0)
                fresh.append(
                    {
                        "venue": vid,
                        "status": v.status,
                        "age_ms": None if age is None else round(age, 1),
                        "gaps": v.gaps,
                        "reason": v.reason or None,
                    }
                )
            last = sym.last
            bb = sym.best_bid
            ba = sym.best_ask
            dp = sym.dp
            live_bid, live_ask = self._live_items_locked(sym, ids)
        payload = {
            "symbol": symbol,
            "window": window,
            "empty": grid is None,
            "dp": dp,
            "last": last,
            "best_bid": bb,
            "best_ask": ba,
            "health": health_line(fresh),
            "ok": service_ok(fresh),
            "freshness": fresh,
            "venues": ids,
        }
        if grid is None:
            payload.update({"p0": 0.0, "bins": 0, "dt": bucket, "t": [], "last_path": [], "bid_b64": "", "ask_b64": ""})
        else:
            payload.update(
                {
                    "p0": float(grid["p0"]),
                    "bins": int(grid["bins"]),
                    "dt": bucket,
                    "t": [int(x) for x in grid["t"].tolist()],
                    "last_path": [float(x) for x in grid["last"].tolist()],
                    "bid_b64": _b64(grid["bid"]),
                    "ask_b64": _b64(grid["ask"]),
                }
            )
        payload["live_bid"] = live_bid
        payload["live_ask"] = live_ask
        return payload

    def _live_items_locked(self, sym: _Symbol, ids: list[str]) -> tuple[list, list]:
        bid: dict[int, float] = {}
        ask: dict[int, float] = {}
        for vid in ids:
            v = sym.venues[vid]
            if v.status == "unavailable":
                continue
            for i, usd in _items(v.bid_i, v.bid_v, v.bid_n):
                bid[i] = bid.get(i, 0.0) + usd
            for i, usd in _items(v.ask_i, v.ask_v, v.ask_n):
                ask[i] = ask.get(i, 0.0) + usd
        return sorted(bid.items()), sorted(ask.items())

    def render_levels(self, symbol: str, venues: list[str] | None = None, now: float | None = None) -> dict:
        now_f = time.time() if now is None else now
        with self.lock:
            sym = self.symbols.get(symbol)
            if sym is None:
                return {"symbol": symbol, "empty": True, "health": "", "freshness": [], "walls": {"bid": [], "ask": []}}
            self._refresh_stale(sym, now_f)
            ids = self._selected(sym, venues)
            bid_items, ask_items = self._live_items_locked(sym, ids)
            fresh = []
            for vid in VENUE_ORDER:
                v = sym.venues[vid]
                age = None if v.updated <= 0 else max(0.0, (now_f - v.updated) * 1000.0)
                fresh.append(
                    {
                        "venue": vid,
                        "status": v.status,
                        "age_ms": None if age is None else round(age, 1),
                        "gaps": v.gaps,
                        "reason": v.reason or None,
                    }
                )
            price = sym.last or ((sym.best_bid + sym.best_ask) / 2 if sym.best_bid and sym.best_ask else 0.0)
            min_usd = 250_000.0 if symbol == "BTC" else 50_000.0
            bid_peaks = [("bid", i, p, u) for i, p, u in find_peaks(dict(bid_items), sym.dp, min_usd)]
            ask_peaks = [("ask", i, p, u) for i, p, u in find_peaks(dict(ask_items), sym.dp, min_usd)]
            walls = sym.walls.update(bid_peaks + ask_peaks, now_f)
            nearest = nearest_walls(walls, price) if price else {"bid": [], "ask": []}
            oi = sym.oi_usd
            source = sym.oi_source
            if oi <= 0:
                depth = sum(u for _, u in bid_items) + sum(u for _, u in ask_items)
                if depth > 0:
                    oi = depth * 8.0
                    source = "depth_proxy"
            longs, shorts = liquidation_clusters(price, oi, sym.long_frac) if price else ([], [])
            dp = sym.dp
            bb = sym.best_bid
            ba = sym.best_ask
            health = health_line(fresh)
            ok = service_ok(fresh)
        return {
            "symbol": symbol,
            "empty": not bid_items and not ask_items,
            "last": price,
            "best_bid": bb,
            "best_ask": ba,
            "dp": dp,
            "bid": [{"price": (i + 0.5) * dp, "size_usd": u} for i, u in bid_items],
            "ask": [{"price": (i + 0.5) * dp, "size_usd": u} for i, u in ask_items],
            "walls": nearest,
            "walls_all": walls,
            "liquidations": {"longs": longs, "shorts": shorts, "source": source, "oi_usd": oi},
            "health": health,
            "ok": ok,
            "freshness": fresh,
        }

    def render_liquidity(self, symbol: str, now: float | None = None) -> dict:
        levels = self.render_levels(symbol, None, now)
        price = float(levels.get("last") or 0.0)
        dp = float(levels.get("dp") or 1.0)
        bid_items = [(int(row["price"] / dp), row["size_usd"]) for row in levels.get("bid") or []]
        ask_items = [(int(row["price"] / dp), row["size_usd"]) for row in levels.get("ask") or []]
        liq = levels.get("liquidations") or {"longs": [], "shorts": [], "source": "none", "oi_usd": 0}
        magnet = magnet_scores(price, bid_items, ask_items, dp, liq["longs"], liq["shorts"]) if price else {}
        fresh = {row["venue"]: {k: row[k] for k in ("status", "age_ms", "gaps", "reason")} for row in levels.get("freshness") or []}
        return {
            "symbol": symbol,
            "ts": int((now if now is not None else time.time()) * 1000),
            "last": price,
            "best_bid": levels.get("best_bid") or 0.0,
            "best_ask": levels.get("best_ask") or 0.0,
            "walls": {
                "bid": [_public_wall(w) for w in (levels.get("walls") or {}).get("bid") or []],
                "ask": [_public_wall(w) for w in (levels.get("walls") or {}).get("ask") or []],
            },
            "liquidations": {
                "source": liq.get("source"),
                "oi_usd": liq.get("oi_usd") or 0.0,
                "longs": [_public_liq(c) for c in liq.get("longs") or []],
                "shorts": [_public_liq(c) for c in liq.get("shorts") or []],
            },
            "magnet": magnet,
            "freshness": fresh,
            "health": levels.get("health") or "",
            "ok": bool(levels.get("ok")),
        }

    def latest_column(self, symbol: str) -> dict | None:
        """Newest 1-second aggregated column. The browser appends this; it does not refetch."""
        with self.lock:
            sym = self.symbols.get(symbol)
            if sym is None:
                return None
            rings = []
            slots = []
            for vid in VENUE_ORDER:
                ring = sym.venues[vid].sec
                if ring.count == 0 or sym.venues[vid].status == "unavailable":
                    continue
                newest = (ring.head - 1) % ring.n_cols
                rings.append(ring)
                slots.append([newest])
            grid = scatter(rings, slots, sym.dp) if rings else None
            last = sym.last
            bb = sym.best_bid
            ba = sym.best_ask
            dp = sym.dp
        if grid is None:
            return None
        return {
            "symbol": symbol,
            "p0": float(grid["p0"]),
            "dp": dp,
            "bins": int(grid["bins"]),
            "t": int(grid["t"][-1]),
            "last": last,
            "best_bid": bb,
            "best_ask": ba,
            "bid_b64": _b64(grid["bid"]),
            "ask_b64": _b64(grid["ask"]),
        }

    def cached_json(self, key: tuple, builder) -> bytes:
        now = time.monotonic()
        with self.cache_lock:
            hit = self.cache.get(key)
            if hit and now - hit[0] < 1.5:
                return hit[1]
        body = json.dumps(builder(), separators=(",", ":")).encode()
        with self.cache_lock:
            self.cache[key] = (time.monotonic(), body)
        return body

    def prebuild(self, symbols: list[str] | None = None) -> None:
        names = symbols or list(self.symbols)
        for name in names:
            for window in ("1m", "4h", "12h", "24h", "3d"):
                key = ("heatmap", name, window, "all")
                body = json.dumps(self.render_heatmap(name, window, None), separators=(",", ":")).encode()
                with self.cache_lock:
                    self.cache[key] = (time.monotonic(), body)
            for kind, fn in (
                ("levels", lambda n=name: self.render_levels(n, None)),
                ("liquidity", lambda n=name: self.render_liquidity(n)),
            ):
                body = json.dumps(fn(), separators=(",", ":")).encode()
                with self.cache_lock:
                    self.cache[(kind, name, "all")] = (time.monotonic(), body)


def _public_wall(w: dict) -> dict:
    return {
        "price": w["price"],
        "size_usd": w["size_usd"],
        "persistence_s": w["persistence_s"],
        "trend": w["trend"],
    }


def _public_liq(c: dict) -> dict:
    return {
        "price": c["price"],
        "size_usd": c["size_usd"],
        "leverage": c["leverage"],
        "distance_pct": c["distance_pct"],
    }


def seed_demo(
    engine: Engine, symbol: str = "BTC", steps: int = 180, price0: float = 86000.0, step_s: float = 1.0
) -> None:
    """Synthetic books so the page and benchmark run without exchanges."""
    price = price0
    venues = [v for v in VENUE_ORDER if v not in ("coinbase_spot",)]
    start = time.time() - (steps - 1) * step_s
    for i in range(steps):
        price += ((i % 17) - 8) * (price0 * 0.00004)
        now = start + i * step_s
        for n, vid in enumerate(venues):
            shift = (n - 4) * price0 * 0.00001
            bids = []
            asks = []
            for lvl in range(1, 40):
                bp = price - shift - lvl * price0 * 0.00008
                ap = price + shift + lvl * price0 * 0.00008
                bump = 80 if lvl in (8, 21) else 1
                bids.append((bp, bump * (40 - lvl) * 0.02))
                asks.append((ap, bump * (40 - lvl) * 0.015))
            engine.apply_book(vid, symbol, bids, asks, price, bids[0][0], asks[0][0], now)
            engine.apply_health(vid, symbol, "live", gaps=0, now=now)
        if i == 10:
            engine.apply_health("coinbase_spot", symbol, "unavailable", reason="geo_blocked", now=now)
    engine.apply_oi(symbol, oi_usd=price0 * 4000, long_frac=0.48, source="open_interest")
