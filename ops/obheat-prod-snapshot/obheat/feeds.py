"""cryptofeed-транспорт. Книга живёт в нашем движке.

Checksum OKX не проверяется: с 23.06.2026 в JSON books он всегда 0.
Непрерывность OKX — seqId/prevSeqId. Обратные контракты не подписываются.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from decimal import Decimal

import aiohttp
from cryptofeed import FeedHandler
from cryptofeed.connection import AsyncConnection
from cryptofeed.defines import (
    ASK,
    BID,
    BUY,
    BYBIT,
    CANDLES,
    FUNDING,
    INDEX,
    L2_BOOK,
    LIQUIDATIONS,
    OPEN_INTEREST,
    PERPETUAL,
    SELL,
    TICKER,
    TRADES,
)
from cryptofeed.exchanges import Binance, BinanceFutures, Bitget, Bybit, Coinbase, Gateio, HuobiSwap, OKX as OKXFeed
from cryptofeed.exchanges.huobi_dm import HuobiDM
from cryptofeed.symbols import str_to_symbol

from obheat.book import BinanceSync
from obheat.engine import Engine
from obheat.rest import governor
from obheat.native import start_native_feeds
from obheat.symbols import ours_from_std, std_symbol_for

LOG = logging.getLogger("obheat.feeds")


def _side(value: str) -> str:
    text = str(value).lower()
    if text in {BUY, "buy"}:
        return "buy"
    return "sell"


def _book_rows(obj, side: str) -> list[tuple[Decimal, Decimal]]:
    book = getattr(obj, "book", None)
    if book is None:
        return []
    rows = book.get(side, {}) if isinstance(book, dict) else getattr(book, side, {})
    if hasattr(rows, "items"):
        return [(Decimal(str(price)), Decimal(str(qty))) for price, qty in rows.items()]
    return [(Decimal(str(row[0])), Decimal(str(row[1]))) for row in rows or []]


def _sequence(obj) -> int:
    for name in ("sequence_number", "sequence", "id"):
        value = getattr(obj, name, None)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                pass
    return int(time.time() * 1000)


def _bybit_topic_pair(venue: str, pair: str) -> str:
    return pair.replace("/", "") if venue == "BYBIT_SPOT" else pair


class _HubFeed:
    """Общая обвязка: сделки и ликвидации из callback(), ресинк после дыры."""

    def __init__(self, engine: Engine, **kwargs) -> None:
        self.engine = engine
        self._resync_busy: set[str] = set()
        self._resync_next: dict[str, float] = {}
        self._resync_failures: dict[str, int] = {}
        self._conn: AsyncConnection | None = None
        super().__init__(**kwargs)

    def _venue(self) -> str:
        return getattr(self, "obheat_venue", FEED_VENUE[self.id])

    def _our(self, std_symbol: str) -> str | None:
        symbol = ours_from_std(std_symbol)
        if symbol is None or (self._venue(), symbol) not in self.engine.specs:
            return None
        return symbol

    async def callback(self, data_type, obj, receipt_timestamp):
        if data_type == L2_BOOK:
            symbol = self._our(obj.symbol)
            if symbol is not None:
                result = self._replace_book_from_object(symbol, obj)
                self._after(symbol, result, None, None)
        elif data_type == TRADES:
            symbol = self._our(obj.symbol)
            if symbol is not None:
                self.engine.add_trade(self._venue(), symbol, _side(obj.side), obj.amount, obj.price)
        elif data_type == LIQUIDATIONS:
            symbol = self._our(obj.symbol)
            if symbol is not None:
                self.engine.add_liquidation(self._venue(), symbol, _side(obj.side), obj.quantity, obj.price)
        elif data_type == FUNDING:
            symbol = self._our(obj.symbol)
            if symbol is not None:
                self.engine.add_funding(self._venue(), symbol, obj.rate)
        elif data_type == OPEN_INTEREST:
            symbol = self._our(obj.symbol)
            if symbol is not None:
                self.engine.add_open_interest(self._venue(), symbol, obj.open_interest)
        await super().callback(data_type, obj, receipt_timestamp)

    def _replace_book_from_object(self, symbol: str, obj):
        book = self.engine.book(self._venue(), symbol)
        bids = _book_rows(obj, BID)
        asks = _book_rows(obj, ASK)
        return book.apply_binance_snapshot(_sequence(obj), bids, asks)

    def _after(self, symbol: str, result, seq: int | None, prev: int | None) -> None:
        book = self.engine.book(self._venue(), symbol)
        self.engine.observe(self._venue(), symbol, result.kind, result.detail or book.detail, seq, prev)
        if result.kind == "gap" or book.needs_resync:
            self._schedule_resync(symbol)

    def _schedule_resync(self, symbol: str) -> None:
        now = time.time()
        if now < self._resync_next.get(symbol, 0.0):
            return
        if symbol in self._resync_busy:
            return
        self._resync_busy.add(symbol)

        async def run() -> None:
            try:
                await self._resync(symbol)
                self._resync_failures[symbol] = 0
            except Exception:
                self._resync_failures[symbol] = self._resync_failures.get(symbol, 0) + 1
                self._resync_next[symbol] = time.time() + min(300.0, 60.0 * self._resync_failures[symbol])
                LOG.exception("resync %s %s failed", self._venue(), symbol)
            finally:
                self._resync_busy.discard(symbol)

        asyncio.get_running_loop().create_task(run())

    async def _resync(self, symbol: str) -> None:
        raise NotImplementedError

    def _exchange_symbol(self, symbol: str) -> str:
        return self.std_symbol_to_exchange_symbol(std_symbol_for(self._venue(), symbol))


class ObheatBinance(_HubFeed, BinanceFutures):
    obheat_venue = "BINANCE"

    def __init__(self, engine: Engine, **kwargs) -> None:
        self._sync: dict[str, BinanceSync] = {}
        super().__init__(engine, **kwargs)

    def _session(self, symbol: str) -> BinanceSync:
        session = self._sync.get(symbol)
        if session is None:
            session = BinanceSync(self.engine.book(self._venue(), symbol))
            self._sync[symbol] = session
        return session

    async def _book(self, msg: dict, pair: str, timestamp: float) -> None:
        del timestamp
        try:
            symbol = self._our(self.exchange_symbol_to_std_symbol(pair))
        except Exception:
            LOG.warning("binance unknown pair %s", pair)
            return
        if symbol is None:
            return
        if msg.get("lastUpdateId") is not None and msg.get("U") is None:
            result = self.engine.book(self._venue(), symbol).apply_binance_snapshot(
                int(msg["lastUpdateId"]),
                msg.get("b") or msg.get("bids") or [],
                msg.get("a") or msg.get("asks") or [],
            )
            self.engine.set_venue_mode(self._venue(), "partial")
            self._after(symbol, result, int(msg["lastUpdateId"]), None)
            return
        session = self._session(symbol)
        was_waiting = session.awaiting or session.book.needs_resync or session.book.status != "VALID"
        for result in session.on_diff(msg):
            if result.kind == "gap":
                prev = int(msg["pu"]) if msg.get("pu") is not None else None
                self._after(symbol, result, int(msg["u"]), prev)
            elif result.kind == "update":
                self.engine.touch(self._venue())
                if session.book.status == "VALID":
                    self.engine.last_book[self._venue()] = self.engine.last_msg[self._venue()]
        if was_waiting or session.awaiting:
            self._schedule_resync(symbol)

    async def _resync(self, symbol: str) -> None:
        venue = self._venue()
        gov = governor(venue)
        key = f"depth:{symbol}"
        if not await gov.wait_turn(key, min_interval=60.0):
            self.engine.set_venue_mode(venue, "partial" if gov.is_banned() else self.engine.venue_mode.get(venue, "full"))
            LOG.warning("skip %s %s REST depth: cooldown/ban/weight", venue, symbol)
            return
        exchange_symbol = self._exchange_symbol(symbol)
        url = self.rest_endpoints[0].route("l2book", self.sandbox).format(exchange_symbol, 1000)
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session_http:
                async with session_http.get(url) as response:
                    raw = await response.text()
                    if response.status in {418, 429}:
                        gov.fail(response.status, response.headers)
                        self.engine.set_venue_mode(venue, "partial")
                        LOG.error("%s REST depth banned/limited status=%s retry-after=%s", venue, response.status, response.headers.get("Retry-After"))
                        return
                    if response.status >= 400:
                        gov.fail(response.status, response.headers)
                        LOG.error("%s REST depth failed status=%s body=%s", venue, response.status, raw[:200])
                        return
                    gov.ok(response.headers)
        except Exception:
            gov.fail(None, {})
            raise
        data = json.loads(raw, parse_float=Decimal)
        session = self._session(symbol)
        for result in session.on_snapshot(int(data["lastUpdateId"]), data.get("bids") or [], data.get("asks") or []):
            if result.kind in {"snapshot", "update", "gap"}:
                self.engine.observe(self._venue(), symbol, result.kind, result.detail, session.book.last_seq, None)
                if result.kind == "gap":
                    break
        if session.awaiting:
            self._resync_next[symbol] = time.time() + 60.0


class ObheatBybit(_HubFeed, Bybit):
    """Линейный стакан orderbook.1000. Дыру ловит u; seq может перескакивать."""
    obheat_venue = "BYBIT"

    async def message_handler(self, msg: str, conn, timestamp: float) -> None:
        self._conn = conn
        try:
            payload = json.loads(msg, parse_float=Decimal)
        except Exception:
            payload = None
        if isinstance(payload, dict) and str(payload.get("topic", "")).startswith("allLiquidation."):
            await self._liquidation(payload)
            return
        await super().message_handler(msg, conn, timestamp)

    async def subscribe(self, connection: AsyncConnection) -> None:
        Bybit._Bybit__reset(self, connection)
        ticker_pairs: list[str] = []
        for chan, pairs in connection.subscription.items():
            if chan in {
                self.websocket_channels[TICKER],
                self.websocket_channels[OPEN_INTEREST],
                self.websocket_channels[FUNDING],
                self.websocket_channels[INDEX],
            }:
                ticker_pairs.extend(pairs)
        ticker_pairs = list(dict.fromkeys(ticker_pairs))
        if ticker_pairs:
            await connection.write(json.dumps({"op": "subscribe", "args": [f"tickers.{pair}" for pair in ticker_pairs]}))
        for chan, pairs in connection.subscription.items():
            std = self.exchange_channel_to_std(chan)
            if self.is_authenticated_channel(std):
                continue
            if std in {TICKER, OPEN_INTEREST, FUNDING, INDEX}:
                continue
            for pair in pairs:
                if std == CANDLES:
                    args = [f"{self.websocket_channels[CANDLES]}.{self.candle_interval_map[self.candle_interval]}.{pair}"]
                elif std == L2_BOOK:
                    pair_for_topic = _bybit_topic_pair(self._venue(), pair)
                    sym = str_to_symbol(self.exchange_symbol_to_std_symbol(pair))
                    depth = "1000" if sym.type == PERPETUAL else "200"
                    args = [f"orderbook.{depth}.{pair_for_topic}"]
                elif std == LIQUIDATIONS:
                    args = [f"allLiquidation.{pair}"]
                else:
                    pair_for_topic = _bybit_topic_pair(self._venue(), pair)
                    args = [f"{chan}.{pair_for_topic}"]
                await connection.write(json.dumps({"op": "subscribe", "args": args}))

    async def _liquidation(self, msg: dict) -> None:
        pair = msg.get("topic", "").split(".")[-1]
        try:
            symbol = self._our(self.exchange_symbol_to_std_symbol(pair))
        except Exception:
            symbol = None
        if symbol is None:
            return
        rows = msg.get("data") or []
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows:
            price = row.get("p") or row.get("price")
            qty = row.get("v") or row.get("qty") or row.get("size")
            if price is None or qty is None:
                continue
            self.engine.add_liquidation(self._venue(), symbol, _side(row.get("S") or row.get("side") or SELL), Decimal(str(qty)), Decimal(str(price)))

    async def _book(self, msg: dict, timestamp: float, market: str) -> None:
        del timestamp, market
        try:
            pair = self.exchange_symbol_to_std_symbol(msg["topic"].split(".")[-1])
        except Exception:
            LOG.warning("bybit book without symbol")
            return
        symbol = self._our(pair)
        if symbol is None:
            return
        data = msg.get("data") or {}
        if data.get("u") is None:
            return
        book = self.engine.book(self._venue(), symbol)
        prev = book.last_seq
        result = book.apply_bybit(msg.get("type") or "delta", int(data["u"]), data.get("b") or [], data.get("a") or [])
        if result.kind != "late":
            self._after(symbol, result, int(data["u"]), prev)

    async def _resync(self, symbol: str) -> None:
        if self._conn is None:
            await asyncio.sleep(1)
            return
        await self._conn.write(json.dumps({"op": "subscribe", "args": [f"orderbook.1000.{symbol}"]}))


class ObheatOKX(_HubFeed, OKXFeed):
    obheat_venue = "OKX"

    def __init__(self, engine: Engine, **kwargs) -> None:
        kwargs["checksum_validation"] = False
        super().__init__(engine, **kwargs)

    async def message_handler(self, msg: str, conn, timestamp: float) -> None:
        self._conn = conn
        await super().message_handler(msg, conn, timestamp)

    async def _book(self, msg: dict, timestamp: float) -> None:
        del timestamp
        try:
            pair = self.exchange_symbol_to_std_symbol(msg["arg"]["instId"])
        except Exception:
            LOG.warning("okx book without instId")
            return
        symbol = self._our(pair)
        if symbol is None:
            return
        action = msg.get("action") or "update"
        for update in msg.get("data") or []:
            if update.get("seqId") is None or update.get("prevSeqId") is None:
                LOG.warning("okx book without seqId %s", symbol)
                continue
            book = self.engine.book(self._venue(), symbol)
            prev = book.last_seq
            result = book.apply_okx(
                action,
                int(update["seqId"]),
                int(update["prevSeqId"]),
                update.get("bids") or [],
                update.get("asks") or [],
                checksum=update.get("checksum", 0),
            )
            if result.kind != "late":
                self._after(symbol, result, int(update["seqId"]), int(update["prevSeqId"]))

    async def _resync(self, symbol: str) -> None:
        if self._conn is None:
            await asyncio.sleep(1)
            return
        inst = self._exchange_symbol(symbol)
        await self._conn.write(json.dumps({"op": "subscribe", "args": [{"channel": "books", "instId": inst}]}))


class ObheatHTX(_HubFeed, HuobiSwap):
    """Линейный USDT-своп. Канал high_freq: снимок и дифф, version + 1."""
    obheat_venue = "HTX"

    websocket_channels = {
        **HuobiSwap.websocket_channels,
        L2_BOOK: "depth.size_150.high_freq",
    }

    async def message_handler(self, msg, conn, timestamp: float) -> None:
        self._conn = conn
        await super().message_handler(msg, conn, timestamp)

    async def subscribe(self, conn: AsyncConnection) -> None:
        # funding на HTX — REST linear-swap, не websocket-топик market.*.funding.
        key = self.websocket_channels[FUNDING]
        pairs = list(self.subscription.get(key) or [])
        self.subscription.pop(key, None)
        if getattr(conn, "subscription", None) is not None:
            conn.subscription.pop(key, None)
        if pairs:
            asyncio.create_task(self._funding(pairs))
        await HuobiDM.subscribe(self, conn)

    async def _book(self, msg: dict, timestamp: float) -> None:
        del timestamp
        try:
            code = msg["ch"].split(".")[1]
            pair = self.exchange_symbol_to_std_symbol(code)
        except Exception:
            LOG.warning("htx book without channel")
            return
        symbol = self._our(pair)
        if symbol is None:
            return
        tick = msg.get("tick") or {}
        if "version" not in tick:
            return
        book = self.engine.book(self._venue(), symbol)
        prev = book.last_seq
        result = book.apply_htx(
            str(tick.get("event") or "snapshot"),
            int(tick["version"]),
            tick.get("bids") or [],
            tick.get("asks") or [],
        )
        if result.kind != "late":
            self._after(symbol, result, int(tick["version"]), prev)

    async def _funding(self, pairs) -> None:
        while True:
            for pair in pairs:
                try:
                    gov = governor(self._venue())
                    if not await gov.wait_turn(f"funding:{pair}", min_interval=60.0):
                        continue
                    url = f"https://api.hbdm.com/linear-swap-api/v1/swap_funding_rate?contract_code={pair}"
                    raw = await self.http_conn.read(url)
                    gov.ok({})
                    data = json.loads(raw, parse_float=Decimal)
                    if data.get("status") != "ok":
                        continue
                    symbol = self._our(self.exchange_symbol_to_std_symbol(pair))
                    if symbol is None:
                        continue
                    self.engine.add_funding(self._venue(), symbol, Decimal(str(data["data"]["funding_rate"])))
                except Exception:
                    governor(self._venue()).fail(None, {})
                    LOG.exception("htx funding %s", pair)
                await asyncio.sleep(0.2)
            await asyncio.sleep(60)

    async def _resync(self, symbol: str) -> None:
        if self._conn is None:
            await asyncio.sleep(1)
            return
        code = self._exchange_symbol(symbol)
        await self._conn.write(json.dumps({"sub": f"market.{code}.depth.size_150.high_freq", "id": f"resync-{symbol}"}))


class ObheatBitget(_HubFeed, Bitget):
    obheat_venue = "BITGET"

    async def _resync(self, symbol: str) -> None:
        del symbol
        await asyncio.sleep(1)


class ObheatGate(_HubFeed, Gateio):
    obheat_venue = "GATE"

    async def _resync(self, symbol: str) -> None:
        del symbol
        await asyncio.sleep(1)


class ObheatBinanceSpot(_HubFeed, Binance):
    obheat_venue = "BINANCE_SPOT"

    async def _resync(self, symbol: str) -> None:
        del symbol
        await asyncio.sleep(1)


class ObheatCoinbase(_HubFeed, Coinbase):
    obheat_venue = "COINBASE"

    async def _resync(self, symbol: str) -> None:
        del symbol
        await asyncio.sleep(1)


class ObheatOKXSpot(ObheatOKX):
    obheat_venue = "OKX_SPOT"


class ObheatBybitSpot(ObheatBybit):
    obheat_venue = "BYBIT_SPOT"


FEED_VENUE = {
    ObheatBinance.id: "BINANCE",
    ObheatBybit.id: "BYBIT",
    ObheatOKX.id: "OKX",
    ObheatHTX.id: "HTX",
    ObheatBitget.id: "BITGET",
    ObheatGate.id: "GATE",
    ObheatBinanceSpot.id: "BINANCE_SPOT",
    ObheatCoinbase.id: "COINBASE",
    ObheatOKXSpot.id: "OKX_SPOT",
    ObheatBybitSpot.id: "BYBIT_SPOT",
}


def build_handler(engine: Engine, symbols: list[str]) -> FeedHandler:
    venues = set(engine.venues)
    handler = FeedHandler()
    handler.obheat_native_start = lambda engine, symbols, loop=None: start_native_feeds(engine, symbols, loop)
    def common_for(venue: str) -> dict:
        return dict(symbols=[std_symbol_for(venue, symbol) for symbol in symbols], timeout=60, retries=-1)
    def add(name: str, factory) -> None:
        try:
            handler.add_feed(factory())
        except Exception:
            LOG.exception("feed %s init failed; venue will be stale/no data", name)
    if "BINANCE" in venues:
        add(
            "BINANCE",
            lambda: ObheatBinance(
                engine,
                channels=[L2_BOOK, TRADES, LIQUIDATIONS, FUNDING],
                depth_interval="100ms",
                **common_for("BINANCE"),
            ),
        )
    if "BYBIT" in venues:
        add("BYBIT", lambda: ObheatBybit(engine, channels=[L2_BOOK, TRADES, LIQUIDATIONS, FUNDING, OPEN_INTEREST], **common_for("BYBIT")))
    if "OKX" in venues:
        add(
            "OKX",
            lambda: ObheatOKX(
                engine,
                channels=[L2_BOOK, TRADES, LIQUIDATIONS, FUNDING, OPEN_INTEREST],
                checksum_validation=False,
                **common_for("OKX"),
            ),
        )
    if "HTX" in venues:
        add("HTX", lambda: ObheatHTX(engine, channels=[L2_BOOK, TRADES, FUNDING], **common_for("HTX")))
    # BITGET/GATE/COINBASE use native public websocket handlers. cryptofeed 2.5
    # either initializes stale symbols or calls auth-only public endpoints.
    if "BINANCE_SPOT" in venues:
        add("BINANCE_SPOT", lambda: ObheatBinanceSpot(engine, channels=[L2_BOOK, TRADES], **common_for("BINANCE_SPOT")))
    if "OKX_SPOT" in venues:
        add("OKX_SPOT", lambda: ObheatOKXSpot(engine, channels=[L2_BOOK, TRADES], checksum_validation=False, **common_for("OKX_SPOT")))
    if "BYBIT_SPOT" in venues:
        add("BYBIT_SPOT", lambda: ObheatBybitSpot(engine, channels=[L2_BOOK, TRADES], **common_for("BYBIT_SPOT")))
    return handler
