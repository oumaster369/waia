"""Локальные книги четырёх площадок.

Дыра последовательности стирает книгу. Пока не придёт новый снимок, книга
пустая: секунда пишется как null, не как ноль. Checksum OKX не используется:
с 23.06.2026 в JSON-каналах books он всегда 0, непрерывность — seqId/prevSeqId.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from decimal import Decimal

VALID = "VALID"
INVALID = "INVALID"
WAITING = "WAITING"


@dataclass(frozen=True)
class ApplyResult:
    kind: str
    detail: str = ""


def _dec(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _levels(levels) -> list[tuple[Decimal, Decimal]]:
    out = []
    for level in levels or []:
        out.append((_dec(level[0]), _dec(level[1])))
    return out


class L2Book:
    def __init__(self, venue: str, symbol: str) -> None:
        self.venue = venue
        self.symbol = symbol
        self.bids: dict[Decimal, Decimal] = {}
        self.asks: dict[Decimal, Decimal] = {}
        self.status = WAITING
        self.last_seq: int | None = None
        self.gap_count = 0
        self.crossed_count = 0
        self.detail = "waiting for snapshot"
        self.needs_resync = False
        self.gapped_this_second = False
        self.lock = threading.RLock()

    def honest(self) -> bool:
        with self.lock:
            if self.gapped_this_second or self.status != VALID:
                return False
            if not self.bids or not self.asks:
                return False
            return max(self.bids) < min(self.asks)

    def end_second(self) -> None:
        with self.lock:
            self.gapped_this_second = False

    def clear_gap(self, detail: str) -> ApplyResult:
        with self.lock:
            return self._clear_gap(detail)

    def _clear_gap(self, detail: str) -> ApplyResult:
        self.gap_count += 1
        self.bids.clear()
        self.asks.clear()
        self.last_seq = None
        self.status = INVALID
        self.needs_resync = True
        self.gapped_this_second = True
        self.detail = detail
        return ApplyResult("gap", detail)

    def _replace(self, bids, asks) -> None:
        self.bids = {}
        self.asks = {}
        self._side(self.bids, bids)
        self._side(self.asks, asks)

    def _merge(self, bids, asks) -> None:
        with self.lock:
            self._side(self.bids, bids)
            self._side(self.asks, asks)

    def _side(self, book: dict[Decimal, Decimal], levels) -> None:
        for price, qty in _levels(levels):
            if qty == 0:
                book.pop(price, None)
            elif qty > 0:
                book[price] = qty

    def _finish(self, kind: str, detail: str, seq: int) -> ApplyResult:
        with self.lock:
            return self._finish_locked(kind, detail, seq)

    def _finish_locked(self, kind: str, detail: str, seq: int) -> ApplyResult:
        self.last_seq = int(seq)
        self.needs_resync = False
        if self.bids and self.asks and max(self.bids) >= min(self.asks):
            self.crossed_count += 1
            self.bids.clear()
            self.asks.clear()
            self.status = INVALID
            self.needs_resync = True
            self.gapped_this_second = True
            self.detail = "crossed book"
            return ApplyResult("gap", "crossed book")
        if not self.bids or not self.asks:
            self.status = INVALID
            self.needs_resync = True
            self.detail = "empty side"
            return ApplyResult("ignored", "empty side")
        self.status = VALID
        self.detail = detail
        return ApplyResult(kind, detail)

    def apply_binance_snapshot(self, last_update_id: int, bids, asks) -> ApplyResult:
        with self.lock:
            self._replace(bids, asks)
            return self._finish_locked("snapshot", "binance snapshot", int(last_update_id))

    def apply_binance_first_diff(self, last_update_id: int, first_id: int, final_id: int, bids, asks) -> ApplyResult:
        """Bootstrap Binance after REST snapshot: U <= lastUpdateId+1 <= u."""
        target = int(last_update_id) + 1
        first_id = int(first_id)
        final_id = int(final_id)
        with self.lock:
            if not (first_id <= target <= final_id):
                return self._clear_gap(f"binance first diff {first_id}..{final_id} misses {target}")
            self._side(self.bids, bids)
            self._side(self.asks, asks)
            return self._finish_locked("update", "binance first diff", final_id)

    def apply_binance_diff(self, first_id: int, final_id: int, prev_u: int | None, bids, asks) -> ApplyResult:
        """USD-M: pu обязан совпасть с u предыдущего события. Иначе книга пустая."""
        with self.lock:
            if self.status != VALID or self.last_seq is None:
                return ApplyResult("ignored", "diff before snapshot")
            final_id = int(final_id)
            first_id = int(first_id)
            if final_id < self.last_seq:
                return ApplyResult("late", "late diff")
            if prev_u is not None:
                if int(prev_u) != self.last_seq:
                    return self._clear_gap(f"binance pu {int(prev_u)} != {self.last_seq}")
            elif first_id > self.last_seq + 1:
                return self._clear_gap(f"binance gap U {first_id} > {self.last_seq}+1")
            self._side(self.bids, bids)
            self._side(self.asks, asks)
            return self._finish_locked("update", "binance diff", final_id)

    def apply_bybit(self, kind: str, update_id: int, bids, asks) -> ApplyResult:
        """u идёт подряд. seq может перескакивать — им дыру не ловим. u=1 на дельте сбрасывает книгу."""
        update_id = int(update_id)
        if kind != "snapshot" and update_id == 1:
            return self.clear_gap("bybit u=1 reset")
        if kind == "snapshot":
            jumped = self.last_seq is not None and update_id not in (self.last_seq, self.last_seq + 1)
            self._replace(bids, asks)
            result = self._finish("snapshot", "bybit snapshot", update_id)
            if jumped and result.kind == "snapshot":
                self.gap_count += 1
                self.gapped_this_second = True
                self.detail = f"bybit snapshot healed gap -> {update_id}"
            return result
        if self.status != VALID or self.last_seq is None:
            return ApplyResult("ignored", "delta before snapshot")
        if update_id == self.last_seq:
            return ApplyResult("late", "duplicate u")
        if update_id != self.last_seq + 1:
            return self.clear_gap(f"bybit u {update_id} != {self.last_seq}+1")
        self._merge(bids, asks)
        return self._finish("update", "bybit delta", update_id)

    def apply_okx(self, action: str, seq_id: int, prev_seq_id: int, bids, asks, checksum=0) -> ApplyResult:
        """checksum игнорируется (с 23.06.2026 он 0). Непрерывность: prevSeqId == прошлый seqId."""
        del checksum  # поле остаётся в сообщениях, но не проверяется
        seq_id = int(seq_id)
        prev_seq_id = int(prev_seq_id)
        if action == "snapshot" or prev_seq_id == -1:
            self._replace(bids, asks)
            return self._finish("snapshot", "okx snapshot", seq_id)
        if self.status != VALID or self.last_seq is None:
            return ApplyResult("ignored", "update before snapshot")
        if seq_id == self.last_seq and prev_seq_id == self.last_seq:
            return ApplyResult("late", "duplicate seq")
        if prev_seq_id != self.last_seq:
            return self.clear_gap(f"okx prevSeqId {prev_seq_id} != {self.last_seq}")
        self._merge(bids, asks)
        return self._finish("update", "okx update", seq_id)

    def apply_htx(self, event: str, version: int, bids, asks) -> ApplyResult:
        """high_freq: update — version == last+1, иначе дыра. snapshot заменяет книгу."""
        version = int(version)
        event = event or "snapshot"
        if event == "snapshot":
            if self.last_seq is not None and version < self.last_seq:
                return ApplyResult("late", "late snapshot")
            if self.last_seq is not None and version == self.last_seq:
                return ApplyResult("late", "duplicate snapshot")
            jumped = self.last_seq is not None and version > self.last_seq + 1
            self._replace(bids, asks)
            result = self._finish("snapshot", "htx snapshot", version)
            if jumped and result.kind == "snapshot":
                self.gap_count += 1
                self.gapped_this_second = True
                self.detail = f"htx snapshot healed {version}"
            return result
        if self.status != VALID or self.last_seq is None:
            return ApplyResult("ignored", "update before snapshot")
        if version == self.last_seq:
            return ApplyResult("late", "duplicate update")
        if version < self.last_seq:
            return ApplyResult("late", "late update")
        if version != self.last_seq + 1:
            return self.clear_gap(f"htx version {version} != {self.last_seq}+1")
        self._merge(bids, asks)
        return self._finish("update", "htx update", version)


class BinanceSync:
    """Official Binance diff-depth sync with a bounded REST snapshot path.

    Algorithm:
    1. Buffer websocket events while waiting for a REST snapshot.
    2. Drop events with u < lastUpdateId + 1.
    3. The first kept event must satisfy U <= lastUpdateId + 1 <= u.
    4. For USD-M futures every following event must have pu == previous u.
    """

    def __init__(self, book: L2Book) -> None:
        self.book = book
        self.pending: list[dict] = []
        self.awaiting = True
        self.snapshot_id: int | None = None

    def on_diff(self, msg: dict) -> list[ApplyResult]:
        if self.awaiting:
            self.pending.append(msg)
            if self.snapshot_id is not None:
                return self._drain()
            return [ApplyResult("ignored", "buffered")]
        if self.book.status != VALID or self.book.needs_resync:
            self.pending.append(msg)
            self.awaiting = True
            return [ApplyResult("ignored", "buffered")]
        result = self._apply(msg)
        if result.kind == "gap":
            self.pending.append(msg)
            self.awaiting = True
            self.snapshot_id = None
        return [result]

    def on_snapshot(self, last_update_id: int, bids, asks) -> list[ApplyResult]:
        self.snapshot_id = int(last_update_id)
        result = self.book.apply_binance_snapshot(last_update_id, bids, asks)
        if result.kind != "snapshot":
            self.awaiting = True
            return [result]
        # Do not expose a snapshot-only Binance book as synced. It becomes valid
        # only after the first buffered websocket diff bridges lastUpdateId + 1.
        self.book.status = WAITING
        self.book.needs_resync = True
        self.book.detail = "waiting for first binance diff after snapshot"
        return [result, *self._drain()]

    def _drain(self) -> list[ApplyResult]:
        if self.snapshot_id is None:
            return [ApplyResult("ignored", "buffered")]
        pending, self.pending = self.pending, []
        results: list[ApplyResult] = []
        target = self.snapshot_id + 1
        first_seen = self.book.status == VALID and self.book.last_seq is not None and self.book.last_seq >= target
        for msg in pending:
            if int(msg["u"]) < target:
                results.append(ApplyResult("late", "before snapshot"))
                continue
            if not first_seen:
                if int(msg["U"]) <= target <= int(msg["u"]):
                    result = self.book.apply_binance_first_diff(
                        self.snapshot_id,
                        int(msg["U"]),
                        int(msg["u"]),
                        msg.get("b") or msg.get("bids") or [],
                        msg.get("a") or msg.get("asks") or [],
                    )
                    results.append(result)
                    if result.kind == "update":
                        first_seen = True
                        self.awaiting = False
                    else:
                        self.awaiting = True
                        self.snapshot_id = None
                        break
                else:
                    results.append(ApplyResult("ignored", f"waiting for first diff covering {target}"))
                    self.awaiting = True
                    break
                continue
            result = self._apply(msg)
            results.append(result)
            if result.kind == "gap":
                self.awaiting = True
                self.snapshot_id = None
                break
        if not first_seen:
            self.awaiting = True
        return results or [ApplyResult("ignored", "buffered")]

    def _apply(self, msg: dict) -> ApplyResult:
        prev = msg.get("pu")
        prev_u = int(prev) if prev is not None else None
        return self.book.apply_binance_diff(
            int(msg["U"]),
            int(msg["u"]),
            prev_u,
            msg.get("b") or msg.get("bids") or [],
            msg.get("a") or msg.get("asks") or [],
        )
