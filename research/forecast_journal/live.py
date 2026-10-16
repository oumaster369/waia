"""Live loop: append forecasts, fill reality once the horizon has elapsed, refresh accuracy."""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

from research.forecast_journal.config import DEFAULT_TAKER_FEE, HORIZONS, MODEL_VERSION, UNIVERSE
from research.forecast_journal.data.loader import MarketData, backfill, load_cache
from research.forecast_journal.features.compute import build_panel, present_groups
from research.forecast_journal.features.liquidity import parse_liquidity
from research.forecast_journal.journal.store import JournalStore, iter_jsonl, reality_id
from research.forecast_journal.journal.trade import PathBars, choose_path, simulate_trade
from research.forecast_journal.metrics.stats import brier_score, hit_rate
from research.forecast_journal.models.best_signal import SELECTED, signal
from research.forecast_journal.util import feature_hash, forecast_id, iso_utc, json_default
from research.forecast_journal.features.compute import FEATURE_COLUMNS, LIQUIDITY_COLUMNS

import json
import urllib.parse
import urllib.request


def run_forever(
    data_dir: Path,
    journal_path: Path,
    report_dir: Path,
    *,
    interval_min: int = 15,
    fee: float = DEFAULT_TAKER_FEE,
    liquidity_url: str | None = None,
    symbols: list[str] | None = None,
    once: bool = False,
    log=print,
) -> None:
    while True:
        run_once(
            data_dir,
            journal_path,
            report_dir,
            fee=fee,
            liquidity_url=liquidity_url,
            symbols=symbols,
            log=log,
        )
        if once:
            return
        step = max(interval_min, 1) * 60
        sleep_s = step - (time.time() % step)
        log(f"sleep {sleep_s:.0f}s")
        time.sleep(sleep_s)


def run_once(
    data_dir: Path,
    journal_path: Path,
    report_dir: Path,
    *,
    fee: float = DEFAULT_TAKER_FEE,
    liquidity_url: str | None = None,
    symbols: list[str] | None = None,
    log=print,
    refresh_seconds: int = 3 * 86400,
) -> dict:
    symbols = symbols or list(UNIVERSE)
    now = int(time.time())
    backfill(
        data_dir,
        symbols=symbols,
        start=now - refresh_seconds,
        end=now,
        minute_start=now - refresh_seconds,
        timeframes=("1m", "15m", "1h", "4h"),
        include_okx=False,
        workers=2,
        rps=4,
        log=log,
    )
    data = load_cache(data_dir, symbols)
    written = 0
    with JournalStore(journal_path) as store:
        for decision_tf in ("15m", "1h"):
            panel = build_panel(data, decision_tf)
            if panel.empty:
                continue
            # Latest closed bar per symbol only. Older bars are already journaled or skipped.
            latest = panel.sort_values("ts").groupby("symbol", as_index=False).tail(1)
            if liquidity_url:
                latest = _attach_live_liquidity(latest, liquidity_url, log)
            for row in latest.to_dict(orient="records"):
                score, side, card = signal({**row, "fee_per_side": fee})
                groups = present_groups(pd.Series(row))
                snapshot = [row.get(col) for col in list(FEATURE_COLUMNS) + list(LIQUIDITY_COLUMNS)]
                for horizon in ("15m", "1h", "4h", "24h"):
                    fid = forecast_id(str(row["symbol"]), int(row["ts"]), horizon, SELECTED, MODEL_VERSION, decision_tf)
                    record = {
                        "record_type": "forecast",
                        "id": fid,
                        "ts": int(row["ts"]),
                        "symbol": row["symbol"],
                        "horizon": horizon,
                        "decision_tf": decision_tf,
                        "model_id": SELECTED,
                        "model_version": MODEL_VERSION,
                        "p_up": None if score != score else max(0.0, min(1.0, (max(-100.0, min(100.0, score)) / 100.0 + 1.0) / 2.0)),
                        "score": None if score != score else score,
                        "side": side,
                        "entry": None if card is None else card["entry"],
                        "stop": None if card is None else card["stop"],
                        "target": None if card is None else card["target"],
                        "expected_r": None if card is None else card["expected_r"],
                        "feature_hash": feature_hash(snapshot),
                        "feature_groups": groups,
                    }
                    if store.append(record):
                        written += 1
        filled = fill_realities(store, data, fee, data_dir=data_dir)
    summary = rolling_accuracy(journal_path, report_dir)
    log(f"live wrote {written} forecasts, filled {filled} realities")
    summary["wrote"] = written
    summary["filled"] = filled
    return summary


def fill_realities(store: JournalStore, data: MarketData, fee: float, data_dir: Path | None = None) -> int:
    now = int(time.time())
    forecasts = [row for row in iter_jsonl(store.path) if row.get("record_type") == "forecast"]
    done = {row.get("forecast_id") for row in iter_jsonl(store.path) if row.get("record_type") == "reality"}
    paths = {}
    n = 0
    for forecast in forecasts:
        if forecast["id"] in done:
            continue
        horizon_s = HORIZONS.get(forecast.get("horizon") or "")
        if horizon_s is None or int(forecast["ts"]) + horizon_s > now:
            continue
        symbol = forecast["symbol"]
        if symbol not in paths:
            book = data.klines.get(symbol) or {}
            paths[symbol] = {tf: PathBars.from_frame(book.get(tf), tf) for tf in ("15m", "1h")}
            if data_dir is not None:
                from research.forecast_journal.data.loader import read_kline

                minute = read_kline(Path(data_dir), symbol, "1m")
                if minute is not None and not minute.empty:
                    paths[symbol]["1m"] = PathBars.from_frame(minute, "1m")
        path = choose_path(paths[symbol], int(forecast["ts"]), horizon_s)
        if path is None or not forecast.get("side") or forecast.get("entry") is None:
            reality = {
                "record_type": "reality",
                "id": reality_id(forecast["id"]),
                "forecast_id": forecast["id"],
                "ts": int(forecast["ts"]),
                "symbol": symbol,
                "horizon": forecast["horizon"],
                "model_id": forecast.get("model_id"),
                "filled": False,
                "first_hit": "no_trade",
                "r_achieved": None,
                "fee_per_side": fee,
            }
        else:
            result = simulate_trade(
                path,
                int(forecast["ts"]),
                horizon_s,
                str(forecast["side"]),
                float(forecast["entry"]),
                float(forecast["stop"]),
                float(forecast["target"]),
                fee,
            )
            reality = {
                "record_type": "reality",
                "id": reality_id(forecast["id"]),
                "forecast_id": forecast["id"],
                "ts": int(forecast["ts"]),
                "symbol": symbol,
                "horizon": forecast["horizon"],
                "model_id": forecast.get("model_id"),
                "filled": result["filled"],
                "first_hit": result["first_hit"],
                "fill_price": result["fill_price"],
                "exit_price": result["exit_price"],
                "mfe": result["mfe"],
                "mae": result["mae"],
                "r_achieved": result["r_achieved"],
                "fee_per_side": fee,
                "path_tf": result["path_tf"],
            }
        if store.append(reality):
            n += 1
    return n


def rolling_accuracy(journal_path: Path, report_dir: Path) -> dict:
    forecasts = {row["id"]: row for row in iter_jsonl(journal_path) if row.get("record_type") == "forecast"}
    paired = []
    for reality in iter_jsonl(journal_path):
        if reality.get("record_type") != "reality":
            continue
        forecast = forecasts.get(reality.get("forecast_id"))
        if forecast is None or forecast.get("p_up") is None:
            continue
        paired.append((forecast, reality))
    # Directional accuracy uses the sign of the forward move when we have no explicit y.
    # Live realities store R, not the market up/down bit, so hit rate here is "R>0 among fills".
    r_values = [row[1]["r_achieved"] for row in paired if row[1].get("r_achieved") is not None]
    fills = [row for row in paired if row[1].get("filled")]
    summary = {
        "updated": iso_utc(int(time.time())),
        "forecasts": len(forecasts),
        "realities": len(paired),
        "mean_r": float(pd.Series(r_values, dtype="float64").mean()) if r_values else None,
        "hit_rate_filled": float(np_mean([1.0 if (row[1].get("r_achieved") or 0) > 0 else 0.0 for row in fills])) if fills else None,
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "live_accuracy.json").write_text(json.dumps(summary, indent=2, default=json_default), encoding="utf-8")
    text = [
        "# Live accuracy",
        "",
        f"Updated {summary['updated']}.",
        "",
        f"- forecasts: {summary['forecasts']}",
        f"- realities: {summary['realities']}",
        f"- mean R (unfilled = 0 when present): {summary['mean_r']}",
        f"- hit rate among fills: {summary['hit_rate_filled']}",
        "",
    ]
    (report_dir / "live_accuracy.md").write_text("\n".join(text), encoding="utf-8")
    return summary


def _attach_live_liquidity(frame: pd.DataFrame, base_url: str, log) -> pd.DataFrame:
    out = frame.copy()
    for idx, row in out.iterrows():
        symbol = row["symbol"]
        url = base_url.rstrip("/") + "/api/liquidity?" + urllib.parse.urlencode({"symbol": symbol})
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                payload = json.loads(response.read().decode())
        except Exception as exc:
            log(f"liquidity {symbol} unavailable: {exc}")
            continue
        fields = parse_liquidity(payload if isinstance(payload, dict) else payload.get("data") if isinstance(payload, dict) else None)
        for key, value in fields.items():
            out.at[idx, key] = value
    return out


def np_mean(values) -> float:
    if not values:
        return float("nan")
    return float(sum(values) / len(values))


# Silence unused imports that document the live scoring surface.
_ = (brier_score, hit_rate)
