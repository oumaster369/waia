"""Small native public websocket feeds for venues broken in cryptofeed 2.5."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from decimal import Decimal

import aiohttp
import websockets

from obheat.engine import Engine
from obheat.rest import governor

LOG = logging.getLogger("obheat.native")


COINBASE_PRODUCT = {"BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD"}
BITGET_INST = {"BTCUSDT": "BTCUSDT", "ETHUSDT": "ETHUSDT"}
GATE_CONTRACT = {"BTCUSDT": "BTC_USDT", "ETHUSDT": "ETH_USDT"}
COINBASE_WS_KWARGS = {"ping_interval": 20, "max_size": None}


def start_native_feeds(engine: Engine, symbols: list[str], loop: asyncio.AbstractEventLoop | None = None) -> list[asyncio.Task]:
    tasks = []
    venues = set(engine.venues)
    loop = loop or asyncio.get_event_loop()
    if "COINBASE" in venues:
        tasks.append(loop.create_task(coinbase_loop(engine, symbols)))
    if "BITGET" in venues:
        tasks.append(loop.create_task(bitget_loop(engine, symbols)))
    if "GATE" in venues:
        tasks.append(loop.create_task(gate_loop(engine, symbols)))
    return tasks


async def coinbase_loop(engine: Engine, symbols: list[str]) -> None:
    products = [COINBASE_PRODUCT[s] for s in symbols if ("COINBASE", s) in engine.specs]
    reverse = {value: key for key, value in COINBASE_PRODUCT.items()}
    while products:
        try:
            async with websockets.connect("wss://ws-feed.exchange.coinbase.com", **COINBASE_WS_KWARGS) as ws:
                await ws.send(json.dumps({"type": "subscribe", "product_ids": products, "channels": ["level2_batch", "matches"]}))
                async for raw in ws:
                    msg = json.loads(raw, parse_float=Decimal)
                    product = msg.get("product_id")
                    symbol = reverse.get(product)
                    if symbol is None or ("COINBASE", symbol) not in engine.specs:
                        continue
                    if msg.get("type") == "snapshot":
                        _replace(engine, "COINBASE", symbol, msg.get("bids") or [], msg.get("asks") or [], _seq())
                    elif msg.get("type") in {"l2update", "level2"}:
                        _coinbase_update(engine, symbol, msg.get("changes") or [])
                    elif msg.get("type") == "match":
                        engine.add_trade("COINBASE", symbol, "buy" if msg.get("side") == "buy" else "sell", Decimal(str(msg.get("size") or 0)), Decimal(str(msg.get("price") or 0)))
        except Exception as exc:
            LOG.exception("coinbase native loop failed")
            await asyncio.sleep(_transport_backoff("COINBASE", exc))


async def bitget_loop(engine: Engine, symbols: list[str]) -> None:
    args = [{"instType": "USDT-FUTURES", "channel": "books", "instId": BITGET_INST[s]} for s in symbols if ("BITGET", s) in engine.specs]
    reverse = {value: key for key, value in BITGET_INST.items()}
    while args:
        try:
            async with websockets.connect("wss://ws.bitget.com/v2/ws/public", ping_interval=20) as ws:
                await ws.send(json.dumps({"op": "subscribe", "args": args}))
                async for raw in ws:
                    msg = json.loads(raw, parse_float=Decimal)
                    arg = msg.get("arg") or {}
                    symbol = reverse.get(arg.get("instId"))
                    if symbol is None or ("BITGET", symbol) not in engine.specs:
                        continue
                    for row in msg.get("data") or []:
                        bids = row.get("bids") or []
                        asks = row.get("asks") or []
                        seq = int(row.get("seq") or row.get("ts") or _seq())
                        if msg.get("action") == "snapshot":
                            _replace(engine, "BITGET", symbol, bids, asks, seq)
                        else:
                            _merge(engine, "BITGET", symbol, bids, asks, seq, "bitget update")
        except Exception as exc:
            LOG.exception("bitget native loop failed")
            await asyncio.sleep(_transport_backoff("BITGET", exc))


async def gate_loop(engine: Engine, symbols: list[str]) -> None:
    active = [s for s in symbols if ("GATE", s) in engine.specs]
    reverse = {value: key for key, value in GATE_CONTRACT.items()}
    sync = {symbol: GateSync(engine, symbol) for symbol in active}
    while active:
        try:
            async with websockets.connect("wss://fx-ws.gateio.ws/v4/ws/usdt", ping_interval=20) as ws:
                for symbol in active:
                    await ws.send(json.dumps({"time": int(time.time()), "channel": "futures.order_book_update", "event": "subscribe", "payload": [GATE_CONTRACT[symbol], "100ms", "100"]}))
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as http:
                    for symbol in active:
                        await _gate_snapshot(sync[symbol], http)
                    async for raw in ws:
                        msg = json.loads(raw, parse_float=Decimal)
                        result = msg.get("result") or {}
                        symbol = reverse.get(result.get("s") or result.get("contract"))
                        if symbol is None or ("GATE", symbol) not in engine.specs:
                            continue
                        sync[symbol].on_update(result)
                        if sync[symbol].need_snapshot:
                            sync[symbol].need_snapshot = False
                            await _gate_snapshot(sync[symbol], http)
        except Exception as exc:
            LOG.exception("gate native loop failed")
            await asyncio.sleep(_transport_backoff("GATE", exc))


async def _gate_snapshot(sync: "GateSync", http: aiohttp.ClientSession) -> None:
    gov = governor("GATE")
    symbol = sync.symbol
    sync.need_snapshot = False
    if gov.is_unavailable() or not await gov.wait_turn(f"depth:{symbol}", min_interval=60.0):
        return
    contract = GATE_CONTRACT[symbol]
    url = f"https://api.gateio.ws/api/v4/futures/usdt/order_book?contract={contract}&limit=100&with_id=true"
    async with http.get(url) as response:
        text = await response.text()
        if response.status >= 400:
            gov.fail(response.status, response.headers, text[:300])
            if gov.is_unavailable():
                sync.engine.mark_unavailable("GATE", text[:180])
            LOG.error("gate snapshot %s failed status=%s body=%s", symbol, response.status, text[:200])
            return
        gov.ok(response.headers)
    data = json.loads(text, parse_float=Decimal)
    sync.on_snapshot(data)


def _coinbase_update(engine: Engine, symbol: str, changes: list) -> None:
    bids, asks = [], []
    for side, price, qty in changes:
        (bids if side == "buy" else asks).append([price, qty])
    _merge(engine, "COINBASE", symbol, bids, asks, _seq(), "coinbase update")


def _gate_levels(levels) -> list:
    rows = []
    for level in levels or []:
        if isinstance(level, dict):
            price = level.get("p") or level.get("price")
            if price is None:
                continue
            qty = _first_not_none(level, ("s", "q", "size"))
            rows.append([price, str(abs(Decimal(str(0 if qty is None else qty))))])
        else:
            if not level or level[0] is None:
                continue
            qty = level[1] if len(level) > 1 and level[1] is not None else 0
            rows.append([level[0], str(abs(Decimal(str(qty))))])
    return rows


class GateSync:
    def __init__(self, engine: Engine, symbol: str) -> None:
        self.engine = engine
        self.symbol = symbol
        self.pending: list[dict] = []
        self.snapshot_id: int | None = None
        self.awaiting = True
        self.need_snapshot = False

    def on_update(self, result: dict) -> None:
        update = _gate_update(result)
        if update is None:
            return
        if self.awaiting:
            self.pending.append(update)
            if self.snapshot_id is not None:
                self._drain()
            return
        self._apply(update)

    def on_snapshot(self, data: dict) -> None:
        snapshot_id = int(data.get("id") or data.get("current") or data.get("u") or _seq())
        self.snapshot_id = snapshot_id
        result = self.engine.book("GATE", self.symbol).apply_binance_snapshot(
            snapshot_id,
            _gate_levels(data.get("bids")),
            _gate_levels(data.get("asks")),
        )
        self.engine.observe("GATE", self.symbol, result.kind, result.detail, snapshot_id, None)
        if result.kind == "snapshot":
            book = self.engine.book("GATE", self.symbol)
            book.status = "WAITING"
            book.needs_resync = True
            book.detail = "waiting for first gate update after snapshot"
        self._drain()

    def _drain(self) -> None:
        if self.snapshot_id is None:
            return
        target = self.snapshot_id + 1
        pending, self.pending = self.pending, []
        for update in pending:
            if update["u"] < target:
                continue
            if update["U"] <= target <= update["u"]:
                self._apply_first(update)
                self.awaiting = False
                continue
            self.pending.append(update)
            break

    def _apply_first(self, update: dict) -> None:
        book = self.engine.book("GATE", self.symbol)
        book._merge(update["bids"], update["asks"])
        result = book._finish("update", "gate first update", update["u"])
        self.engine.observe("GATE", self.symbol, result.kind, result.detail, update["u"], self.snapshot_id)
        if result.kind == "gap":
            self.awaiting = True
            self.snapshot_id = None
            self.need_snapshot = True

    def _apply(self, update: dict) -> None:
        book = self.engine.book("GATE", self.symbol)
        if book.last_seq is not None and update["U"] > book.last_seq + 1:
            prev = book.last_seq
            result = book.clear_gap(f"gate U {update['U']} > {book.last_seq}+1")
            self.engine.observe("GATE", self.symbol, result.kind, result.detail, update["u"], prev)
            self.awaiting = True
            self.snapshot_id = None
            self.need_snapshot = True
            return
        _merge(self.engine, "GATE", self.symbol, update["bids"], update["asks"], update["u"], "gate update")


def _gate_update(result: dict) -> dict | None:
    update_id = result.get("u") or result.get("id")
    if update_id is None:
        return None
    first_id = result.get("U") or result.get("first_update_id") or update_id
    return {
        "U": int(first_id),
        "u": int(update_id),
        "bids": _gate_levels(result.get("b") or result.get("bids")),
        "asks": _gate_levels(result.get("a") or result.get("asks")),
    }


def _first_not_none(row: dict, keys: tuple[str, ...]):
    for key in keys:
        if row.get(key) is not None:
            return row.get(key)
    return None


def _replace(engine: Engine, venue: str, symbol: str, bids, asks, seq: int) -> None:
    result = engine.book(venue, symbol).apply_binance_snapshot(seq, bids, asks)
    engine.observe(venue, symbol, result.kind, result.detail, seq, None)


def _merge(engine: Engine, venue: str, symbol: str, bids, asks, seq: int, detail: str) -> None:
    book = engine.book(venue, symbol)
    if book.status != "VALID":
        return
    prev = book.last_seq
    book._merge(bids, asks)
    result = book._finish("update", detail, seq)
    engine.observe(venue, symbol, result.kind, result.detail, seq, prev)


def _transport_backoff(venue: str, exc: BaseException) -> float:
    text = str(exc).lower()
    if any(token in text for token in ("451", "restricted location", "eligibility", "geoblock", "403")):
        governor(venue).mark_unavailable(str(exc)[:180])
        return 300.0
    if governor(venue).is_unavailable():
        return 300.0
    return 5.0


def _seq() -> int:
    return int(time.time() * 1000)
