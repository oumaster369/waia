"""Часовые parquet zstd: date=/venue=/symbol=/HH.parquet.

Секунда без честной книги хранит списки корзин как null, не как нули.
"""

from __future__ import annotations

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


class HourStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.buffers: dict[tuple, list[dict]] = {}
        self.loaded: set[tuple] = set()

    def add(self, row: dict) -> None:
        key = self._key(row)
        if key not in self.buffers:
            self.buffers[key] = self._load(key, row["ts"], row["venue"], row["symbol"])
            self.loaded.add(key)
        self.buffers[key].append(row)

    def flush(self) -> None:
        for key, rows in list(self.buffers.items()):
            _ts, venue, symbol = key[1], key[2], key[3]
            path = hour_path(self.root, key[0], venue, symbol)
            _write(path, rows)
        self._drop_old()

    def _key(self, row: dict) -> tuple:
        ts = row["ts"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        hour = ts.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return (hour, hour, row["venue"], row["symbol"])

    def _load(self, key: tuple, ts: datetime, venue: str, symbol: str) -> list[dict]:
        path = hour_path(self.root, ts, venue, symbol)
        if not path.exists():
            return []
        table = pq.read_table(path, schema=SCHEMA)
        return table.to_pylist()

    def _drop_old(self) -> None:
        if not self.buffers:
            return
        newest = max(key[0] for key in self.buffers)
        for key in list(self.buffers):
            if (newest - key[0]).total_seconds() > 7200:
                self.buffers.pop(key, None)


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(_normalize(rows), schema=SCHEMA)
    tmp = path.with_suffix(".parquet.tmp")
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
