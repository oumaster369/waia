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


def read_window(data_dir: Path, symbol: str, venue: str, minutes: int, step: str) -> dict:
    step_s = {"1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300}[step]
    if minutes < 1 or minutes > 4320:
        raise ValueError("minutes must be 1..4320")
    if (minutes * 60) // step_s > 2000:
        raise ValueError("window is too wide; use a coarser step")
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes)
    seconds = _read_rows(data_dir, symbol, venue, start, kinds=("second",))
    if venue == "ALL":
        prints = _read_rows(data_dir, symbol, None, start, kinds=("trade", "liquidation"))
        prints = [row for row in prints if row.get("venue") != "ALL"]
    else:
        prints = _read_rows(data_dir, symbol, venue, start, kinds=("trade", "liquidation"))
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
    for kind in kinds:
        if kind not in {"second", "trade", "liquidation", "gap"}:
            raise ValueError(kind)
    root = Path(data_dir) / "data"
    if not root.exists() or not any(root.glob("date=*/venue=*/symbol=*/*.parquet")):
        return []
    import duckdb

    kind_list = ", ".join(f"'{kind}'" for kind in kinds)
    venue_sql = "" if venue is None else f" AND venue = '{venue}'"
    pattern = (root / "date=*" / "venue=*" / "symbol=*" / "*.parquet").as_posix()
    con = duckdb.connect()
    frame = con.execute(
        f"""
        SELECT *
        FROM read_parquet('{pattern}', union_by_name=true)
        WHERE symbol = '{symbol}'
          AND ts >= ?
          AND row_kind IN ({kind_list})
          {venue_sql}
        ORDER BY ts
        """,
        [start],
    ).to_arrow_table()
    return frame.to_pylist()
