"""Чтение секундных корзин. Бин 5с/15с суммирует только честные секунды."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path


def bin_columns(columns: list[dict], step_s: int) -> list[dict]:
    if step_s <= 1:
        return columns
    groups: dict[int, list[dict]] = {}
    order: list[int] = []
    for column in columns:
        key = int(column["ts"]) // step_s * step_s
        if key not in groups:
            order.append(key)
            groups[key] = []
        groups[key].append(column)
    return [_merge_bin(key, groups[key]) for key in order]


def _merge_bin(ts: int, columns: list[dict]) -> dict:
    honest = [column for column in columns if column.get("book_ok") and column.get("bids") is not None]
    trades: list = []
    liquidations: list = []
    for column in columns:
        trades.extend(column.get("trades") or [])
        liquidations.extend(column.get("liquidations") or [])
    step = columns[0].get("step") if columns else None
    symbol = columns[0].get("symbol") if columns else None
    venue = columns[0].get("venue") if columns else None
    if not honest:
        return {
            "ts": ts,
            "venue": venue,
            "symbol": symbol,
            "book_ok": False,
            "mid": None,
            "step": step,
            "visible": None,
            "bids": None,
            "asks": None,
            "trades": trades,
            "liquidations": liquidations,
        }
    bids: dict[float, list[float]] = {}
    asks: dict[float, list[float]] = {}
    mids = []
    lo = []
    hi = []
    for column in honest:
        mids.append(column["mid"])
        visible = column.get("visible")
        if visible:
            lo.append(visible[0])
            hi.append(visible[1])
        for price, coin, usd in column.get("bids") or []:
            slot = bids.setdefault(price, [0.0, 0.0])
            slot[0] += coin
            slot[1] += usd
        for price, coin, usd in column.get("asks") or []:
            slot = asks.setdefault(price, [0.0, 0.0])
            slot[0] += coin
            slot[1] += usd
    return {
        "ts": ts,
        "venue": venue,
        "symbol": symbol,
        "book_ok": True,
        "mid": sum(mids) / len(mids),
        "step": step,
        "visible": [min(lo), max(hi)] if lo else None,
        "bids": [[price, slot[0], slot[1]] for price, slot in sorted(bids.items())],
        "asks": [[price, slot[0], slot[1]] for price, slot in sorted(asks.items())],
        "trades": trades,
        "liquidations": liquidations,
    }


def column_from_second(row: dict) -> dict:
    ts = row["ts"]
    if isinstance(ts, datetime):
        unix = int(ts.timestamp())
    else:
        unix = int(ts)
    if not row.get("book_ok") or row.get("prices") is None:
        return {
            "ts": unix,
            "venue": row.get("venue"),
            "symbol": row.get("symbol"),
            "book_ok": False,
            "mid": None,
            "step": row.get("step"),
            "visible": None,
            "bids": None,
            "asks": None,
            "trades": [],
            "liquidations": [],
        }
    prices = list(row["prices"] or [])
    bid_coin = list(row["bid_coin"] or [])
    ask_coin = list(row["ask_coin"] or [])
    bid_usd = list(row["bid_usd"] or [])
    ask_usd = list(row["ask_usd"] or [])
    bids = []
    asks = []
    for index, price in enumerate(prices):
        if bid_usd[index] or bid_coin[index]:
            bids.append([price, bid_coin[index], bid_usd[index]])
        if ask_usd[index] or ask_coin[index]:
            asks.append([price, ask_coin[index], ask_usd[index]])
    visible = None
    if row.get("visible_bid_min") is not None and row.get("visible_ask_max") is not None:
        visible = [row["visible_bid_min"], row["visible_ask_max"]]
    return {
        "ts": unix,
        "venue": row.get("venue"),
        "symbol": row.get("symbol"),
        "book_ok": True,
        "mid": row.get("mid"),
        "step": row.get("step"),
        "visible": visible,
        "bids": bids,
        "asks": asks,
        "trades": [],
        "liquidations": [],
    }


def read_window(
    data_dir: Path,
    symbol: str,
    venue: str,
    minutes: int,
    step: str,
    include_prints: bool = True,
) -> dict:
    step_s = {"1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300}[step]
    if minutes < 1 or minutes > 4320:
        raise ValueError("minutes must be 1..4320")
    if (minutes * 60) // step_s > 2000:
        raise ValueError("window is too wide; use a coarser step")
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes)
    # Minute sidecars cover 1m/5m once they span the window. A partial backfill
    # must not hide the older per-second files.
    seconds = []
    if step_s >= 60:
        minutes_rows = _read_rows(data_dir, symbol, venue, start, kinds=("minute",))
        if _covers(minutes_rows, start, step_s):
            tail_at = _as_datetime(minutes_rows[-1]["ts"]) + timedelta(seconds=60)
            tail = _read_rows(data_dir, symbol, venue, tail_at, kinds=("second",)) if tail_at < end else []
            seconds = minutes_rows + tail
    if not seconds:
        seconds = _read_rows(data_dir, symbol, venue, start, kinds=("second",))
    prints: list[dict] = []
    if include_prints:
        # The liquidation model only looks at the recent edge, not the whole window.
        print_start = max(start, end - timedelta(seconds=900))
        if venue == "ALL":
            prints = _read_rows(data_dir, symbol, None, print_start, kinds=("trade", "liquidation"))
            prints = [row for row in prints if row.get("venue") != "ALL"]
        else:
            prints = _read_rows(data_dir, symbol, venue, print_start, kinds=("trade", "liquidation"))
    by_ts: dict[int, dict] = {}
    for row in seconds:
        column = column_from_second(row)
        by_ts[column["ts"]] = column
    for row in prints:
        ts = row["ts"]
        unix = int(ts.timestamp()) if isinstance(ts, datetime) else int(ts)
        column = by_ts.setdefault(
            unix,
            {
                "ts": unix,
                "venue": venue,
                "symbol": symbol,
                "book_ok": False,
                "mid": None,
                "step": None,
                "visible": None,
                "bids": None,
                "asks": None,
                "trades": [],
                "liquidations": [],
            },
        )
        item = {
            "ts": unix,
            "venue": row.get("venue"),
            "side": row.get("side"),
            "price": row.get("price"),
            "coin": row.get("coin"),
            "usd": row.get("usd"),
        }
        key = "trades" if row.get("row_kind") == "trade" else "liquidations"
        column[key].append(item)
    ordered = [by_ts[key] for key in sorted(by_ts)]
    columns = bin_columns(ordered, step_s)
    return {
        "symbol": symbol,
        "venue": venue,
        "step": step,
        "minutes": minutes,
        "columns": columns,
    }


def read_points(data_dir: Path, symbol: str, venue: str, minutes: int, kind: str) -> list[dict]:
    if minutes < 1 or minutes > 4320:
        raise ValueError("minutes must be 1..4320")
    start = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    if venue == "ALL":
        rows = _read_rows(data_dir, symbol, None, start, kinds=(kind,))
        rows = [row for row in rows if row.get("venue") != "ALL"]
    else:
        rows = _read_rows(data_dir, symbol, venue, start, kinds=(kind,))
    points = []
    for row in rows:
        ts = row["ts"]
        unix = int(ts.timestamp()) if isinstance(ts, datetime) else int(ts)
        points.append(
            {
                "ts": unix,
                "venue": row.get("venue"),
                "symbol": symbol,
                "side": row.get("side"),
                "price": row.get("price"),
                "coin": row.get("coin"),
                "usd": row.get("usd"),
            }
        )
    points.sort(key=lambda item: item["ts"])
    return points[-5000:]


def _read_rows(data_dir: Path, symbol: str, venue: str | None, start: datetime, kinds: tuple[str, ...]) -> list[dict]:
    from obheat.symbols import ALL, SYMBOLS, VENUES

    if symbol not in SYMBOLS:
        raise ValueError(f"unknown symbol {symbol}")
    if venue is not None and venue not in (*VENUES, ALL):
        raise ValueError(f"unknown venue {venue}")
    allowed = {"second", "minute", "trade", "liquidation", "gap"}
    for kind in kinds:
        if kind not in allowed:
            raise ValueError(kind)
    root = Path(data_dir) / "data"
    if not root.exists():
        return []
    files = _parquet_files(root, symbol, None if venue in {None, ALL} else venue, minute_only=("minute" in kinds and kinds == ("minute",)))
    if not files:
        return []
    import duckdb

    kind_list = ", ".join(f"'{kind}'" for kind in kinds)
    venue_sql = "" if venue in {None, ALL} else f" AND venue = '{venue}'"
    listed = ", ".join("'" + path.replace("'", "''") + "'" for path in files)
    con = duckdb.connect()
    frame = con.execute(
        f"""
        SELECT ts, row_kind, venue, symbol, book_ok, mid, step,
               visible_bid_min, visible_ask_max,
               prices, bid_coin, ask_coin, bid_usd, ask_usd,
               price, side, coin, usd
        FROM read_parquet([{listed}], union_by_name=true)
        WHERE symbol = '{symbol}'
          AND ts >= ?
          AND row_kind IN ({kind_list})
          {venue_sql}
        ORDER BY ts
        """,
        [start],
    ).to_arrow_table()
    return frame.to_pylist()


def _covers(rows: list[dict], start: datetime, step_s: int) -> bool:
    if not rows:
        return False
    first = _as_datetime(rows[0]["ts"])
    return first <= start + timedelta(seconds=step_s)


def _as_datetime(value) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromtimestamp(int(value), timezone.utc)


def backfill_minutes(data_dir: Path) -> int:
    """Turn legacy HH.parquet hours into HH-minute.parquet once.

    The collector writes minute sidecars for new data. This fills history so
    /heatmap does not rescan every second row. Safe to call repeatedly.
    """
    root = Path(data_dir) / "data"
    if not root.exists():
        return 0
    written = 0
    for path in sorted(root.glob("date=*/venue=*/symbol=*/*.parquet")):
        stem = path.name[:-8] if path.name.endswith(".parquet") else ""
        if not stem.isdigit():
            continue
        target = path.with_name(f"{stem}-minute.parquet")
        if target.exists() and target.stat().st_mtime >= path.stat().st_mtime:
            continue
        rows = _minute_rows_from_hour(path)
        if not rows:
            continue
        from obheat.store import _write

        _write(target, rows)
        written += 1
    return written


def _minute_rows_from_hour(path: Path) -> list[dict]:
    import pyarrow.parquet as pq

    table = pq.read_table(path)
    grouped: dict[datetime, list[dict]] = {}
    for row in table.to_pylist():
        if row.get("row_kind") != "second":
            continue
        ts = _as_datetime(row["ts"])
        minute = ts.replace(second=0, microsecond=0)
        row["ts"] = minute
        grouped.setdefault(minute, []).append(row)
    from obheat.engine import _merge_second_rows

    out = []
    for minute in sorted(grouped):
        merged = _merge_second_rows(grouped[minute])
        merged["row_kind"] = "minute"
        merged["ts"] = minute
        out.append(merged)
    return out


def _parquet_files(root: Path, symbol: str, venue: str | None, minute_only: bool) -> list[str]:
    if venue is None:
        folders = list(root.glob(f"date=*/venue=*/symbol={symbol}"))
    else:
        folders = list(root.glob(f"date=*/venue={venue}/symbol={symbol}"))
    found = []
    for folder in folders:
        for path in folder.glob("*.parquet"):
            name = path.name
            is_minute = name.endswith("-minute.parquet")
            if minute_only != is_minute:
                continue
            found.append(path.as_posix())
    return found
