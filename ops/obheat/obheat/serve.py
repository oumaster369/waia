"""HTTP API и страница тепловой карты. Порт 8790, по умолчанию только localhost."""

from __future__ import annotations

import argparse
import base64
import gzip
import hmac
import json
import os
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from obheat.liquidity import canonical_symbol
from obheat.query import read_points, read_window
from obheat.symbols import ALL, SYMBOLS, VENUES

_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple, dict] = {}
# A heatmap window changes once a second, but rebuilding it from parquet is
# the expensive part. 30s is fresh enough for the page and keeps an idle
# process off the history files.
_FRESH_S = 30.0

WEB = Path(__file__).resolve().parent / "web" / "index.html"
STEPS = {"1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300}
_CACHE_MAX = 4
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
        self.html = WEB.read_bytes()
        self._lock = threading.Lock()
        self._health = _HEALTH_FALLBACK
        self._latest: dict | None = None
        self._liquidity: dict | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        self.refresh()
        threading.Thread(target=self._loop, name="obheat-surface", daemon=True).start()

    def _loop(self) -> None:
        while not self._stop.wait(0.25):
            try:
                self.refresh()
            except Exception:
                continue

    def refresh(self) -> None:
        health = _read_bytes(self.data_dir / "health.json", _HEALTH_FALLBACK)
        latest = _read_json(self.data_dir / "live" / "latest.json", None)
        liquidity = _read_json(self.data_dir / "live" / "liquidity.json", None)
        with self._lock:
            self._health = health
            self._latest = latest
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
        return WEB.read_bytes()

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
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        last = None
        try:
            while True:
                surface = type(self).surface
                payload = surface.latest() if surface is not None else _read_json(self.data_dir / "live" / "latest.json", None)
                stamp = None if payload is None else payload.get("ts")
                if payload is not None and stamp != last:
                    column = ((payload.get("columns") or {}).get(symbol) or {}).get(venue)
                    if column is not None:
                        message = json.dumps({"column": column, "health": payload.get("health")}, ensure_ascii=False)
                        self.wfile.write(f"event: column\ndata: {message}\n\n".encode("utf-8"))
                    liquidity = (((payload.get("liquidity") or {}).get("symbols") or {}).get(symbol) or {}).get(venue)
                    if liquidity is not None:
                        body = json.dumps(liquidity, ensure_ascii=False)
                        self.wfile.write(f"event: liquidity\ndata: {body}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    last = stamp
                time_sleep()
        except (BrokenPipeError, ConnectionResetError):
            return


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
    levels = max(16, min(512, int(_one(query, "levels", "40"))))
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
        return {**{k: window.get(k) for k in ("symbol", "venue", "step", "minutes")}, "format": "compact-v1", "columns": 0, "prices": [], "times": [], "bid": "", "ask": "", "mid": []}
    sampled = _downsample_columns(columns, width)
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
        "bid": base64.b64encode(bytes(bid)).decode("ascii"),
        "ask": base64.b64encode(bytes(ask)).decode("ascii"),
    }


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
        "mid": sum(mids) / len(mids) if mids else honest[-1].get("mid"),
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
        _CACHE[key] = {"at": time.monotonic(), "compact": compact}
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.pop(next(iter(_CACHE)))


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
