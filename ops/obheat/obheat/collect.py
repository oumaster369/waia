"""Сборщик L2, сделок, ликвидаций, фандинга и OI. Секундные корзины в parquet."""

from __future__ import annotations

import argparse
import asyncio
import atexit
import logging
import os
import time
from pathlib import Path

from obheat.engine import Engine
from obheat.normalize import load_ccxt_specs
from obheat.symbols import SYMBOLS, VENUES

LOG = logging.getLogger("obheat.collect")


def _split(value: str, allowed: tuple[str, ...]) -> tuple[str, ...]:
    items = tuple(part.strip().upper() for part in value.split(",") if part.strip())
    unknown = [item for item in items if item not in allowed]
    if unknown:
        raise SystemExit(f"unknown: {', '.join(unknown)}")
    return items


async def _sample_loop(engine: Engine) -> None:
    last = -1
    while True:
        now = time.time()
        await asyncio.sleep(max(0.05, 1.0 - (now % 1.0)))
        second = int(time.time()) - 1
        if second == last:
            continue
        try:
            # Parquet and JSON stay off the websocket thread. A flush that
            # rewrote the whole hour used to block pongs and drop sequence.
            await asyncio.to_thread(engine.sample, second)
        except Exception:
            LOG.exception("sample failed")
        last = second
        if engine.samples % 30 == 0:
            health = engine.health()
            LOG.info(
                "health samples=%s %s",
                health["samples"],
                " ".join(f"{name}:gaps={row['gaps']}:book={row['last_book']}" for name, row in health["venues"].items()),
            )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="OB-HEATMAP collector")
    parser.add_argument("--data-dir", default=os.environ.get("OBHEAT_DATA", "/srv/obheat"))
    parser.add_argument("--symbols", default=os.environ.get("OBHEAT_SYMBOLS", ",".join(SYMBOLS)))
    parser.add_argument("--venues", default=os.environ.get("OBHEAT_VENUES", ",".join(VENUES)))
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=os.environ.get("OBHEAT_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    symbols = _split(args.symbols, SYMBOLS)
    venues = _split(args.venues, VENUES)
    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    specs = load_ccxt_specs(symbols, venues)
    if not specs:
        raise SystemExit("no linear contract specs; nothing to collect")
    engine = Engine(data_dir, specs)
    atexit.register(engine.flush)
    LOG.info("contracts %s", ", ".join(f"{v}:{s}={spec.contract_size}" for (v, s), spec in sorted(specs.items())))
    from obheat.feeds import build_handler

    handler = build_handler(engine, list(symbols))
    if not handler.feeds:
        raise SystemExit("no feeds")
    feed = handler.feeds[0]
    start = feed.start

    def start_with_sampler(loop) -> None:
        loop.create_task(_sample_loop(engine))
        if hasattr(handler, "obheat_native_start"):
            handler.obheat_native_start(engine, list(symbols), loop)
        start(loop)

    feed.start = start_with_sampler
    LOG.info("collector starting, data=%s", data_dir)
    try:
        handler.run()
    finally:
        engine.flush()


if __name__ == "__main__":
    main()
