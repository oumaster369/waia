"""Секундный срез: книги, сделки, ликвидации, журнал дыр, здоровье."""

from __future__ import annotations

import json
import threading
from collections import defaultdict, deque
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from obheat.book import L2Book
from obheat.buckets import aggregate, sample_ladder
from obheat.liquidity import WallBook, build_snapshot, estimate_liquidations, top_walls
from obheat.normalize import ContractSpec
from obheat.rest import governor
from obheat.store import HourStore
from obheat.symbols import ALL, BAND, PRICE_STEP, step_of


class Tape:
    def __init__(self) -> None:
        self.buy_coin = Decimal(0)
        self.sell_coin = Decimal(0)
        self.buy_usd = Decimal(0)
        self.sell_usd = Decimal(0)
        self.liq_buy_coin = Decimal(0)
        self.liq_sell_coin = Decimal(0)
        self.liq_buy_usd = Decimal(0)
        self.liq_sell_usd = Decimal(0)
        self.prints: list[dict] = []
        self.liquidations: list[dict] = []

    def add_trade(self, side: str, coin: Decimal, usd: Decimal, price: Decimal, venue: str) -> None:
        if side == "buy":
            self.buy_coin += coin
            self.buy_usd += usd
        else:
            self.sell_coin += coin
            self.sell_usd += usd
        self.prints.append(
            {"venue": venue, "side": side, "price": float(price), "coin": float(coin), "usd": float(usd)}
        )

    def add_liquidation(self, side: str, coin: Decimal, usd: Decimal, price: Decimal, venue: str) -> None:
        if side == "buy":
            self.liq_buy_coin += coin
            self.liq_buy_usd += usd
        else:
            self.liq_sell_coin += coin
            self.liq_sell_usd += usd
        self.liquidations.append(
            {"venue": venue, "side": side, "price": float(price), "coin": float(coin), "usd": float(usd)}
        )

    def take(self) -> Tape:
        taken = Tape()
        taken.__dict__.update(self.__dict__)
        taken.prints = list(self.prints)
        taken.liquidations = list(self.liquidations)
        self.__init__()
        return taken


def _sum_tapes(tapes: list[Tape]) -> Tape:
    total = Tape()
    for tape in tapes:
        total.buy_coin += tape.buy_coin
        total.sell_coin += tape.sell_coin
        total.buy_usd += tape.buy_usd
        total.sell_usd += tape.sell_usd
        total.liq_buy_coin += tape.liq_buy_coin
        total.liq_sell_coin += tape.liq_sell_coin
        total.liq_buy_usd += tape.liq_buy_usd
        total.liq_sell_usd += tape.liq_sell_usd
        total.prints.extend(tape.prints)
        total.liquidations.extend(tape.liquidations)
    return total


class Engine:
    def __init__(self, data_dir: Path, specs: dict[tuple[str, str], ContractSpec]) -> None:
        self.data_dir = Path(data_dir)
        self.specs = specs
        self.symbols = tuple(sorted({symbol for _, symbol in specs}))
        self.venues = tuple(sorted({venue for venue, _ in specs}))
        self.books = {(venue, symbol): L2Book(venue, symbol) for venue, symbol in specs}
        self.tapes = {(venue, symbol): Tape() for venue, symbol in specs}
        self.funding: dict[tuple[str, str], Decimal] = {}
        self.open_interest: dict[tuple[str, str], Decimal] = {}
        self.funding_dirty: set[tuple[str, str]] = set()
        self.oi_dirty: set[tuple[str, str]] = set()
        self.store = HourStore(self.data_dir / "data")
        self.gaps: list[dict] = []
        self._gap_lines: list[str] = []
        self._lock = threading.Lock()
        self.walls = WallBook()
        self.recent_trades: dict[tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=240))
        self._minute_rows: dict[tuple, list[dict]] = defaultdict(list)
        self.started_at = datetime.now(timezone.utc)
        self.last_msg: dict[str, datetime | None] = {venue: None for venue in self.venues}
        self.last_book: dict[str, datetime | None] = {venue: None for venue in self.venues}
        self.venue_mode: dict[str, str] = {venue: "full" for venue in self.venues}
        self.samples = 0
        self.write_meta()

    def write_meta(self) -> None:
        payload = {
            "price_step": {symbol: str(step) for symbol, step in PRICE_STEP.items() if symbol in self.symbols},
            "band_pct": str(BAND),
            "usd_basis": "mid",
            "symbols": list(self.symbols),
            "venues": list(self.venues),
            "contracts": {f"{spec.venue}:{spec.symbol}": spec.as_meta() for spec in self.specs.values()},
            "okx_checksum": "ignored; continuity is seqId/prevSeqId; checksum is 0 since 2026-06-23",
        }
        _atomic_text(self.data_dir / "meta.json", json.dumps(payload, ensure_ascii=False, indent=2))

    def touch(self, venue: str, when: datetime | None = None) -> None:
        self.last_msg[venue] = when or datetime.now(timezone.utc)

    def mark_unavailable(self, venue: str, reason: str) -> None:
        governor(venue).mark_unavailable(reason)
        self.touch(venue)

    def set_venue_mode(self, venue: str, mode: str) -> None:
        if venue in self.venue_mode:
            self.venue_mode[venue] = mode

    def book(self, venue: str, symbol: str) -> L2Book:
        return self.books[(venue, symbol)]

    def observe(self, venue: str, symbol: str, result_kind: str, detail: str, seq: int | None, prev_seq: int | None) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            self._observe(venue, symbol, result_kind, detail, seq, prev_seq, now)

    def _observe(self, venue: str, symbol: str, result_kind: str, detail: str, seq: int | None, prev_seq: int | None, now: datetime) -> None:
        self.touch(venue, now)
        book = self.books[(venue, symbol)]
        if book.status == "VALID" and result_kind in {"snapshot", "update"}:
            self.last_book[venue] = now
        if result_kind == "gap":
            # One line per venue/symbol per second. A pu-storm while the loop
            # was blocked used to append on every diff and stall the sockets.
            signature = (venue, symbol, detail)
            if any(item.get("signature") == signature and (now - item["ts"]).total_seconds() < 1 for item in self.gaps[-8:]):
                return
            self.gaps.append(
                {
                    "ts": now,
                    "venue": venue,
                    "symbol": symbol,
                    "detail": detail,
                    "seq": seq,
                    "prev_seq": prev_seq,
                    "signature": signature,
                }
            )
            self._gap_lines.append(f"{now.isoformat()} {venue} {symbol} gap {detail}\n")

    def add_trade(self, venue: str, symbol: str, side: str, raw_qty: Decimal, price: Decimal) -> None:
        spec = self.specs[(venue, symbol)]
        coin = spec.to_coin(raw_qty)
        usd = spec.to_usd(raw_qty, price)
        if coin is None or usd is None:
            return
        with self._lock:
            self.tapes[(venue, symbol)].add_trade(side, coin, usd, price, venue)
            self.touch(venue)

    def add_liquidation(self, venue: str, symbol: str, side: str, raw_qty: Decimal, price: Decimal) -> None:
        spec = self.specs[(venue, symbol)]
        coin = spec.to_coin(raw_qty)
        usd = spec.to_usd(raw_qty, price)
        if coin is None or usd is None:
            return
        with self._lock:
            self.tapes[(venue, symbol)].add_liquidation(side, coin, usd, price, venue)
            self.touch(venue)

    def add_funding(self, venue: str, symbol: str, rate: Decimal | None) -> None:
        if rate is None:
            return
        self.funding[(venue, symbol)] = rate
        self.funding_dirty.add((venue, symbol))
        self.touch(venue)

    def add_open_interest(self, venue: str, symbol: str, oi: Decimal | None) -> None:
        if oi is None:
            return
        self.open_interest[(venue, symbol)] = oi
        self.oi_dirty.add((venue, symbol))
        self.touch(venue)

    def sample(self, second: int) -> dict:
        """Закрыть секунду `second` (unix). Нечестная книга → null в корзинах.

        Parquet и JSON пишутся после снимка книг, не на event loop: collect
        вызывает sample через asyncio.to_thread. Замок книги и замок ленты
        не берутся одновременно, чтобы ресинк не встал напротив сэмпла.
        """
        rows, payload, gap_lines = self._capture(second)
        self._persist(rows, payload, gap_lines)
        return payload

    def _capture(self, second: int) -> tuple[list[dict], dict, list[str]]:
        ts = datetime.fromtimestamp(second, timezone.utc)
        columns: dict[str, dict] = defaultdict(dict)
        rows: list[dict] = []
        for symbol in self.symbols:
            step = step_of(symbol)
            ladders = []
            taken = []
            venues = [venue for venue in self.venues if (venue, symbol) in self.books]
            for venue in venues:
                book = self.books[(venue, symbol)]
                ladder = sample_ladder(book, self.specs[(venue, symbol)], step)
                with self._lock:
                    tape = self.tapes[(venue, symbol)].take()
                ladders.append(ladder)
                taken.append(tape)
                book.end_second()
                row = _second_row(ts, venue, symbol, ladder, tape, self._funding(venue, symbol), self._oi(venue, symbol))
                rows.append(row)
                rows.extend(_print_rows(ts, venue, symbol, tape))
                column = ladder.column(second, venue, symbol, tape.prints, tape.liquidations)
                columns[symbol][venue] = column
                if tape.prints:
                    self.recent_trades[(symbol, venue)].append({"ts": second, "trades": list(tape.prints)})
            merged = aggregate(ladders, step)
            merged_tape = _sum_tapes(taken)
            rows.append(_second_row(ts, ALL, symbol, merged, merged_tape, None, None))
            columns[symbol][ALL] = merged.column(second, ALL, symbol, merged_tape.prints, merged_tape.liquidations)
        with self._lock:
            gaps = list(self.gaps)
            self.gaps.clear()
            self.funding_dirty.clear()
            self.oi_dirty.clear()
            gap_lines = self._gap_lines
            self._gap_lines = []
            self.samples += 1
        for gap in gaps:
            rows.append(_gap_row(gap))
        health = self.health()
        liquidity = self._liquidity(second, columns, health)
        self._roll_minutes(ts, rows)
        payload = {"ts": second, "columns": columns, "health": health, "liquidity": liquidity}
        return rows, payload, gap_lines

    def _roll_minutes(self, ts: datetime, rows: list[dict]) -> list[dict]:
        """Склеить закрытую минуту в одну строку. Длинные окна читают её, не каждую секунду."""
        for row in rows:
            if row.get("row_kind") != "second":
                continue
            minute = ts.replace(second=0, microsecond=0)
            self._minute_rows[(minute, row["venue"], row["symbol"])].append(row)
        if ts.second != 59:
            return []
        closed = ts.replace(second=0, microsecond=0)
        out = []
        for key, bucket in list(self._minute_rows.items()):
            minute, venue, symbol = key
            if minute != closed or not bucket:
                continue
            merged = _merge_second_rows(bucket)
            merged["row_kind"] = "minute"
            out.append(merged)
            self.store.add_minute(merged)
            self._minute_rows.pop(key, None)
        return []

    def _liquidity(self, second: int, columns: dict, health: dict) -> dict:
        freshness = {}
        now = datetime.now(timezone.utc)
        for venue, row in (health.get("venues") or {}).items():
            last = self.last_book.get(venue)
            age = None if last is None else round((now - last).total_seconds(), 3)
            freshness[venue] = {"status": row.get("status"), "age_s": age, "last_book": row.get("last_book")}
        symbols = {}
        for symbol, by_venue in columns.items():
            symbols[symbol] = {}
            for venue, column in by_venue.items():
                if venue == ALL:
                    recent = []
                    for name in self.venues:
                        recent.extend(self.recent_trades.get((symbol, name), ()))
                else:
                    recent = list(self.recent_trades.get((symbol, venue), ()))
                walls = self.walls.observe(second, venue, symbol, top_walls(column, 8))
                clusters = estimate_liquidations(recent)
                symbols[symbol][venue] = build_snapshot(second, symbol, venue, column, walls, clusters, freshness)
        return {"ts": second, "symbols": symbols}

    def _persist(self, rows: list[dict], payload: dict, gap_lines: list[str]) -> None:
        for row in rows:
            if row.get("row_kind") == "minute":
                continue
            self.store.add(row)
        if self.samples % 5 == 0:
            self.store.flush()
        _atomic_text(self.data_dir / "live" / "latest.json", json.dumps(payload, ensure_ascii=False))
        _atomic_text(self.data_dir / "live" / "liquidity.json", json.dumps(payload["liquidity"], ensure_ascii=False))
        _atomic_text(self.data_dir / "health.json", json.dumps(payload["health"], ensure_ascii=False, indent=2))
        if gap_lines:
            path = self.data_dir / "gaps.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.writelines(gap_lines)

    def flush(self) -> None:
        self.store.flush()

    def health(self) -> dict:
        venues = {}
        now = datetime.now(timezone.utc)
        for venue in self.venues:
            book_ok = {}
            detail = ""
            gaps = 0
            ok_count = 0
            for symbol in self.symbols:
                if (venue, symbol) not in self.books:
                    continue
                book = self.books[(venue, symbol)]
                book_ok[symbol] = book.status == "VALID" and not book.needs_resync
                ok_count += int(book_ok[symbol])
                gaps += book.gap_count
                detail = book.detail
            rest = governor(venue).snapshot()
            needs_resync = any(
                self.books[(venue, symbol)].needs_resync
                for symbol in self.symbols
                if (venue, symbol) in self.books
            )
            gov = governor(venue)
            recent_book = self.last_book.get(venue) is not None and (now - self.last_book[venue]).total_seconds() <= 10
            if gov.is_unavailable():
                status = "unavailable"
            elif gov.is_banned():
                status = "rate_limited"
            elif needs_resync:
                status = "resync"
            elif not recent_book:
                status = "stale"
            elif self.venue_mode.get(venue) == "partial":
                status = "partial"
            elif ok_count:
                status = "ok"
            else:
                status = "stale"
            venues[venue] = {
                "status": status,
                "mode": self.venue_mode.get(venue, "full"),
                "gaps": gaps,
                "last_msg": _iso(self.last_msg.get(venue)),
                "last_book": _iso(self.last_book.get(venue)),
                "book_ok": book_ok,
                "detail": detail,
                "rest": rest,
            }
        statuses = [row["status"] for row in venues.values()]
        return {
            "ok": not statuses or any(status == "ok" for status in statuses),
            "degraded": any(status != "ok" for status in statuses),
            "started_at": self.started_at.isoformat(),
            "samples": self.samples,
            "venues": venues,
        }

    def _funding(self, venue: str, symbol: str):
        if (venue, symbol) not in self.funding_dirty:
            return None
        return self.funding.get((venue, symbol))

    def _oi(self, venue: str, symbol: str):
        if (venue, symbol) not in self.oi_dirty:
            return None
        return self.open_interest.get((venue, symbol))

def _print_rows(ts: datetime, venue: str, symbol: str, tape: Tape) -> list[dict]:
    # Схлопнуть принты одной цены и стороны внутри секунды.
    grouped: dict[tuple, list] = {}
    for kind, rows in (("trade", tape.prints), ("liquidation", tape.liquidations)):
        for item in rows:
            key = (kind, item["side"], item["price"])
            slot = grouped.setdefault(key, [Decimal(0), Decimal(0)])
            slot[0] += Decimal(str(item["coin"]))
            slot[1] += Decimal(str(item["usd"]))
    out = []
    for (kind, side, price), (coin, usd) in grouped.items():
        out.append(
            {
                "ts": ts,
                "row_kind": kind,
                "venue": venue,
                "symbol": symbol,
                "price": float(price),
                "side": side,
                "coin": float(coin),
                "usd": float(usd),
            }
        )
    return out


def _merge_second_rows(rows: list[dict]) -> dict:
    honest = [row for row in rows if row.get("book_ok") and row.get("prices")]
    base = dict(honest[-1] if honest else rows[-1])
    if not honest:
        base["book_ok"] = False
        base["prices"] = None
        base["bid_coin"] = base["ask_coin"] = base["bid_usd"] = base["ask_usd"] = None
        base["mid"] = None
        return base
    bids: dict[float, list[float]] = {}
    asks: dict[float, list[float]] = {}
    mids = []
    for row in honest:
        if row.get("mid") is not None:
            mids.append(row["mid"])
        prices = row.get("prices") or []
        for index, price in enumerate(prices):
            bslot = bids.setdefault(price, [0.0, 0.0])
            aslot = asks.setdefault(price, [0.0, 0.0])
            bslot[0] += (row.get("bid_coin") or [0])[index] or 0
            bslot[1] += (row.get("bid_usd") or [0])[index] or 0
            aslot[0] += (row.get("ask_coin") or [0])[index] or 0
            aslot[1] += (row.get("ask_usd") or [0])[index] or 0
    prices = sorted(set(bids) | set(asks))
    base["ts"] = rows[0]["ts"].replace(second=0, microsecond=0)
    base["book_ok"] = True
    base["mid"] = sum(mids) / len(mids) if mids else base.get("mid")
    base["prices"] = prices
    base["bid_coin"] = [bids.get(price, [0, 0])[0] for price in prices]
    base["ask_coin"] = [asks.get(price, [0, 0])[0] for price in prices]
    base["bid_usd"] = [bids.get(price, [0, 0])[1] for price in prices]
    base["ask_usd"] = [asks.get(price, [0, 0])[1] for price in prices]
    for name in (
        "trade_buy_coin",
        "trade_sell_coin",
        "trade_buy_usd",
        "trade_sell_usd",
        "liq_buy_coin",
        "liq_sell_coin",
        "liq_buy_usd",
        "liq_sell_usd",
    ):
        base[name] = sum(float(row.get(name) or 0) for row in rows)
    return base


def _second_row(ts, venue, symbol, ladder, tape: Tape, funding, oi) -> dict:
    prices = bid_coin = ask_coin = bid_usd = ask_usd = None
    visible_bid = visible_ask = mid = None
    book_ok = False
    if ladder.book_ok and ladder.buckets is not None:
        book_ok = True
        mid = float(ladder.mid) if ladder.mid is not None else None
        visible_bid = float(ladder.visible_bid_min) if ladder.visible_bid_min is not None else None
        visible_ask = float(ladder.visible_ask_max) if ladder.visible_ask_max is not None else None
        prices, bid_coin, ask_coin, bid_usd, ask_usd = [], [], [], [], []
        for price in sorted(ladder.buckets):
            bc, ac, bu, au = ladder.buckets[price]
            prices.append(float(price))
            bid_coin.append(float(bc))
            ask_coin.append(float(ac))
            bid_usd.append(float(bu))
            ask_usd.append(float(au))
    return {
        "ts": ts,
        "row_kind": "second",
        "venue": venue,
        "symbol": symbol,
        "book_ok": book_ok,
        "mid": mid,
        "step": float(ladder.step),
        "band_pct": float(BAND),
        "visible_bid_min": visible_bid,
        "visible_ask_max": visible_ask,
        "prices": prices,
        "bid_coin": bid_coin,
        "ask_coin": ask_coin,
        "bid_usd": bid_usd,
        "ask_usd": ask_usd,
        "trade_buy_coin": float(tape.buy_coin),
        "trade_sell_coin": float(tape.sell_coin),
        "trade_buy_usd": float(tape.buy_usd),
        "trade_sell_usd": float(tape.sell_usd),
        "liq_buy_coin": float(tape.liq_buy_coin),
        "liq_sell_coin": float(tape.liq_sell_coin),
        "liq_buy_usd": float(tape.liq_buy_usd),
        "liq_sell_usd": float(tape.liq_sell_usd),
        "funding_rate": None if funding is None else float(funding),
        "open_interest": None if oi is None else float(oi),
    }


def _gap_row(gap: dict) -> dict:
    return {
        "ts": gap["ts"],
        "row_kind": "gap",
        "venue": gap["venue"],
        "symbol": gap["symbol"],
        "book_ok": False,
        "detail": gap["detail"],
        "seq": gap.get("seq"),
        "prev_seq": gap.get("prev_seq"),
    }


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
