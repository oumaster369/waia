"""Command line: backfill, historical, live, report."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from research.forecast_journal.config import (
    DEFAULT_TAKER_FEE,
    UNIVERSE,
    default_data_dir,
    default_journal_dir,
    default_report_dir,
)
from research.forecast_journal.data.loader import backfill, load_cache
from research.forecast_journal.journal.store import JournalStore, reality_id
from research.forecast_journal.metrics.report import write_reports
from research.forecast_journal.pipeline import public_payload, run_study
from research.forecast_journal.util import dump_json, feature_hash, forecast_id, iso_utc, parse_utc_date


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.forecast_journal")
    sub = parser.add_subparsers(dest="cmd", required=True)

    back = sub.add_parser("backfill", help="Download HTX public history into the cache")
    _add_data_args(back)
    back.add_argument("--minute-from", default=None, help="Start of 1m history. Defaults to --from.")
    back.add_argument("--timeframes", default="4h,1h,15m,1m")
    back.add_argument("--workers", type=int, default=4)
    back.add_argument("--no-okx", action="store_true")

    hist = sub.add_parser("historical", help="Walk-forward WAIA-S, then the search if it fails")
    _add_data_args(hist)
    hist.add_argument("--minute-from", default=None)
    hist.add_argument("--download", action="store_true", help="Backfill before the study")
    hist.add_argument("--decisions", default="1h,15m")
    hist.add_argument("--horizon", default="24h")
    hist.add_argument("--fee", type=float, default=DEFAULT_TAKER_FEE)
    hist.add_argument("--holdout", type=float, default=0.2)
    hist.add_argument("--with-gbm", action="store_true")
    hist.add_argument("--journal", default=None)
    hist.add_argument("--report-dir", default=None)

    live = sub.add_parser("live", help="Append forecasts and fill realities")
    _add_data_args(live)
    live.add_argument("--interval", type=int, default=15, help="Minutes between loops")
    live.add_argument("--fee", type=float, default=DEFAULT_TAKER_FEE)
    live.add_argument("--journal", default=None)
    live.add_argument("--report-dir", default=None)
    live.add_argument("--liquidity-url", default=None, help="Base URL; the client calls {url}/api/liquidity?symbol=BTC")
    live.add_argument("--once", action="store_true")

    report = sub.add_parser("report", help="Rebuild the written report from a saved study json if present")
    report.add_argument("--report-dir", default=None)

    sit = sub.add_parser("situations", help="Test S1–S6 situational strategies and regime filters")
    sit.add_argument("--data-dir", default=str(default_data_dir()))
    sit.add_argument("--from", dest="from_date", default="2024-01-01")
    sit.add_argument("--symbols", default="BTC,ETH,SOL")
    sit.add_argument("--timeframes", default="15m,5m,1m")
    sit.add_argument("--fee", type=float, default=DEFAULT_TAKER_FEE)
    sit.add_argument("--report-dir", default=None)

    fol = sub.add_parser("followup", help="Split US releases by surprise sign and compare the two stop filters")
    fol.add_argument("--data-dir", default=str(default_data_dir()))
    fol.add_argument("--from", dest="from_date", default="2024-01-01")
    fol.add_argument("--symbols", default="BTC,ETH,SOL")
    fol.add_argument("--fee", type=float, default=DEFAULT_TAKER_FEE)
    fol.add_argument("--report-dir", default=None)

    args = parser.parse_args(argv)
    if args.cmd == "backfill":
        start, end = _span(args)
        minute = parse_utc_date(args.minute_from) if args.minute_from else start
        backfill(
            Path(args.data_dir),
            symbols=_symbols(args),
            start=start,
            end=end,
            minute_start=minute,
            timeframes=tuple(part.strip() for part in args.timeframes.split(",") if part.strip()),
            include_okx=not args.no_okx,
            workers=args.workers,
        )
        return 0
    if args.cmd == "historical":
        return _historical(args)
    if args.cmd == "live":
        from research.forecast_journal.live import run_forever

        run_forever(
            Path(args.data_dir),
            Path(args.journal) if args.journal else default_journal_dir() / "journal.jsonl",
            Path(args.report_dir) if args.report_dir else default_report_dir(),
            interval_min=args.interval,
            fee=args.fee,
            liquidity_url=args.liquidity_url,
            symbols=_symbols(args),
            once=args.once,
        )
        return 0
    if args.cmd == "situations":
        return _situations(args)
    if args.cmd == "followup":
        return _followup(args)
    if args.cmd == "report":
        report_dir = Path(args.report_dir) if args.report_dir else default_report_dir()
        waia = report_dir / "waia_s.md"
        if not waia.exists():
            print("No report yet. Run historical first.", file=sys.stderr)
            return 1
        print(waia.read_text(encoding="utf-8")[:2000])
        return 0
    return 2


def _followup(args) -> int:
    from research.forecast_journal.intraday.followup import run_followup, write_followup_reports

    report_dir = Path(args.report_dir) if args.report_dir else default_report_dir()
    result = run_followup(
        Path(args.data_dir),
        _symbols(args),
        start=args.from_date,
        fee=args.fee,
    )
    write_followup_reports(result, report_dir)
    print((report_dir / "followup_ru.md").read_text(encoding="utf-8"))
    return 0


def _situations(args) -> int:
    from research.forecast_journal.intraday.reporting import write_situation_reports
    from research.forecast_journal.intraday.situations import run_situations

    report_dir = Path(args.report_dir) if args.report_dir else default_report_dir()
    timeframes = tuple(part.strip() for part in args.timeframes.split(",") if part.strip())
    result = run_situations(
        Path(args.data_dir),
        _symbols(args),
        timeframes=timeframes,
        start=args.from_date,
        fee=args.fee,
    )
    write_situation_reports(result, report_dir)
    text = (report_dir / "situations_ru.md").read_text(encoding="utf-8")
    print(text)
    return 0


def _historical(args) -> int:
    data_dir = Path(args.data_dir)
    if args.download:
        start, end = _span(args)
        minute = parse_utc_date(args.minute_from) if args.minute_from else start
        backfill(
            data_dir,
            symbols=_symbols(args),
            start=start,
            end=end,
            minute_start=minute,
            include_okx=True,
            workers=4,
        )
    data = load_cache(data_dir, _symbols(args))
    decisions = tuple(part.strip() for part in args.decisions.split(",") if part.strip())
    result = run_study(
        data,
        data_dir=data_dir,
        decision_tfs=decisions,
        primary_horizon=args.horizon,
        fee=args.fee,
        holdout_frac=args.holdout,
        with_gbm=args.with_gbm,
    )
    report_dir = Path(args.report_dir) if args.report_dir else default_report_dir()
    book = result.get("_book")
    write_reports(public_payload(result), report_dir, book if isinstance(book, pd.DataFrame) else None)
    journal_path = Path(args.journal) if args.journal else default_journal_dir() / "journal.jsonl"
    if book is not None and len(book):
        _write_book(book, journal_path, args.horizon, result.get("primary_decision_tf") or "1h", args.fee)
    print(f"reports: {report_dir}")
    print(f"WAIA-S holdout mean R: {(result.get('waia_s') or {}).get('holdout', {}).get('expectancy_r')}")
    print(f"gate passed: {result.get('gate_passed')}")
    search = result.get("search") or {}
    if search.get("ran"):
        print(f"selected: {search.get('selected_id')}")
        _write_selected_params(search)
        _pin_selected(search.get("selected_id") or "")
    return 0 if "error" not in result else 1


def _write_book(book, path: Path, horizon: str, decision_tf: str, fee: float) -> None:
    from research.forecast_journal.models.waia_s import MODEL_ID
    from research.forecast_journal.config import MODEL_VERSION

    with JournalStore(path) as store:
        for row in book.itertuples(index=False):
            fid = forecast_id(str(row.symbol), int(row.ts), horizon, MODEL_ID, MODEL_VERSION, decision_tf)
            store.append(
                {
                    "record_type": "forecast",
                    "id": fid,
                    "ts": int(row.ts),
                    "symbol": row.symbol,
                    "horizon": horizon,
                    "decision_tf": decision_tf,
                    "model_id": MODEL_ID,
                    "model_version": MODEL_VERSION,
                    "score": getattr(row, "score", None),
                    "side": row.side,
                    "entry": row.entry,
                    "stop": row.stop,
                    "target": row.target,
                    "expected_r": row.expected_r,
                    "feature_hash": feature_hash([getattr(row, "score", None), row.entry, row.stop, row.target]),
                    "feature_groups": "price",
                }
            )
            store.append(
                {
                    "record_type": "reality",
                    "id": reality_id(fid),
                    "forecast_id": fid,
                    "ts": int(row.ts),
                    "symbol": row.symbol,
                    "horizon": horizon,
                    "model_id": MODEL_ID,
                    "filled": bool(row.filled),
                    "first_hit": row.first_hit,
                    "fill_price": row.fill_price,
                    "exit_price": row.exit_price,
                    "mfe": row.mfe,
                    "mae": row.mae,
                    "r_achieved": row.r_achieved,
                    "fee_per_side": fee,
                    "path_tf": getattr(row, "path_tf", None),
                }
            )


def _write_selected_params(search: dict) -> None:
    """Persist frozen logistic weights so `signal()` can run the selected model."""
    path = Path(__file__).resolve().parent / "models" / "selected_params.json"
    selected = search.get("selected_id")
    deploy = None
    for row in search.get("candidates") or []:
        if row.get("model_id") == selected:
            deploy = row.get("deploy")
            break
    if deploy:
        path.write_text(dump_json(deploy), encoding="utf-8")
        return
    if path.exists():
        path.unlink()


def _pin_selected(model_id: str) -> None:
    """Point the pluggable signal at the development-window winner."""
    if not model_id:
        return
    path = Path(__file__).resolve().parent / "models" / "best_signal.py"
    text = path.read_text(encoding="utf-8")
    old = "SELECTED = MODEL_ID"
    new = f'SELECTED = "{model_id}"'
    if old in text and model_id != "waia_s_v1":
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
    elif f'SELECTED = "{model_id}"' not in text and "SELECTED = " in text:
        # Already pinned to something else; leave a human-readable constant in place
        # only when it still says MODEL_ID.
        return


def _add_data_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-dir", default=str(default_data_dir()))
    parser.add_argument("--from", dest="from_date", default="2021-01-01")
    parser.add_argument("--to", dest="to_date", default=None)
    parser.add_argument("--symbols", default=",".join(UNIVERSE))


def _symbols(args) -> list[str]:
    return [part.strip().upper() for part in args.symbols.split(",") if part.strip()]


def _span(args) -> tuple[int, int]:
    import time

    start = parse_utc_date(args.from_date)
    end = parse_utc_date(args.to_date) if args.to_date else int(time.time())
    return start, end


if __name__ == "__main__":
    raise SystemExit(main())
