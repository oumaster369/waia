"""Pure heatmap math: sequence sync, sparse columns, walls, liquidations, magnet."""

from __future__ import annotations

import math
from collections import deque

import numpy as np

LEVERAGES = (5, 10, 25, 50, 100)
LEVERAGE_WEIGHTS = (0.08, 0.22, 0.35, 0.25, 0.10)
MAINT_MARGIN = 0.004
MAGNET_BANDS = (0.5, 1.0, 2.0, 3.0)
SPARSE_K = 64

WINDOWS = {
    "1m": 60,
    "4h": 4 * 3600,
    "12h": 12 * 3600,
    "24h": 24 * 3600,
    "3d": 3 * 86400,
}
MAX_COLS = 240


def nice_step(raw: float) -> float:
    if raw <= 0 or not math.isfinite(raw):
        return 1.0
    exp = math.floor(math.log10(raw))
    base = 10.0**exp
    for mult in (1.0, 2.0, 5.0, 10.0):
        if mult * base >= raw * 0.99:
            return float(mult * base)
    return float(10.0 * base)


def choose_dp(price: float) -> float:
    """Fine dollar bin. Index price/dp must fit in int16 for BTC-scale prices."""
    target = max(price * 0.00008, price / 20000.0)
    dp = nice_step(target)
    if price / dp > 30000:
        dp = nice_step(price / 20000.0)
    return dp


def pack_levels(levels: list[tuple[float, float]], dp: float, k: int = SPARSE_K) -> tuple[np.ndarray, np.ndarray, int]:
    """Aggregate (price, base size) into the top-k dollar bins."""
    acc: dict[int, float] = {}
    for price, size in levels:
        if price <= 0 or size <= 0 or not math.isfinite(price) or not math.isfinite(size):
            continue
        idx = int(price / dp)
        if idx < 0 or idx > 32767:
            continue
        acc[idx] = acc.get(idx, 0.0) + price * size
    if len(acc) > k:
        items = sorted(acc.items(), key=lambda kv: kv[1], reverse=True)[:k]
    else:
        items = list(acc.items())
    out_i = np.zeros(k, dtype=np.int16)
    out_v = np.zeros(k, dtype=np.float32)
    for n, (i, v) in enumerate(items):
        out_i[n] = i
        out_v[n] = v
    return out_i, out_v, len(items)


class StreamBook:
    """Local L2 book with explicit gap -> resync, per exchange sequence rules."""

    def __init__(self, kind: str):
        self.kind = kind
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}
        self.last_u: int | None = None
        self.synced = False
        self.primed = False
        self.gaps = 0

    def clear(self) -> None:
        self.bids.clear()
        self.asks.clear()
        self.last_u = None
        self.synced = False
        self.primed = False

    def _apply(self, bids, asks) -> None:
        for price, size in bids:
            p = float(price)
            s = float(size)
            if s <= 0:
                self.bids.pop(p, None)
            else:
                self.bids[p] = s
        for price, size in asks:
            p = float(price)
            s = float(size)
            if s <= 0:
                self.asks.pop(p, None)
            else:
                self.asks[p] = s

    def _gap(self) -> str:
        self.gaps += 1
        self.synced = False
        self.primed = False
        self.bids.clear()
        self.asks.clear()
        return "resync"

    def snapshot(self, last_id: int, bids, asks) -> None:
        self.bids.clear()
        self.asks.clear()
        self._apply(bids, asks)
        self.last_u = int(last_id)
        self.synced = True
        self.primed = False

    def replace(self, bids, asks) -> None:
        """Full book image (no sequence). Used by snapshot-only feeds."""
        self.bids.clear()
        self.asks.clear()
        self._apply(bids, asks)
        self.synced = True
        self.primed = True

    def diff_binance(self, first_id: int, final_id: int, prev_id: int | None, bids, asks) -> str:
        if not self.synced or self.last_u is None:
            return "unsynced"
        first_id = int(first_id)
        final_id = int(final_id)
        if self.kind == "binance_futures":
            if not self.primed:
                if final_id < self.last_u:
                    return "drop"
                if first_id > self.last_u:
                    return self._gap()
                self.primed = True
            elif prev_id is None or int(prev_id) != self.last_u:
                return self._gap()
        elif self.kind == "binance_spot":
            if not self.primed:
                if final_id <= self.last_u:
                    return "drop"
                if first_id > self.last_u + 1:
                    return self._gap()
                self.primed = True
            elif first_id != self.last_u + 1:
                return self._gap()
        else:
            raise ValueError(self.kind)
        self._apply(bids, asks)
        self.last_u = final_id
        return "ok"

    def diff_increment(self, new_id: int, bids, asks) -> str:
        """Bybit linear/spot: the next update id is exactly previous + 1."""
        if not self.synced or self.last_u is None:
            return "unsynced"
        new_id = int(new_id)
        if new_id <= self.last_u:
            return "drop"
        if new_id != self.last_u + 1:
            return self._gap()
        self._apply(bids, asks)
        self.last_u = new_id
        self.primed = True
        return "ok"

    def diff_range(self, first_id: int, final_id: int, bids, asks) -> str:
        """Gate-style batch: first id must touch the previous final id."""
        if not self.synced or self.last_u is None:
            return "unsynced"
        first_id = int(first_id)
        final_id = int(final_id)
        if final_id <= self.last_u:
            return "drop"
        if first_id > self.last_u + 1:
            return self._gap()
        self._apply(bids, asks)
        self.last_u = final_id
        self.primed = True
        return "ok"

    def diff_okx(self, seq: int, prev: int, bids, asks, action: str) -> str:
        if action == "snapshot":
            self.bids.clear()
            self.asks.clear()
            self._apply(bids, asks)
            self.last_u = int(seq)
            self.synced = True
            self.primed = True
            return "ok"
        if not self.synced or self.last_u is None or int(prev) != self.last_u:
            return self._gap()
        self._apply(bids, asks)
        self.last_u = int(seq)
        return "ok"

    def top(self, n: int = 400) -> tuple[list[tuple[float, float]], list[tuple[float, float]], float, float]:
        bids = sorted(self.bids.items(), key=lambda kv: kv[0], reverse=True)[:n]
        asks = sorted(self.asks.items(), key=lambda kv: kv[0])[:n]
        bb = bids[0][0] if bids else 0.0
        ba = asks[0][0] if asks else 0.0
        return bids, asks, bb, ba


class SparseRing:
    """Fixed columns of top-k bins. Append never rewrites older columns."""

    def __init__(self, n_cols: int, k: int = SPARSE_K):
        self.k = k
        self.n_cols = n_cols
        self.bid_i = np.zeros((n_cols, k), dtype=np.int16)
        self.bid_v = np.zeros((n_cols, k), dtype=np.float32)
        self.bid_n = np.zeros(n_cols, dtype=np.uint16)
        self.ask_i = np.zeros((n_cols, k), dtype=np.int16)
        self.ask_v = np.zeros((n_cols, k), dtype=np.float32)
        self.ask_n = np.zeros(n_cols, dtype=np.uint16)
        self.ts = np.zeros(n_cols, dtype=np.int64)
        self.last = np.zeros(n_cols, dtype=np.float64)
        self.head = 0
        self.count = 0

    def append(
        self,
        t: int,
        bid_i: np.ndarray,
        bid_v: np.ndarray,
        bid_n: int,
        ask_i: np.ndarray,
        ask_v: np.ndarray,
        ask_n: int,
        last: float,
    ) -> None:
        i = self.head
        self.bid_i[i] = bid_i
        self.bid_v[i] = bid_v
        self.bid_n[i] = bid_n
        self.ask_i[i] = ask_i
        self.ask_v[i] = ask_v
        self.ask_n[i] = ask_n
        self.ts[i] = t
        self.last[i] = last
        self.head = (i + 1) % self.n_cols
        self.count = min(self.n_cols, self.count + 1)

    def column_unchanged(self, index_from_oldest: int) -> tuple:
        """Snapshot of one stored column for regression tests."""
        pos = self._pos(index_from_oldest)
        return (
            self.ts[pos],
            bytes(self.bid_v[pos].tobytes()),
            bytes(self.ask_v[pos].tobytes()),
            int(self.bid_n[pos]),
        )

    def _pos(self, index_from_oldest: int) -> int:
        if self.count < self.n_cols:
            return index_from_oldest
        return (self.head + index_from_oldest) % self.n_cols

    def slice_since(self, start_t: int) -> list[int]:
        """Chronological slot indexes with ts >= start_t."""
        if self.count == 0:
            return []
        if self.count < self.n_cols:
            order = list(range(self.count))
        else:
            order = list(range(self.head, self.n_cols)) + list(range(0, self.head))
        return [i for i in order if int(self.ts[i]) >= start_t]


def bucket_last(slots: list[int], ts: np.ndarray, bucket: int) -> list[int]:
    """Keep the last slot in each time bucket. `slots` is chronological."""
    if not slots:
        return []
    if bucket <= 1:
        if len(slots) <= MAX_COLS:
            return slots
        return slots[-MAX_COLS:]
    chosen: list[int] = []
    current_b = None
    origin = int(ts[slots[0]])
    for slot in slots:
        b = (int(ts[slot]) - origin) // bucket
        if current_b is None or b != current_b:
            chosen.append(slot)
            current_b = b
        else:
            chosen[-1] = slot
    if len(chosen) > MAX_COLS:
        return chosen[-MAX_COLS:]
    return chosen


def window_plan(window: str, now: int) -> tuple[int, int, str]:
    """Return (start_t, bucket_seconds, ring_name)."""
    span = WINDOWS[window]
    start = now - span
    if span <= 15 * 60:
        bucket = max(1, math.ceil(span / MAX_COLS))
        return start, bucket, "sec"
    bucket = max(60, math.ceil(span / MAX_COLS))
    return start, bucket, "min"


def scatter(rings: list[SparseRing], slots_per_ring: list[list[int]], dp: float) -> dict | None:
    """Sum selected venue columns into a dense, tightly cropped grid."""
    cols = 0
    for slots in slots_per_ring:
        cols = max(cols, len(slots))
    if cols == 0:
        return None
    lo = 10**9
    hi = -1
    for ring, slots in zip(rings, slots_per_ring):
        for slot in slots:
            nb = int(ring.bid_n[slot])
            na = int(ring.ask_n[slot])
            if nb:
                lo = min(lo, int(ring.bid_i[slot, :nb].min()))
                hi = max(hi, int(ring.bid_i[slot, :nb].max()))
            if na:
                lo = min(lo, int(ring.ask_i[slot, :na].min()))
                hi = max(hi, int(ring.ask_i[slot, :na].max()))
    if hi < lo:
        return None
    if hi - lo > 500:
        # Crop around the last-price path so the payload stays small.
        lasts = []
        for ring, slots in zip(rings, slots_per_ring):
            if slots:
                lasts.append(float(ring.last[slots[-1]]))
        if lasts:
            mid = int((sum(lasts) / len(lasts)) / dp)
            lo = max(lo, mid - 250)
            hi = min(hi, mid + 250)
    width = hi - lo + 1
    bid = np.zeros((cols, width), dtype=np.float32)
    ask = np.zeros((cols, width), dtype=np.float32)
    t = np.zeros(cols, dtype=np.int64)
    last = np.zeros(cols, dtype=np.float64)
    # Align each venue to the right (newest column).
    for ring, slots in zip(rings, slots_per_ring):
        if not slots:
            continue
        offset = cols - len(slots)
        for j, slot in enumerate(slots):
            col = offset + j
            t[col] = max(int(t[col]), int(ring.ts[slot]))
            if ring.last[slot] > 0:
                last[col] = float(ring.last[slot])
            nb = int(ring.bid_n[slot])
            for k in range(nb):
                x = int(ring.bid_i[slot, k]) - lo
                if 0 <= x < width:
                    bid[col, x] += float(ring.bid_v[slot, k])
            na = int(ring.ask_n[slot])
            for k in range(na):
                x = int(ring.ask_i[slot, k]) - lo
                if 0 <= x < width:
                    ask[col, x] += float(ring.ask_v[slot, k])
    return {
        "p0": lo * dp,
        "dp": dp,
        "bins": width,
        "bid": bid,
        "ask": ask,
        "t": t,
        "last": last,
    }


def sum_band(items: list[tuple[int, float]], dp: float, lo: float, hi: float, side: str) -> float:
    total = 0.0
    for idx, usd in items:
        price = (idx + 0.5) * dp
        if side == "down" and lo <= price < hi:
            total += usd
        elif side == "up" and lo < price <= hi:
            total += usd
    return total


class WallTracker:
    def __init__(self):
        self.walls: dict[tuple[str, int], dict] = {}

    def update(self, peaks: list[tuple[str, int, float, float]], now: float) -> list[dict]:
        seen = set()
        out = []
        for side, idx, price, usd in peaks:
            key = (side, idx)
            seen.add(key)
            st = self.walls.get(key)
            if st is None:
                st = {"first_seen": now, "samples": deque(maxlen=30), "last": now}
                self.walls[key] = st
            st["samples"].append((now, usd))
            st["last"] = now
            persistence = max(0.0, now - st["first_seen"])
            trend = _trend(st["samples"], persistence)
            out.append(
                {
                    "side": side,
                    "price": price,
                    "size_usd": usd,
                    "persistence_s": round(persistence, 1),
                    "trend": trend,
                    "bin": idx,
                }
            )
        for key in list(self.walls):
            if key not in seen and now - self.walls[key]["last"] > 3:
                del self.walls[key]
        return out


def _trend(samples: deque, persistence: float) -> str:
    if persistence < 2 or len(samples) < 2:
        return "new"
    old = samples[0][1]
    new = samples[-1][1]
    if old <= 0:
        return "new"
    if new > old * 1.15:
        return "growing"
    if new < old * 0.85:
        return "pulled"
    return "stable"


def find_peaks(acc: dict[int, float], dp: float, min_usd: float, ratio: float = 4.0) -> list[tuple[int, float, float]]:
    if not acc:
        return []
    values = np.fromiter(acc.values(), dtype=np.float64)
    positive = values[values > 0]
    if positive.size == 0:
        return []
    thresh = max(min_usd, float(np.median(positive)) * ratio)
    peaks = []
    for idx, usd in acc.items():
        if usd < thresh:
            continue
        left = acc.get(idx - 1, 0.0)
        right = acc.get(idx + 1, 0.0)
        if usd >= left and usd >= right:
            peaks.append((idx, (idx + 0.5) * dp, float(usd)))
    peaks.sort(key=lambda row: row[2], reverse=True)
    return peaks[:12]


def nearest_walls(walls: list[dict], last: float, n: int = 3) -> dict:
    bids = [w for w in walls if w["side"] == "bid" and w["price"] < last]
    asks = [w for w in walls if w["side"] == "ask" and w["price"] > last]
    bids.sort(key=lambda w: last - w["price"])
    asks.sort(key=lambda w: w["price"] - last)
    return {"bid": bids[:n], "ask": asks[:n]}


def liquidation_clusters(price: float, oi_usd: float, long_frac: float) -> tuple[list[dict], list[dict]]:
    if price <= 0 or oi_usd <= 0:
        return [], []
    long_frac = min(1.0, max(0.0, long_frac))
    long_oi = oi_usd * long_frac
    short_oi = oi_usd * (1.0 - long_frac)
    longs = []
    shorts = []
    for lev, weight in zip(LEVERAGES, LEVERAGE_WEIGHTS):
        down = price * (1.0 - 1.0 / lev + MAINT_MARGIN)
        up = price * (1.0 + 1.0 / lev - MAINT_MARGIN)
        longs.append(
            {
                "price": down,
                "size_usd": long_oi * weight,
                "leverage": lev,
                "distance_pct": (down - price) / price * 100.0,
                "side": "long",
            }
        )
        shorts.append(
            {
                "price": up,
                "size_usd": short_oi * weight,
                "leverage": lev,
                "distance_pct": (up - price) / price * 100.0,
                "side": "short",
            }
        )
    return longs, shorts


def magnet_scores(
    price: float,
    bid_items: list[tuple[int, float]],
    ask_items: list[tuple[int, float]],
    dp: float,
    longs: list[dict],
    shorts: list[dict],
) -> dict:
    out = {}
    for pct in MAGNET_BANDS:
        lo = price * (1.0 - pct / 100.0)
        hi = price * (1.0 + pct / 100.0)
        down = sum_band(bid_items, dp, lo, price, "down")
        up = sum_band(ask_items, dp, price, hi, "up")
        down += sum(c["size_usd"] for c in longs if lo <= c["price"] < price)
        up += sum(c["size_usd"] for c in shorts if price < c["price"] <= hi)
        total = up + down
        if up > down * 1.05:
            bias = "up"
        elif down > up * 1.05:
            bias = "down"
        else:
            bias = "neutral"
        out[f"{pct:g}"] = {
            "up_usd": up,
            "down_usd": down,
            "score_up": (up / total) if total else 0.5,
            "score_down": (down / total) if total else 0.5,
            "bias": bias,
        }
    return out
