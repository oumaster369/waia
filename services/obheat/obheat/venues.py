"""Public L2 adapters. Gaps resync; geo blocks become unavailable and back off."""

from __future__ import annotations

import gzip
import json
import socket
import threading
import time
import urllib.error
import urllib.request

from obheat.health import GeoBlocked, RateLimited, classify_handshake, classify_http
from obheat.model import StreamBook

UA = "obheat/2.0"


def inst_ids(symbol: str) -> dict[str, str]:
    s = symbol.upper()
    return {
        "binance": f"{s}USDT",
        "okx_swap": f"{s}-USDT-SWAP",
        "okx_spot": f"{s}-USDT",
        "htx": f"{s}-USDT",
        "gate": f"{s}_USDT",
        "coinbase": f"{s}-USD",
    }


def http_json(url: str, timeout: float = 8.0):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:800]
        kind = classify_http(exc.code, body)
        if kind == "unavailable":
            raise GeoBlocked(body or str(exc.code))
        if kind == "rate_limited":
            raise RateLimited(body or "429")
        raise


def _ws_connect(url: str):
    import websocket

    try:
        return websocket.create_connection(url, timeout=20, header=[f"User-Agent: {UA}"])
    except websocket.WebSocketBadStatusException as exc:
        status = int(getattr(exc, "status_code", 0) or 0)
        kind = classify_handshake(status)
        if kind == "unavailable":
            raise GeoBlocked(str(exc))
        if kind == "rate_limited":
            raise RateLimited(str(exc))
        raise
    except Exception as exc:
        text = str(exc).lower()
        if "403" in text or "451" in text or "restricted" in text:
            raise GeoBlocked(str(exc))
        raise


def _recv(ws, timeout: float = 5.0):
    import websocket

    ws.settimeout(timeout)
    try:
        return ws.recv()
    except websocket.WebSocketTimeoutException:
        return None
    except socket.timeout:
        return None


def _levels_from_pairs(rows) -> list[tuple[float, float]]:
    out = []
    for row in rows or []:
        if isinstance(row, dict):
            price = row.get("p") or row.get("price")
            size = row.get("s") or row.get("size") or row.get("amount")
        else:
            price, size = row[0], row[1]
        out.append((float(price), float(size)))
    return out


class Publisher:
    """Latest book per (venue, symbol), drained once a second by the collector."""

    def __init__(self):
        self._lock = threading.Lock()
        self._books: dict[tuple[str, str], dict] = {}
        self._health: dict[tuple[str, str], dict] = {}

    def book(self, msg: dict) -> None:
        with self._lock:
            self._books[(msg["venue"], msg["symbol"])] = msg

    def health(self, msg: dict) -> None:
        with self._lock:
            self._health[(msg["venue"], msg.get("symbol") or "*")] = msg

    def drain(self) -> list[dict]:
        with self._lock:
            rows = list(self._health.values()) + list(self._books.values())
            self._books.clear()
            self._health.clear()
            return rows


def _publish_book(pub: Publisher, venue: str, symbol: str, book: StreamBook, last: float, mult: float) -> None:
    if not book.synced:
        return
    bids, asks, bb, ba = book.top(400)
    if mult != 1.0:
        bids = [(p, s * mult) for p, s in bids]
        asks = [(p, s * mult) for p, s in asks]
    pub.book(
        {
            "type": "book",
            "venue": venue,
            "symbol": symbol,
            "bids": bids,
            "asks": asks,
            "last": last,
            "best_bid": bb,
            "best_ask": ba,
            "gaps": book.gaps,
        }
    )


def _health(pub: Publisher, venue: str, symbol: str, status: str, gaps: int = 0, reason: str = "") -> None:
    pub.health(
        {"type": "health", "venue": venue, "symbol": symbol, "status": status, "gaps": gaps, "reason": reason}
    )


def run_binance(pub: Publisher, symbols: list[str], stop: threading.Event, kind: str) -> None:
    """kind is perp or spot."""
    venue = "binance_perp" if kind == "perp" else "binance_spot"
    books = {s: StreamBook("binance_futures" if kind == "perp" else "binance_spot") for s in symbols}
    last = {s: 0.0 for s in symbols}
    ids = {s: inst_ids(s)["binance"] for s in symbols}
    if kind == "perp":
        rest = "https://fapi.binance.com/fapi/v1/depth?symbol={sym}&limit=1000"
        host = "wss://fstream.binance.com/stream?streams="
    else:
        rest = "https://api.binance.com/api/v3/depth?symbol={sym}&limit=1000"
        host = "wss://stream.binance.com:9443/stream?streams="

    def snap_all():
        for s in symbols:
            _health(pub, venue, s, "resync", books[s].gaps)
            payload = http_json(rest.format(sym=ids[s]))
            book = books[s]
            book.snapshot(payload["lastUpdateId"], payload.get("bids") or [], payload.get("asks") or [])
            _publish_book(pub, venue, s, book, last[s], 1.0)
            _health(pub, venue, s, "live", book.gaps)

    streams = []
    for s in symbols:
        sym = ids[s].lower()
        streams.append(f"{sym}@depth@100ms")
        streams.append(f"{sym}@aggTrade")
    url = host + "/".join(streams)
    while not stop.is_set():
        try:
            snap_all()
            ws = _ws_connect(url)
        except (GeoBlocked, RateLimited):
            raise
        try:
            while not stop.is_set():
                raw = _recv(ws)
                if raw is None:
                    if any(not b.synced for b in books.values()):
                        break
                    continue
                msg = json.loads(raw)
                data = msg.get("data") or msg
                event = data.get("e")
                sym = data.get("s") or ""
                symbol = next((s for s, iid in ids.items() if iid == sym), None)
                if symbol is None:
                    continue
                book = books[symbol]
                if event == "aggTrade":
                    last[symbol] = float(data["p"])
                    _publish_book(pub, venue, symbol, book, last[symbol], 1.0)
                    continue
                if event != "depthUpdate":
                    continue
                prev = data.get("pu")
                result = book.diff_binance(data["U"], data["u"], int(prev) if prev is not None else None, data.get("b") or [], data.get("a") or [])
                if result == "resync":
                    _health(pub, venue, symbol, "resync", book.gaps, "sequence gap")
                    break
                if result == "ok":
                    _publish_book(pub, venue, symbol, book, last[symbol], 1.0)
                    _health(pub, venue, symbol, "live", book.gaps)
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if stop.is_set():
            return
        _health(pub, venue, symbols[0], "reconnecting", books[symbols[0]].gaps)
        stop.wait(1.5)


def run_bybit(pub: Publisher, symbols: list[str], stop: threading.Event, kind: str) -> None:
    venue = "bybit_perp" if kind == "perp" else "bybit_spot"
    url = "wss://stream.bybit.com/v5/public/linear" if kind == "perp" else "wss://stream.bybit.com/v5/public/spot"
    depth = "200" if kind == "perp" else "50"
    books = {s: StreamBook("bybit") for s in symbols}
    last = {s: 0.0 for s in symbols}
    ids = {s: inst_ids(s)["binance"] for s in symbols}
    args = []
    for s in symbols:
        args.append(f"orderbook.{depth}.{ids[s]}")
        args.append(f"publicTrade.{ids[s]}")
    while not stop.is_set():
        for s in symbols:
            books[s].clear()
            _health(pub, venue, s, "resync", books[s].gaps)
        ws = _ws_connect(url)
        try:
            ws.send(json.dumps({"op": "subscribe", "args": args}))
            ping_at = time.monotonic()
            while not stop.is_set():
                if time.monotonic() - ping_at > 20:
                    ws.send(json.dumps({"op": "ping"}))
                    ping_at = time.monotonic()
                raw = _recv(ws)
                if raw is None:
                    continue
                msg = json.loads(raw)
                topic = msg.get("topic") or ""
                if topic.startswith("publicTrade."):
                    sym = topic.split(".")[-1]
                    symbol = next((s for s, iid in ids.items() if iid == sym), None)
                    rows = msg.get("data") or []
                    if symbol and rows:
                        last[symbol] = float(rows[-1]["p"])
                        _publish_book(pub, venue, symbol, books[symbol], last[symbol], 1.0)
                    continue
                if not topic.startswith("orderbook."):
                    continue
                data = msg.get("data") or {}
                sym = data.get("s") or topic.split(".")[-1]
                symbol = next((s for s, iid in ids.items() if iid == sym), None)
                if symbol is None:
                    continue
                book = books[symbol]
                bids = _levels_from_pairs(data.get("b"))
                asks = _levels_from_pairs(data.get("a"))
                if msg.get("type") == "snapshot":
                    book.snapshot(int(data.get("u") or 0), bids, asks)
                    _publish_book(pub, venue, symbol, book, last[symbol], 1.0)
                    _health(pub, venue, symbol, "live", book.gaps)
                    continue
                result = book.diff_increment(int(data.get("u") or 0), bids, asks)
                if result == "resync":
                    _health(pub, venue, symbol, "resync", book.gaps, "sequence gap")
                    break
                if result == "ok":
                    _publish_book(pub, venue, symbol, book, last[symbol], 1.0)
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(1.5)


def _okx_mult(inst: str) -> float:
    payload = http_json(f"https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId={inst}")
    rows = payload.get("data") or []
    if not rows:
        return 1.0
    return float(rows[0].get("ctVal") or 1.0)


def run_okx(pub: Publisher, symbols: list[str], stop: threading.Event, kind: str) -> None:
    venue = "okx_perp" if kind == "perp" else "okx_spot"
    key = "okx_swap" if kind == "perp" else "okx_spot"
    ids = {s: inst_ids(s)[key] for s in symbols}
    mult = {s: 1.0 for s in symbols}
    if kind == "perp":
        for s in symbols:
            mult[s] = _okx_mult(ids[s])
    books = {s: StreamBook("okx") for s in symbols}
    last = {s: 0.0 for s in symbols}
    url = "wss://ws.okx.com:8443/ws/v5/public"
    args = [{"channel": "books", "instId": ids[s]} for s in symbols]
    args += [{"channel": "trades", "instId": ids[s]} for s in symbols]
    while not stop.is_set():
        ws = _ws_connect(url)
        try:
            ws.send(json.dumps({"op": "subscribe", "args": args}))
            ping_at = time.monotonic()
            while not stop.is_set():
                if time.monotonic() - ping_at > 20:
                    ws.send("ping")
                    ping_at = time.monotonic()
                raw = _recv(ws)
                if raw is None or raw == "pong":
                    continue
                msg = json.loads(raw)
                arg = msg.get("arg") or {}
                inst = arg.get("instId")
                symbol = next((s for s, iid in ids.items() if iid == inst), None)
                if symbol is None:
                    continue
                if arg.get("channel") == "trades":
                    rows = msg.get("data") or []
                    if rows:
                        last[symbol] = float(rows[-1]["px"])
                        _publish_book(pub, venue, symbol, books[symbol], last[symbol], mult[symbol])
                    continue
                if arg.get("channel") != "books":
                    continue
                for row in msg.get("data") or []:
                    bids = [(float(r[0]), float(r[1])) for r in row.get("bids") or []]
                    asks = [(float(r[0]), float(r[1])) for r in row.get("asks") or []]
                    action = msg.get("action") or "update"
                    result = books[symbol].diff_okx(int(row.get("seqId") or 0), int(row.get("prevSeqId") or -1), bids, asks, action)
                    if result == "resync":
                        _health(pub, venue, symbol, "resync", books[symbol].gaps, "sequence gap")
                        raise RuntimeError("okx gap")
                    if result == "ok":
                        _publish_book(pub, venue, symbol, books[symbol], last[symbol], mult[symbol])
                        _health(pub, venue, symbol, "live", books[symbol].gaps)
        except RuntimeError:
            pass
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(1.5)


def run_htx(pub: Publisher, symbols: list[str], stop: threading.Event) -> None:
    venue = "htx_perp"
    ids = {s: inst_ids(s)["htx"] for s in symbols}
    mult = {}
    for s in symbols:
        try:
            info = http_json(
                f"https://api.hbdm.com/linear-swap-api/v1/swap_contract_info?contract_code={ids[s]}"
            )
            rows = info.get("data") or []
            mult[s] = float(rows[0].get("contract_size") or 1.0) if rows else 1.0
        except (GeoBlocked, RateLimited):
            raise
        except Exception:
            mult[s] = 0.001 if s == "BTC" else 0.01
    books = {s: StreamBook("htx") for s in symbols}
    last = {s: 0.0 for s in symbols}
    url = "wss://api.hbdm.com/linear-swap-ws"
    while not stop.is_set():
        ws = _ws_connect(url)
        try:
            for s in symbols:
                sub = {"sub": f"market.{ids[s]}.depth.step0", "id": f"obheat-{s}"}
                ws.send(json.dumps(sub))
            while not stop.is_set():
                raw = _recv(ws, 8)
                if raw is None:
                    continue
                if isinstance(raw, bytes):
                    try:
                        raw = gzip.decompress(raw).decode()
                    except OSError:
                        raw = raw.decode()
                msg = json.loads(raw)
                if "ping" in msg:
                    ws.send(json.dumps({"pong": msg["ping"]}))
                    continue
                ch = msg.get("ch") or ""
                if ".depth." not in ch:
                    continue
                code = ch.split(".")[1]
                symbol = next((s for s, iid in ids.items() if iid == code), None)
                if symbol is None:
                    continue
                tick = msg.get("tick") or {}
                books[symbol].replace(tick.get("bids") or [], tick.get("asks") or [])
                _publish_book(pub, venue, symbol, books[symbol], last[symbol], mult[symbol])
                _health(pub, venue, symbol, "live", books[symbol].gaps)
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(1.5)


def run_bitget(pub: Publisher, symbols: list[str], stop: threading.Event) -> None:
    venue = "bitget_perp"
    ids = {s: inst_ids(s)["binance"] for s in symbols}
    books = {s: StreamBook("bitget") for s in symbols}
    last = {s: 0.0 for s in symbols}
    url = "wss://ws.bitget.com/v2/ws/public"
    args = [{"instType": "USDT-FUTURES", "channel": "books", "instId": ids[s]} for s in symbols]
    args += [{"instType": "USDT-FUTURES", "channel": "trade", "instId": ids[s]} for s in symbols]
    while not stop.is_set():
        for book in books.values():
            book.clear()
        ws = _ws_connect(url)
        try:
            ws.send(json.dumps({"op": "subscribe", "args": args}))
            ping_at = time.monotonic()
            while not stop.is_set():
                if time.monotonic() - ping_at > 25:
                    ws.send("ping")
                    ping_at = time.monotonic()
                raw = _recv(ws)
                if raw is None or raw == "pong":
                    continue
                msg = json.loads(raw)
                arg = msg.get("arg") or {}
                inst = arg.get("instId")
                symbol = next((s for s, iid in ids.items() if iid == inst), None)
                if symbol is None:
                    continue
                if arg.get("channel") == "trade":
                    rows = msg.get("data") or []
                    if rows:
                        last[symbol] = float(rows[-1].get("price") or rows[-1].get("px") or 0)
                        _publish_book(pub, venue, symbol, books[symbol], last[symbol], 1.0)
                    continue
                action = msg.get("action")
                for row in msg.get("data") or []:
                    bids = [(float(r[0]), float(r[1])) for r in row.get("bids") or []]
                    asks = [(float(r[0]), float(r[1])) for r in row.get("asks") or []]
                    if action == "snapshot" or not books[symbol].synced:
                        books[symbol].snapshot(int(float(row.get("ts") or time.time() * 1000)), bids, asks)
                    else:
                        books[symbol]._apply(bids, asks)
                    _publish_book(pub, venue, symbol, books[symbol], last[symbol], 1.0)
                    _health(pub, venue, symbol, "live", books[symbol].gaps)
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(1.5)


def _gate_mult(contract: str) -> float:
    payload = http_json(f"https://api.gateio.ws/api/v4/futures/usdt/contracts/{contract}")
    return float(payload.get("quanto_multiplier") or 0.0001)


def run_gate(pub: Publisher, symbols: list[str], stop: threading.Event) -> None:
    venue = "gate_perp"
    ids = {s: inst_ids(s)["gate"] for s in symbols}
    mult = {s: _gate_mult(ids[s]) for s in symbols}
    books = {s: StreamBook("gate") for s in symbols}
    last = {s: 0.0 for s in symbols}
    url = "wss://fx-ws.gateio.ws/v4/ws/usdt"
    while not stop.is_set():
        for book in books.values():
            book.clear()
        ws = _ws_connect(url)
        try:
            now = int(time.time())
            for s in symbols:
                ws.send(
                    json.dumps(
                        {
                            "time": now,
                            "channel": "futures.order_book_update",
                            "event": "subscribe",
                            "payload": [ids[s], "100ms", "100"],
                        }
                    )
                )
                ws.send(
                    json.dumps(
                        {
                            "time": now,
                            "channel": "futures.trades",
                            "event": "subscribe",
                            "payload": [ids[s]],
                        }
                    )
                )
            ping_at = time.monotonic()
            while not stop.is_set():
                if time.monotonic() - ping_at > 15:
                    ws.send(json.dumps({"time": int(time.time()), "channel": "futures.ping"}))
                    ping_at = time.monotonic()
                raw = _recv(ws)
                if raw is None:
                    continue
                msg = json.loads(raw)
                ch = msg.get("channel") or ""
                result = msg.get("result") or {}
                if ch == "futures.trades" and msg.get("event") == "update":
                    rows = result if isinstance(result, list) else [result]
                    for row in rows:
                        contract = row.get("contract")
                        symbol = next((s for s, iid in ids.items() if iid == contract), None)
                        if symbol and row.get("price"):
                            last[symbol] = float(row["price"])
                    continue
                if ch != "futures.order_book_update" or msg.get("event") != "update":
                    continue
                contract = result.get("s")
                symbol = next((s for s, iid in ids.items() if iid == contract), None)
                if symbol is None:
                    continue
                bids = _levels_from_pairs(result.get("b"))
                asks = _levels_from_pairs(result.get("a"))
                if result.get("full") or not books[symbol].synced:
                    books[symbol].snapshot(int(result.get("u") or 0), bids, asks)
                    status = "ok"
                else:
                    status = books[symbol].diff_range(
                        int(result.get("U") or result.get("u") or 0),
                        int(result.get("u") or 0),
                        bids,
                        asks,
                    )
                if status == "resync":
                    _health(pub, venue, symbol, "resync", books[symbol].gaps, "sequence gap")
                    break
                _publish_book(pub, venue, symbol, books[symbol], last[symbol], mult[symbol])
                _health(pub, venue, symbol, "live", books[symbol].gaps)
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(1.5)


def run_coinbase(pub: Publisher, symbols: list[str], stop: threading.Event) -> None:
    venue = "coinbase_spot"
    ids = {s: inst_ids(s)["coinbase"] for s in symbols}
    books = {s: StreamBook("coinbase") for s in symbols}
    last = {s: 0.0 for s in symbols}
    url = "wss://ws-feed.exchange.coinbase.com"
    while not stop.is_set():
        ws = _ws_connect(url)
        try:
            ws.send(
                json.dumps(
                    {
                        "type": "subscribe",
                        "product_ids": list(ids.values()),
                        "channels": ["level2", "heartbeat", "ticker"],
                    }
                )
            )
            while not stop.is_set():
                raw = _recv(ws, 10)
                if raw is None:
                    _health(pub, venue, symbols[0], "stale", 0, "heartbeat timeout")
                    break
                msg = json.loads(raw)
                kind = msg.get("type")
                product = msg.get("product_id")
                symbol = next((s for s, iid in ids.items() if iid == product), None)
                if kind == "heartbeat":
                    continue
                if symbol is None:
                    continue
                if kind == "ticker" and msg.get("price"):
                    last[symbol] = float(msg["price"])
                    _publish_book(pub, venue, symbol, books[symbol], last[symbol], 1.0)
                    continue
                if kind == "snapshot":
                    books[symbol].replace(msg.get("bids") or [], msg.get("asks") or [])
                    _publish_book(pub, venue, symbol, books[symbol], last[symbol], 1.0)
                    _health(pub, venue, symbol, "live", books[symbol].gaps)
                elif kind == "l2update":
                    bid_diff = []
                    ask_diff = []
                    for side, price, size in msg.get("changes") or []:
                        if side == "buy":
                            bid_diff.append((price, size))
                        else:
                            ask_diff.append((price, size))
                    if books[symbol].synced:
                        books[symbol]._apply(bid_diff, ask_diff)
                        _publish_book(pub, venue, symbol, books[symbol], last[symbol], 1.0)
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not stop.is_set():
            stop.wait(2.0)


def poll_oi(pub: Publisher, symbols: list[str], stop: threading.Event) -> None:
    while not stop.is_set():
        for s in symbols:
            iid = inst_ids(s)["binance"]
            try:
                oi = http_json(f"https://fapi.binance.com/fapi/v1/openInterest?symbol={iid}")
                price_row = http_json(f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={iid}")
                px = float(price_row.get("price") or 0)
                usd = float(oi.get("openInterest") or 0) * px
                ratio = http_json(
                    f"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={iid}&period=5m&limit=1"
                )
                long_frac = 0.5
                if isinstance(ratio, list) and ratio:
                    long_frac = float(ratio[0].get("longAccount") or 0.5)
                pub.health(
                    {
                        "type": "oi",
                        "symbol": s,
                        "oi_usd": usd,
                        "long_frac": long_frac,
                        "source": "open_interest",
                    }
                )
            except GeoBlocked:
                pub.health({"type": "oi", "symbol": s, "oi_usd": 0, "long_frac": 0.5, "source": "unavailable"})
            except RateLimited:
                break
            except Exception:
                continue
        stop.wait(30)


VENUE_RUNNERS = (
    ("binance_perp", lambda pub, symbols, stop: run_binance(pub, symbols, stop, "perp")),
    ("bybit_perp", lambda pub, symbols, stop: run_bybit(pub, symbols, stop, "perp")),
    ("okx_perp", lambda pub, symbols, stop: run_okx(pub, symbols, stop, "perp")),
    ("htx_perp", run_htx),
    ("bitget_perp", run_bitget),
    ("gate_perp", run_gate),
    ("binance_spot", lambda pub, symbols, stop: run_binance(pub, symbols, stop, "spot")),
    ("coinbase_spot", run_coinbase),
    ("okx_spot", lambda pub, symbols, stop: run_okx(pub, symbols, stop, "spot")),
    ("bybit_spot", lambda pub, symbols, stop: run_bybit(pub, symbols, stop, "spot")),
)
