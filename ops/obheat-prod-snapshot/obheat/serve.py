"""HTTP API и страница тепловой карты. Порт 8790, по умолчанию только localhost."""

from __future__ import annotations

import argparse
import base64
import gzip
import hmac
import json
import os
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from obheat.query import read_points, read_window
from obheat.symbols import ALL, SYMBOLS, VENUES

WEB = Path(__file__).resolve().parent / "web" / "index.html"
STEPS = {"1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300}


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
                self._html()
            elif path == "/health":
                self._json(200, _read_json(self.data_dir / "health.json", {"ok": False, "venues": {}}))
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

    def _html(self) -> None:
        body = WEB.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
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
        path = self.data_dir / "live" / "latest.json"
        try:
            while True:
                payload = _read_json(path, None)
                stamp = None if payload is None else payload.get("ts")
                if payload is not None and stamp != last:
                    column = ((payload.get("columns") or {}).get(symbol) or {}).get(venue)
                    if column is not None:
                        message = json.dumps({"column": column, "health": payload.get("health")}, ensure_ascii=False)
                        self.wfile.write(f"event: column\ndata: {message}\n\n".encode("utf-8"))
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
    for route in ("/health", "/meta", "/book", "/heatmap", "/trades", "/liquidations", "/levels", "/stream"):
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
    payload = _read_json(data_dir / "live" / "latest.json", None)
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
    window = read_window(data_dir, _symbol(query), _venue(query), minutes, step)
    if _one(query, "format", "compact") == "columns":
        return window
    width = int(_one(query, "width", "1200"))
    levels = int(_one(query, "levels", "40"))
    return _compact_heatmap(window, max(64, min(2400, width)), max(16, min(512, levels)))


def _levels(data_dir: Path, query: dict) -> dict:
    symbol = _symbol(query)
    venue = _venue(query)
    current = _book(data_dir, symbol, venue)
    try:
        window = read_window(data_dir, symbol, venue, int(_one(query, "minutes", "60")), "1m")
        clusters = _estimated_liquidations(window.get("columns") or [])
        estimate_status = "ok"
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
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    print(f"obheat serve http://{args.bind}:{args.port}/ data={args.data_dir}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
