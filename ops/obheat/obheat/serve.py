"""HTTP API и страница тепловой карты. Порт 8790, по умолчанию только localhost."""

from __future__ import annotations

import argparse
import base64
import gc
import gzip
import hmac
import json
import os
import socket
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from obheat.limits import (
    MAX_CACHE_AGE_S,
    MAX_CACHE_ENTRIES,
    MAX_CACHE_PER_SYMBOL,
    MAX_LEVELS,
    MAX_SSE_AGE_S,
    MAX_SSE_CLIENTS,
)
from obheat.liquidity import canonical_symbol
from obheat.query import read_points, read_window, release_arrow
from obheat.symbols import ALL, SYMBOLS, VENUES

_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple, dict] = {}
# A heatmap window changes once a second, but rebuilding it from parquet is
# the expensive part. 30s is fresh enough for the page and keeps an idle
# process off the history files. The dict itself is also capped: two windows
# per coin, four overall, and nothing older than a minute.
_FRESH_S = 30.0
_SSE_LOCK = threading.Lock()
_SSE: dict[int, float] = {}
_SSE_SEQ = 0

WEB_DIR = Path(__file__).resolve().parent / "web"
WEB = WEB_DIR / "index.html"
MODEL = WEB_DIR / "chart-model.js"
STEPS = {"1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300}
_HEAVY = threading.BoundedSemaphore(1)
_HEALTH_FALLBACK = b'{"ok":false,"venues":{}}'


class LiveSurface:
    """Bytes for `/` and `/health`, refreshed off the request path.

    Heatmap builds take the GIL while they turn parquet into Python objects.
    The reachability probe on `/` waits 2.5s. These two routes only copy a
    buffer that a private thread already prepared, and they do not take the
    heatmap lock.
    """

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.html = compose_page()
        self._lock = threading.Lock()
        self._health = _HEALTH_FALLBACK
        self._latest: dict | None = None
        self._liquidity: dict | None = None
        self._mtime: dict[Path, tuple | None] = {}
        self._stop = threading.Event()
        self._next_trim = time.monotonic() + 15.0

    def start(self) -> None:
        self.refresh()
        threading.Thread(target=self._loop, name="obheat-surface", daemon=True).start()

    def _loop(self) -> None:
        while not self._stop.wait(0.25):
            try:
                self.refresh()
            except Exception:
                continue
            if time.monotonic() >= self._next_trim:
                self._next_trim = time.monotonic() + 15.0
                trim_rss()

    def _changed(self, path: Path) -> bool:
        try:
            stat = path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            stamp = None
        if self._mtime.get(path) == stamp:
            return False
        self._mtime[path] = stamp
        return True

    def refresh(self) -> None:
        # Re-parse only when the collector has written a new snapshot. Parsing
        # the full book four times a second was a steady allocator with nowhere
        # for the freed pages to go.
        health_path = self.data_dir / "health.json"
        latest_path = self.data_dir / "live" / "latest.json"
        liquidity_path = self.data_dir / "live" / "liquidity.json"
        health = latest = liquidity = None
        if self._changed(health_path):
            health = _read_bytes(health_path, _HEALTH_FALLBACK)
        if self._changed(latest_path):
            latest = _read_json(latest_path, None)
        if self._changed(liquidity_path):
            liquidity = _read_json(liquidity_path, None)
        if health is None and latest is None and liquidity is None:
            return
        with self._lock:
            if health is not None:
                self._health = health
            if latest is not None:
                self._latest = latest
            if liquidity is not None:
                self._liquidity = liquidity

    def health(self) -> bytes:
        with self._lock:
            return self._health

    def latest(self) -> dict | None:
        with self._lock:
            return self._latest

    def liquidity(self) -> dict | None:
        with self._lock:
            return self._liquidity


def _read_bytes(path: Path, default: bytes) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        return default


def public_bind(bind: str) -> bool:
    return bind not in {"127.0.0.1", "localhost", "::1"}


def token_ok(presented: str, expected: str) -> bool:
    if not expected or not presented:
        return False
    return hmac.compare_digest(presented, expected)


class Handler(BaseHTTPRequestHandler):
    data_dir: Path
    bind: str
    token: str
    surface: LiveSurface | None = None

    def log_message(self, fmt: str, *args) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not self._allowed(parsed.query):
            self._json(401, {"error": "token required"})
            return
        path = _route_path(parsed.path)
        query = parse_qs(parsed.query)
        try:
            if path == "/":
                self._raw(200, "text/html; charset=utf-8", self._page_bytes())
            elif path == "/health":
                self._raw(200, "application/json; charset=utf-8", self._health_bytes())
            elif path == "/meta":
                self._json(200, _read_json(self.data_dir / "meta.json", {}))
            elif path == "/book":
                self._json(200, _book(self.data_dir, _symbol(query), _venue(query)))
            elif path == "/heatmap":
                self._json(200, _heatmap(self.data_dir, query))
            elif path == "/levels":
                self._json(200, _levels(self.data_dir, query))
            elif path == "/trades":
                self._json(200, {"trades": _points(self.data_dir, query, "trade")})
            elif path == "/liquidations":
                self._json(200, {"liquidations": _points(self.data_dir, query, "liquidation")})
            elif path == "/api/liquidity":
                self._json(200, _liquidity(self.data_dir, query))
            elif path == "/stream":
                self._stream(_symbol(query), _venue(query))
            else:
                self._json(404, {"error": "not found"})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _allowed(self, query: str) -> bool:
        if not public_bind(self.bind):
            return True
        header = self.headers.get("Authorization", "")
        presented = header[7:].strip() if header.lower().startswith("bearer ") else ""
        if not presented:
            presented = self.headers.get("X-Obheat-Token", "")
        if not presented:
            presented = (parse_qs(query).get("token") or [""])[0]
        return token_ok(presented, self.token)

    def _page_bytes(self) -> bytes:
        surface = type(self).surface
        if surface is not None:
            return surface.html
        return compose_page()

    def _health_bytes(self) -> bytes:
        surface = type(self).surface
        if surface is not None:
            return surface.health()
        return _read_bytes(self.data_dir / "health.json", _HEALTH_FALLBACK)

    def _raw(self, code: int, content_type: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        use_gzip = "gzip" in self.headers.get("Accept-Encoding", "").lower() and len(body) > 1024
        if use_gzip:
            body = gzip.compress(body, compresslevel=5)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream(self, symbol: str, venue: str) -> None:
        # HTTP/1.1 would otherwise keep the handler thread blocked in the next
        # readline after the browser (or the tunnel) drops the stream.
        self.close_connection = True
        token = sse_open()
        try:
            try:
                self.connection.settimeout(5.0)
                self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            except OSError:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            last = None
            last_ping = time.monotonic()
            while sse_alive(token):
                surface = type(self).surface
                payload = surface.latest() if surface is not None else _read_json(self.data_dir / "live" / "latest.json", None)
                stamp = None if payload is None else payload.get("ts")
                if payload is not None and stamp != last:
                    column = ((payload.get("columns") or {}).get(symbol) or {}).get(venue)
                    if column is not None:
                        message = json.dumps(
                            {"symbol": symbol, "venue": venue, "column": column, "health": payload.get("health")},
                            ensure_ascii=False,
                        )
                        self.wfile.write(f"event: column\ndata: {message}\n\n".encode("utf-8"))
                    liquidity = (((payload.get("liquidity") or {}).get("symbols") or {}).get(symbol) or {}).get(venue)
                    if liquidity is not None:
                        body = json.dumps(liquidity, ensure_ascii=False)
                        self.wfile.write(f"event: liquidity\ndata: {body}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    last = stamp
                elif time.monotonic() - last_ping >= 1.0:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    last_ping = time.monotonic()
                time_sleep()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout, OSError):
            return
        finally:
            sse_close(token)
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def time_sleep() -> None:
    import time

    time.sleep(0.25)


def _route_path(path: str) -> str:
    if path in {"", "/"}:
        return "/"
    for route in ("/health", "/meta", "/book", "/heatmap", "/trades", "/liquidations", "/levels", "/stream", "/api/liquidity"):
        if path == route or path.endswith(route):
            return route
    if path.endswith("/"):
        return "/"
    return path


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _one(query: dict, name: str, default: str | None = None) -> str:
    values = query.get(name)
    if not values or values[0] == "":
        if default is None:
            raise ValueError(f"{name} is required")
        return default
    return values[0]


def _symbol(query: dict) -> str:
    symbol = _one(query, "symbol", "BTCUSDT").upper()
    if symbol not in SYMBOLS:
        raise ValueError("symbol must be BTCUSDT or ETHUSDT")
    return symbol


def _venue(query: dict) -> str:
    venue = _one(query, "venue", ALL).upper()
    if venue not in (*VENUES, ALL):
        raise ValueError("unknown venue")
    return venue


def _book(data_dir: Path, symbol: str, venue: str) -> dict:
    surface = Handler.surface
    payload = surface.latest() if surface is not None else _read_json(data_dir / "live" / "latest.json", None)
    if not payload:
        return {"symbol": symbol, "venue": venue, "book_ok": False, "bids": None, "asks": None}
    column = ((payload.get("columns") or {}).get(symbol) or {}).get(venue)
    if column is None:
        return {"symbol": symbol, "venue": venue, "book_ok": False, "bids": None, "asks": None, "ts": payload.get("ts")}
    return column


def _heatmap(data_dir: Path, query: dict) -> dict:
    step = _one(query, "step", "1m")
    if step not in STEPS:
        raise ValueError("step must be 1s, 5s, 15s, 1m or 5m")
    minutes = int(_one(query, "minutes", "1440"))
    as_columns = _one(query, "format", "compact") == "columns"
    symbol = _symbol(query)
    venue = _venue(query)
    if as_columns:
        return _load_window(data_dir, symbol, venue, minutes, step, include_prints=True)
    width = max(64, min(2400, int(_one(query, "width", "1200"))))
    levels = max(16, min(MAX_LEVELS, int(_one(query, "levels", "40"))))
    key = (str(data_dir), symbol, venue, minutes, step, width, levels)
    hit = _cache_get(key)
    if hit is not None and time.monotonic() - hit["at"] < _FRESH_S:
        return hit["compact"]
    # Wait out the current one-file backfill instead of answering with an
    # empty grid. `/` and `/health` do not take this lock.
    if not _HEAVY.acquire(timeout=8):
        if hit is not None:
            return hit["compact"]
        return _empty_compact(symbol, venue, step, minutes)
    try:
        fresh = _cache_get(key)
        if fresh is not None and time.monotonic() - fresh["at"] < _FRESH_S:
            return fresh["compact"]
        window = read_window(data_dir, symbol, venue, minutes, step, include_prints=False)
        compact = _compact_heatmap(window, width, levels)
        del window
        _cache_put(key, compact)
        return compact
    finally:
        _HEAVY.release()
        release_arrow()


def _empty_compact(symbol: str, venue: str, step: str, minutes: int) -> dict:
    return {
        "symbol": symbol,
        "venue": venue,
        "step": step,
        "minutes": minutes,
        "format": "compact-v1",
        "columns": 0,
        "prices": [],
        "times": [],
        "bid": "",
        "ask": "",
        "mid": [],
        "ohlc": [],
        "max_usd": 0,
        "busy": True,
    }


def _levels(data_dir: Path, query: dict) -> dict:
    symbol = _symbol(query)
    venue = _venue(query)
    current = _book(data_dir, symbol, venue)
    # The page polls /levels every 5s. It used to rebuild the whole heatmap
    # window for that. Clusters already live in the liquidity snapshot.
    try:
        snap = _liquidity(data_dir, {"symbol": [symbol], "venue": [venue]})
        clusters = list(snap.get("liquidation_clusters") or [])
        estimate_status = "ok" if clusters or snap.get("book_ok") else "partial: no snapshot"
    except Exception as exc:  # noqa: BLE001 - levels must be partial, never 500
        clusters = []
        estimate_status = f"partial: {exc}"
    walls = _walls(current)
    mid = current.get("mid")
    return {
        "symbol": symbol,
        "venue": venue,
        "ts": current.get("ts"),
        "mid": mid,
        "measured": {
            "walls": walls[:30],
            "depth": _depth(current),
            "imbalance": _imbalance(current),
            "status": "measured from current order books",
        },
        "estimated": {
            "notice": "Модельная оценка, не биржевой факт: распределение недавнего объема по плечам 5/10/25/50/100x.",
            "status": estimate_status,
            "liquidation_clusters": clusters,
        },
    }


def _compact_heatmap(window: dict, width: int, max_levels: int = 40) -> dict:
    columns = window.get("columns") or []
    if not columns:
        return {**{k: window.get(k) for k in ("symbol", "venue", "step", "minutes")}, "format": "compact-v1", "columns": 0, "prices": [], "times": [], "bid": "", "ask": "", "mid": [], "ohlc": [], "max_usd": 0}
    sampled = [_ensure_ohlc(col) for col in _downsample_columns(columns, width)]
    prices = sorted({row[0] for col in sampled if col.get("book_ok") for rows in (col.get("bids") or [], col.get("asks") or []) for row in rows})
    if len(prices) > max_levels:
        stride = (len(prices) + max_levels - 1) // max_levels
        prices = prices[::stride]
    index = {price: i for i, price in enumerate(prices)}
    cells = len(sampled) * max(1, len(prices))
    bid = bytearray(cells * 2)
    ask = bytearray(cells * 2)
    max_usd = max((row[2] for col in sampled for rows in (col.get("bids") or [], col.get("asks") or []) for row in rows), default=1.0)
    denom = max(1.0, _log(max_usd))
    for x, col in enumerate(sampled):
        for buf, rows in ((bid, col.get("bids") or []), (ask, col.get("asks") or [])):
            for price, _coin, usd in rows:
                y = index.get(price)
                if y is None:
                    continue
                value = int(max(0, min(65535, (_log(usd) / denom) * 65535)))
                struct.pack_into("<H", buf, (x * len(prices) + y) * 2, value)
    return {
        "symbol": window.get("symbol"),
        "venue": window.get("venue"),
        "step": window.get("step"),
        "minutes": window.get("minutes"),
        "format": "compact-v1",
        "columns": len(sampled),
        "levels": len(prices),
        "times": [col.get("ts") for col in sampled],
        "prices": prices,
        "mid": [col.get("mid") for col in sampled],
        "book_ok": [bool(col.get("book_ok")) for col in sampled],
        "ohlc": [col.get("ohlc") for col in sampled],
        "max_usd": max_usd,
        "bid": base64.b64encode(bytes(bid)).decode("ascii"),
        "ask": base64.b64encode(bytes(ask)).decode("ascii"),
    }


def compose_page() -> bytes:
    """Inline the chart model so `/` stays one buffer and needs no second request.

    A public bind requires the bearer token on every route. A separate script
    URL would 401. The bytes are built once, when the surface starts.
    """
    html = WEB.read_text(encoding="utf-8")
    script = MODEL.read_text(encoding="utf-8")
    slot = "/*__CHART_MODEL__*/"
    if slot not in html:
        raise RuntimeError("index.html is missing the chart model slot")
    return html.replace(slot, script, 1).encode("utf-8")


def _ohlc_from(cols: list[dict]) -> list[float] | None:
    opens: list[float] = []
    highs: list[float] = []
    lows: list[float] = []
    closes: list[float] = []
    for col in cols:
        ohlc = col.get("ohlc")
        if isinstance(ohlc, (list, tuple)) and len(ohlc) == 4:
            opens.append(float(ohlc[0]))
            highs.append(float(ohlc[1]))
            lows.append(float(ohlc[2]))
            closes.append(float(ohlc[3]))
        elif col.get("mid"):
            mid = float(col["mid"])
            opens.append(mid)
            highs.append(mid)
            lows.append(mid)
            closes.append(mid)
    if not closes:
        return None
    return [opens[0], max(highs), min(lows), closes[-1]]


def _ensure_ohlc(col: dict) -> dict:
    if col.get("ohlc"):
        return col
    ohlc = _ohlc_from([col])
    if ohlc is None:
        return col
    return {**col, "ohlc": ohlc}


def _downsample_columns(columns: list[dict], width: int) -> list[dict]:
    if len(columns) <= width:
        return columns
    out = []
    for i in range(width):
        start = i * len(columns) // width
        end = max(start + 1, (i + 1) * len(columns) // width)
        out.append(_merge_compact_bin(columns[start:end]))
    return out


def _merge_compact_bin(cols: list[dict]) -> dict:
    honest = [col for col in cols if col.get("book_ok")]
    if not honest:
        col = cols[-1]
        return {**col, "book_ok": False, "bids": None, "asks": None, "mid": None}
    bids: dict[float, float] = {}
    asks: dict[float, float] = {}
    mids = []
    for col in honest:
        if col.get("mid"):
            mids.append(col["mid"])
        for price, _coin, usd in col.get("bids") or []:
            bids[price] = max(bids.get(price, 0.0), usd)
        for price, _coin, usd in col.get("asks") or []:
            asks[price] = max(asks.get(price, 0.0), usd)
    return {
        **honest[-1],
        "book_ok": True,
        "mid": mids[-1] if mids else honest[-1].get("mid"),
        "ohlc": _ohlc_from(honest),
        "bids": [[price, 0.0, usd] for price, usd in bids.items()],
        "asks": [[price, 0.0, usd] for price, usd in asks.items()],
    }


def _log(value: float) -> float:
    import math

    return math.log10(1 + max(0.0, value or 0.0))


def _walls(column: dict) -> list[dict]:
    walls = []
    for side, rows in (("bid", column.get("bids") or []), ("ask", column.get("asks") or [])):
        for price, coin, usd in rows:
            walls.append({"side": side, "price": price, "coin": coin, "usd": usd})
    walls.sort(key=lambda item: item["usd"], reverse=True)
    return walls


def _depth(column: dict) -> dict:
    mid = column.get("mid")
    if not mid:
        return {key: None for key in ("1pct", "2pct", "5pct")}
    out = {}
    for pct in (0.01, 0.02, 0.05):
        bids = sum(row[2] for row in column.get("bids") or [] if row[0] >= mid * (1 - pct))
        asks = sum(row[2] for row in column.get("asks") or [] if row[0] <= mid * (1 + pct))
        out[f"{int(pct * 100)}pct"] = {"bid_usd": bids, "ask_usd": asks, "total_usd": bids + asks}
    return out


def _imbalance(column: dict) -> float | None:
    depth = _depth(column).get("2pct")
    if not depth:
        return None
    total = depth["bid_usd"] + depth["ask_usd"]
    if total <= 0:
        return None
    return (depth["bid_usd"] - depth["ask_usd"]) / total


def _estimated_liquidations(columns: list[dict]) -> list[dict]:
    buckets: dict[tuple[str, float], float] = {}
    tiers = (5, 10, 25, 50, 100)
    mm = 0.004
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
    return rows[:40]


def _load_window(data_dir: Path, symbol: str, venue: str, minutes: int, step: str, include_prints: bool) -> dict:
    """On-demand column window. One heavy read at a time, nothing retained."""
    if not _HEAVY.acquire(timeout=2):
        return {"symbol": symbol, "venue": venue, "step": step, "minutes": minutes, "columns": [], "busy": True}
    try:
        return read_window(data_dir, symbol, venue, minutes, step, include_prints=include_prints)
    finally:
        _HEAVY.release()


def _cache_get(key: tuple) -> dict | None:
    with _CACHE_LOCK:
        return _CACHE.get(key)


def _cache_put(key: tuple, compact: dict) -> None:
    with _CACHE_LOCK:
        now = time.monotonic()
        expired = [item for item, hit in _CACHE.items() if now - hit["at"] > MAX_CACHE_AGE_S]
        for item in expired:
            _CACHE.pop(item, None)
        _CACHE[key] = {"at": now, "compact": compact}
        symbol = key[1] if len(key) > 1 else None
        same = [item for item in _CACHE if item[1] == symbol and item != key]
        while len(same) + 1 > MAX_CACHE_PER_SYMBOL:
            oldest = min(same, key=lambda item: _CACHE[item]["at"])
            _CACHE.pop(oldest, None)
            same.remove(oldest)
        while len(_CACHE) > MAX_CACHE_ENTRIES:
            victim = min((item for item in _CACHE if item != key), key=lambda item: _CACHE[item]["at"], default=None)
            if victim is None:
                break
            _CACHE.pop(victim, None)


def sse_count() -> int:
    with _SSE_LOCK:
        return len(_SSE)


def sse_open() -> int:
    """Register a stream. Past the cap, the oldest client is told to exit."""
    global _SSE_SEQ
    with _SSE_LOCK:
        now = time.monotonic()
        for token, started in list(_SSE.items()):
            if now - started > MAX_SSE_AGE_S:
                _SSE.pop(token, None)
        while len(_SSE) >= MAX_SSE_CLIENTS:
            oldest = min(_SSE, key=lambda token: _SSE[token])
            _SSE.pop(oldest, None)
        _SSE_SEQ += 1
        _SSE[_SSE_SEQ] = now
        return _SSE_SEQ


def sse_alive(token: int) -> bool:
    with _SSE_LOCK:
        started = _SSE.get(token)
        if started is None:
            return False
        if time.monotonic() - started > MAX_SSE_AGE_S:
            _SSE.pop(token, None)
            return False
        return True


def sse_close(token: int) -> None:
    with _SSE_LOCK:
        _SSE.pop(token, None)


def trim_rss() -> None:
    """Give freed heap and Arrow buffers back to the OS so RSS can plateau."""
    gc.collect()
    release_arrow()
    try:
        import ctypes

        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        return


def _liquidity(data_dir: Path, query: dict) -> dict:
    symbol = canonical_symbol(_one(query, "symbol", "BTCUSDT"))
    venue = _one(query, "venue", ALL).upper()
    if venue not in (*VENUES, ALL):
        raise ValueError("unknown venue")
    surface = Handler.surface
    payload = surface.liquidity() if surface is not None else _read_json(data_dir / "live" / "liquidity.json", None)
    if not payload:
        return {
            "symbol": symbol,
            "venue": venue,
            "book_ok": False,
            "last": None,
            "walls": [],
            "liquidation_clusters": [],
            "magnet": {},
            "freshness": {},
        }
    snap = ((payload.get("symbols") or {}).get(symbol) or {}).get(venue)
    if snap is None:
        return {"symbol": symbol, "venue": venue, "ts": payload.get("ts"), "book_ok": False, "freshness": {}}
    return snap


def _backfill_loop(data_dir: Path) -> None:
    """One legacy hour file at a time, and never while a heatmap read runs."""
    from obheat.query import backfill_one

    while True:
        if not _HEAVY.acquire(blocking=False):
            time.sleep(1.0)
            continue
        try:
            wrote = backfill_one(data_dir)
        except Exception:
            wrote = False
        finally:
            _HEAVY.release()
        time.sleep(0.5 if wrote else 30.0)


def _points(data_dir: Path, query: dict, kind: str) -> list:
    minutes = int(_one(query, "minutes", "15"))
    return read_points(data_dir, _symbol(query), _venue(query), minutes, kind)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="OB-HEATMAP API and page")
    parser.add_argument("--data-dir", default=os.environ.get("OBHEAT_DATA", "/srv/obheat"))
    parser.add_argument("--bind", default=os.environ.get("OBHEAT_BIND", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OBHEAT_PORT", "8790")))
    args = parser.parse_args(argv)
    token = os.environ.get("OBHEAT_TOKEN", "")
    if public_bind(args.bind) and not token:
        raise SystemExit("OBHEAT_TOKEN is required when OBHEAT_BIND is not localhost")
    Handler.data_dir = Path(args.data_dir)
    Handler.bind = args.bind
    Handler.token = token
    Handler.surface = LiveSurface(Handler.data_dir)
    Handler.surface.start()
    threading.Thread(target=_backfill_loop, args=(Handler.data_dir,), name="obheat-minute-backfill", daemon=True).start()
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.daemon_threads = True
    print(f"obheat serve http://{args.bind}:{args.port}/ data={args.data_dir}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
