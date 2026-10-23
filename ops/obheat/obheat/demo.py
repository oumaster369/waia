"""Синтетический прогон без биржи: проверка страницы и оценка объёма parquet."""

from __future__ import annotations

import argparse
import time
from decimal import Decimal
from pathlib import Path

from obheat.engine import Engine
from obheat.normalize import ContractSpec
from obheat.symbols import SYMBOLS, VENUES


def _specs() -> dict[tuple[str, str], ContractSpec]:
    size = {
        ("BINANCE", "BTCUSDT"): Decimal("1"),
        ("BYBIT", "BTCUSDT"): Decimal("1"),
        ("OKX", "BTCUSDT"): Decimal("0.01"),
        ("HTX", "BTCUSDT"): Decimal("0.001"),
        ("BINANCE", "ETHUSDT"): Decimal("1"),
        ("BYBIT", "ETHUSDT"): Decimal("1"),
        ("OKX", "ETHUSDT"): Decimal("0.1"),
        ("HTX", "ETHUSDT"): Decimal("0.01"),
    }
    specs = {}
    for (venue, symbol), contract_size in size.items():
        specs[(venue, symbol)] = ContractSpec(venue, symbol, True, False, contract_size, symbol[:3])
    return specs


def _seed(engine: Engine, symbol: str, mid: Decimal, version: int) -> None:
    for venue, spec in ((venue, engine.specs[(venue, symbol)]) for venue in VENUES):
        raw = lambda coin: coin / spec.contract_size  # noqa: E731
        book = engine.book(venue, symbol)
        bids = [(mid - Decimal("0.1") * index, raw(Decimal("0.4") + Decimal(index) / Decimal(50))) for index in range(1, 31)]
        asks = [(mid + Decimal("0.1") * index, raw(Decimal("0.35") + Decimal(index) / Decimal(40))) for index in range(1, 31)]
        # Стена, которая стоит много секунд, и односекундный спуф.
        wall = mid - Decimal("20") if symbol == "BTCUSDT" else mid - Decimal("2")
        bids.append((wall, raw(Decimal("8"))))
        if version == 10:
            bids.append((mid - Decimal("8"), raw(Decimal("25"))))
        if venue == "BINANCE":
            book.apply_binance_snapshot(version, bids, asks)
        elif venue == "BYBIT":
            book.apply_bybit("snapshot", version, bids, asks)
        elif venue == "OKX":
            book.apply_okx("snapshot", version, -1, bids, asks, checksum=0)
        else:
            book.apply_htx("snapshot", version, bids, asks)
        if version % 7 == 0:
            engine.add_trade(venue, symbol, "buy" if version % 14 else "sell", raw(Decimal("0.2")), mid)
        if version % 40 == 0:
            engine.add_liquidation(venue, symbol, "sell", raw(Decimal("1.5")), mid - Decimal("1"))


def run(data_dir: Path, seconds: int, sleep: float, origin: int) -> None:
    engine = Engine(data_dir, _specs())
    for index in range(seconds):
        for symbol, base in (("BTCUSDT", Decimal("100000")), ("ETHUSDT", Decimal("3500"))):
            mid = base + Decimal(index) / Decimal(5)
            if index == 30:
                for venue in VENUES:
                    engine.book(venue, symbol).clear_gap("demo gap")
                    engine.observe(venue, symbol, "gap", "demo gap", None, None)
            else:
                _seed(engine, symbol, mid, index + 1)
        engine.sample(origin + index)
        if sleep:
            time.sleep(sleep)
    engine.flush()
    root = data_dir / "data"
    total = sum(path.stat().st_size for path in root.rglob("*.parquet"))
    per_day = total / seconds * 86400 if seconds else 0
    print(f"seconds={seconds} parquet_bytes={total} extrapolated_bytes_per_day={per_day:.0f}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Synthetic OB-HEATMAP run")
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=600)
    parser.add_argument("--sleep", type=float, default=0.0)
    parser.add_argument("--origin", type=int, default=0, help="unix-секунда первой колонки; 0 = сейчас минус длина прогона")
    args = parser.parse_args(argv)
    if args.seconds < 1:
        raise SystemExit("--seconds must be >= 1")
    origin = args.origin or int(time.time()) - args.seconds + 1
    run(args.data_dir, args.seconds, args.sleep, origin)


if __name__ == "__main__":
    main()
