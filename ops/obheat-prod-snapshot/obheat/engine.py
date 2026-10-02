"""Секундный срез: книги, сделки, ликвидации, журнал дыр, здоровье."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from obheat.book import L2Book
from obheat.buckets import aggregate, sample_ladder
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

    def set_venue_mode(self, venue: str, mode: str) -> None:
        if venue in self.venue_mode:
            self.venue_mode[venue] = mode

    def book(self, venue: str, symbol: str) -> L2Book:
        return self.books[(venue, symbol)]

    def observe(self, venue: str, symbol: str, result_kind: str, detail: str, seq: int | None, prev_seq: int | None) -> None:
        now = datetime.now(timezone.utc)
        self.touch(venue, now)
        book = self.books[(venue, symbol)]
        if book.status == "VALID" and result_kind in {"snapshot", "update"}:
            self.last_book[venue] = now
        if result_kind == "gap":
            self.gaps.append(
                {
                    "ts": now,
                    "venue": venue,
                    "symbol": symbol,
                    "detail": detail,
                    "seq": seq,
                    "prev_seq": prev_seq,
                }
            )
            line = f"{now.isoformat()} {venue} {symbol} gap {detail}\n"
            path = self.data_dir / "gaps.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line)

    def add_trade(self, venue: str, symbol: str, side: str, raw_qty: Decimal, price: Decimal) -> None:
        spec = self.specs[(venue, symbol)]
        coin = spec.to_coin(raw_qty)
        usd = spec.to_usd(raw_qty, price)
        if coin is None or usd is None:
            return
        self.tapes[(venue, symbol)].add_trade(side, coin, usd, price, venue)
        self.touch(venue)

    def add_liquidation(self, venue: str, symbol: str, side: str, raw_qty: Decimal, price: Decimal) -> None:
        spec = self.specs[(venue, symbol)]
        coin = spec.to_coin(raw_qty)
        usd = spec.to_usd(raw_qty, price)
        if coin is None or usd is None:
            return
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
        """Закрыть секунду `second` (unix). Нечестная книга → null в корзинах."""
        ts = datetime.fromtimestamp(second, timezone.utc)
        columns: dict[str, dict] = defaultdict(dict)
        for symbol in self.symbols:
            step = step_of(symbol)
            ladders = []
            taken = []
            venues = [venue for venue in self.venues if (venue, symbol) in self.books]
            for venue in venues:
                book = self.books[(venue, symbol)]
                ladder = sample_ladder(book, self.specs[(venue, symbol)], step)
                tape = self.tapes[(venue, symbol)].take()
                ladders.append(ladder)
                taken.append(tape)
                book.end_second()
                row = _second_row(ts, venue, symbol, ladder, tape, self._funding(venue, symbol), self._oi(venue, symbol))
                self.store.add(row)
                self._prints(ts, venue, symbol, tape)
                columns[symbol][venue] = ladder.column(second, venue, symbol, tape.prints, tape.liquidations)
            merged = aggregate(ladders, step)
            merged_tape = _sum_tapes(taken)
            self.store.add(_second_row(ts, ALL, symbol, merged, merged_tape, None, None))
            columns[symbol][ALL] = merged.column(second, ALL, symbol, merged_tape.prints, merged_tape.liquidations)
        for gap in self.gaps:
            self.store.add(_gap_row(gap))
        self.gaps.clear()
        self.funding_dirty.clear()
        self.oi_dirty.clear()
        self.samples += 1
        if self.samples % 5 == 0:
            self.store.flush()
        payload = {"ts": second, "columns": columns, "health": self.health()}
        _atomic_text(self.data_dir / "live" / "latest.json", json.dumps(payload, ensure_ascii=False))
        _atomic_text(self.data_dir / "health.json", json.dumps(payload["health"], ensure_ascii=False, indent=2))
        return payload

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
            banned_until = rest.get("banned_until")
            if banned_until and datetime.fromtimestamp(float(banned_until), timezone.utc) > now:
                status = "banned"
            elif self.venue_mode.get(venue) == "partial":
                status = "partial"
            elif self.last_book.get(venue) is None or (now - self.last_book[venue]).total_seconds() > 10:
                status = "stale"
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
        return {
            "ok": True,
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

    def _prints(self, ts: datetime, venue: str, symbol: str, tape: Tape) -> None:
        # Схлопнуть принты одной цены и стороны внутри секунды.
        grouped: dict[tuple, list] = {}
        for kind, rows in (("trade", tape.prints), ("liquidation", tape.liquidations)):
            for item in rows:
                key = (kind, item["side"], item["price"])
                slot = grouped.setdefault(key, [Decimal(0), Decimal(0)])
                slot[0] += Decimal(str(item["coin"]))
                slot[1] += Decimal(str(item["usd"]))
        for (kind, side, price), (coin, usd) in grouped.items():
            self.store.add(
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
