"""Часовые parquet zstd: date=/venue=/symbol=/HH.parquet.

Секунда без честной книги хранит списки корзин как null, не как нули.

Новые секунды пишутся отдельными частями `HH-p<unix-ms>.parquet` и сразу
выбрасываются из памяти. Старые цельные `HH.parquet` остаются читаемыми:
запрос склеивает оба вида файлов. Часть часа больше не переписывается целиком
на каждой сброске — это и был рост RSS и стопор event loop.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema(
    [
        ("ts", pa.timestamp("ms", tz="UTC")),
        ("row_kind", pa.string()),
        ("venue", pa.string()),
        ("symbol", pa.string()),
        ("book_ok", pa.bool_()),
        ("mid", pa.float64()),
        ("step", pa.float64()),
        ("band_pct", pa.float64()),
        ("visible_bid_min", pa.float64()),
        ("visible_ask_max", pa.float64()),
        ("prices", pa.list_(pa.float64())),
        ("bid_coin", pa.list_(pa.float64())),
        ("ask_coin", pa.list_(pa.float64())),
        ("bid_usd", pa.list_(pa.float64())),
        ("ask_usd", pa.list_(pa.float64())),
        ("trade_buy_coin", pa.float64()),
        ("trade_sell_coin", pa.float64()),
        ("trade_buy_usd", pa.float64()),
        ("trade_sell_usd", pa.float64()),
        ("liq_buy_coin", pa.float64()),
        ("liq_sell_coin", pa.float64()),
        ("liq_buy_usd", pa.float64()),
        ("liq_sell_usd", pa.float64()),
        ("funding_rate", pa.float64()),
        ("open_interest", pa.float64()),
        ("price", pa.float64()),
        ("side", pa.string()),
        ("coin", pa.float64()),
        ("usd", pa.float64()),
        ("detail", pa.string()),
        ("seq", pa.int64()),
        ("prev_seq", pa.int64()),
    ]
)


def hour_path(root: Path, ts: datetime, venue: str, symbol: str) -> Path:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    ts = ts.astimezone(timezone.utc)
    return root / f"date={ts:%Y-%m-%d}" / f"venue={venue}" / f"symbol={symbol}" / f"{ts:%H}.parquet"


def minute_path(root: Path, ts: datetime, venue: str, symbol: str) -> Path:
    """Один файл на час: до 60 минутных строк. Перепись дешёвая."""
    return hour_path(root, ts, venue, symbol).with_name(f"{ts:%H}-minute.parquet")


class HourStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.buffers: dict[tuple, list[dict]] = {}
        self.minutes: dict[tuple, list[dict]] = {}

    def add(self, row: dict) -> None:
        key = self._key(row)
        self.buffers.setdefault(key, []).append(row)

    def add_minute(self, row: dict) -> None:
        key = self._key(row)
        bucket = self.minutes.setdefault(key, [])
        ts = row["ts"]
        bucket[:] = [item for item in bucket if item["ts"] != ts]
        bucket.append(row)
        if len(bucket) > 60:
            del bucket[:-60]

    def flush(self) -> None:
        for key, rows in list(self.buffers.items()):
            if not rows:
                continue
            _hour, _hour2, venue, symbol = key
            stamp = time.time_ns() // 1_000_000
            path = hour_path(self.root, key[0], venue, symbol).with_name(f"{key[0]:%H}-p{stamp}.parquet")
            _write(path, rows)
            rows.clear()
        self.buffers = {key: rows for key, rows in self.buffers.items() if rows}
        for key, rows in list(self.minutes.items()):
            if not rows:
                continue
            _hour, _hour2, venue, symbol = key
            path = minute_path(self.root, key[0], venue, symbol)
            _write(path, rows)
        self._drop_old()

    def pending_rows(self) -> int:
        return sum(len(rows) for rows in self.buffers.values())

    def _key(self, row: dict) -> tuple:
        ts = row["ts"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        hour = ts.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return (hour, hour, row["venue"], row["symbol"])

    def _drop_old(self) -> None:
        if not self.minutes:
            return
        newest = max(key[0] for key in self.minutes)
        for key in list(self.minutes):
            if (newest - key[0]).total_seconds() > 7200:
                self.minutes.pop(key, None)


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(_normalize(rows), schema=SCHEMA)
    tmp = path.with_suffix(path.suffix + ".tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)


def _normalize(rows: list[dict]) -> list[dict]:
    names = SCHEMA.names
    out = []
    for row in rows:
        item = {name: row.get(name) for name in names}
        ts = item["ts"]
        if isinstance(ts, datetime) and ts.tzinfo is None:
            item["ts"] = ts.replace(tzinfo=timezone.utc)
        out.append(item)
    return out
