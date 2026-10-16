"""HTX USDT-M public market data (api.hbdm.com). No API key."""

from __future__ import annotations

from typing import Any

from research.forecast_journal.config import HTX_PERIOD, TIMEFRAMES, contract_code
from research.forecast_journal.data.http_client import HttpError, RateLimiter, get_json
from research.forecast_journal.data.paginate import walk_backward

HTX_BASE = "https://api.hbdm.com"


class HtxClient:
    def __init__(self, limiter: RateLimiter | None = None, base: str = HTX_BASE) -> None:
        self.base = base.rstrip("/")
        self.limiter = limiter or RateLimiter(8.0)

    def _get(self, path: str, params: dict[str, Any]) -> Any:
        return get_json(f"{self.base}{path}", params, limiter=self.limiter, timeout=40)

    def klines(self, symbol: str, timeframe: str, start: int, end: int) -> list[dict]:
        period = HTX_PERIOD[timeframe]
        period_sec = TIMEFRAMES[timeframe]
        code = contract_code(symbol)

        def fetch(win_start: int, win_end: int) -> list[dict]:
            payload = self._get(
                "/linear-swap-ex/market/history/kline",
                {
                    "contract_code": code,
                    "period": period,
                    "from": int(win_start),
                    "to": int(win_end),
                },
            )
            status = str(payload.get("status", ""))
            if status != "ok":
                message = str(payload.get("err-msg") or payload.get("err_msg") or payload)
                # A window the API rejects is an empty page, not a fatal error,
                # so the walker can move on. Anything else is raised.
                if "invalid from to" in message.lower() or "no data" in message.lower():
                    return []
                raise RuntimeError(f"HTX kline {code} {period}: {message}")
            rows = []
            for item in payload.get("data") or []:
                open_time = int(item["id"])
                rows.append(
                    {
                        "open_time": open_time,
                        "close_time": open_time + period_sec,
                        "open": float(item["open"]),
                        "high": float(item["high"]),
                        "low": float(item["low"]),
                        "close": float(item["close"]),
                        "volume": float(item.get("amount") or 0.0),
                        "turnover": float(item.get("trade_turnover") or 0.0),
                        "trades": float(item.get("count") or 0.0),
                    }
                )
            return rows

        return walk_backward(fetch, start, end, period_sec)

    def funding(self, symbol: str, start: int | None = None) -> list[dict]:
        code = contract_code(symbol)
        page = 1
        rows: list[dict] = []
        total_pages = None
        while page <= 500:
            payload = self._get(
                "/linear-swap-api/v1/swap_historical_funding_rate",
                {"contract_code": code, "page_index": page, "page_size": 100},
            )
            if payload.get("status") != "ok":
                message = str(payload.get("err_msg") or payload)
                raise RuntimeError(f"HTX funding {code}: {message}")
            body = payload.get("data") or {}
            batch = body.get("data") or []
            if total_pages is None:
                try:
                    total_pages = int(body.get("total_page") or 0)
                except (TypeError, ValueError):
                    total_pages = 0
            if not batch:
                break
            oldest = None
            for item in batch:
                ts_ms = int(float(item["funding_time"]))
                ts = ts_ms // 1000
                premium = item.get("avg_premium_index")
                rows.append(
                    {
                        "ts": ts,
                        "funding_rate": float(item["funding_rate"]),
                        "avg_premium_index": float(premium) if premium not in (None, "") else float("nan"),
                    }
                )
                oldest = ts if oldest is None else min(oldest, ts)
            if start is not None and oldest is not None and oldest <= start:
                break
            if total_pages and page >= total_pages:
                break
            page += 1
        return _dedupe_ts(rows)

    def open_interest(self, symbol: str, htx_period: str, size: int = 200) -> list[dict]:
        """Most recent `size` OI prints. HTX caps size at 200 and ignores from/to."""
        code = contract_code(symbol)
        payload = self._get(
            "/linear-swap-api/v1/swap_his_open_interest",
            {
                "contract_code": code,
                "period": htx_period,
                "size": int(size),
                "amount_type": 1,
            },
        )
        if payload.get("status") != "ok":
            message = str(payload.get("err_msg") or payload)
            raise RuntimeError(f"HTX OI {code} {htx_period}: {message}")
        tick = ((payload.get("data") or {}).get("tick")) or []
        rows = []
        for item in tick:
            ts_ms = int(float(item["ts"]))
            value = item.get("value")
            rows.append(
                {
                    "ts": ts_ms // 1000,
                    "oi_volume": float(item.get("volume") or 0.0),
                    "oi_value": float(value) if value not in (None, "") else float("nan"),
                    "period": htx_period,
                }
            )
        return _dedupe_ts(rows)

    def index_klines(self, symbol: str, timeframe: str, size: int = 2000) -> list[dict]:
        """Recent index candles. This endpoint ignores from/to and returns the latest `size`."""
        period = HTX_PERIOD[timeframe]
        period_sec = TIMEFRAMES[timeframe]
        payload = self._get(
            "/index/market/history/index",
            {"symbol": contract_code(symbol), "period": period, "size": int(size)},
        )
        if payload.get("status") != "ok":
            message = str(payload.get("err-msg") or payload.get("err_msg") or payload)
            raise RuntimeError(f"HTX index {symbol} {period}: {message}")
        rows = []
        for item in payload.get("data") or []:
            open_time = int(item["id"])
            rows.append(
                {
                    "open_time": open_time,
                    "close_time": open_time + period_sec,
                    "index_close": float(item["close"]),
                }
            )
        return rows

    def basis(self, symbol: str, timeframe: str, size: int = 200) -> list[dict]:
        """Recent official basis prints (capped, about 200 bars)."""
        period = HTX_PERIOD[timeframe]
        period_sec = TIMEFRAMES[timeframe]
        payload = self._get(
            "/index/market/history/linear_swap_basis",
            {
                "contract_code": contract_code(symbol),
                "period": period,
                "size": int(size),
                "basis_price_type": "close",
            },
        )
        if payload.get("status") != "ok":
            message = str(payload.get("err-msg") or payload.get("err_msg") or payload)
            raise RuntimeError(f"HTX basis {symbol}: {message}")
        rows = []
        for item in payload.get("data") or []:
            open_time = int(item["id"])
            rows.append(
                {
                    "open_time": open_time,
                    "close_time": open_time + period_sec,
                    "basis_rate": float(item["basis_rate"]),
                    "index_price": float(item.get("index_price") or float("nan")),
                    "contract_price": float(item.get("contract_price") or float("nan")),
                }
            )
        return rows

    def liquidations(self, symbol: str, create_date: int = 7) -> list[dict]:
        """Recent forced closes. The public v3 route only returns a short buffer, not years.

        `direction` buy/sell is the liquidation order side (buy closes a short).
        """
        payload = self._get(
            "/linear-swap-api/v3/swap_liquidation_orders",
            {"contract": contract_code(symbol), "trade_type": 0, "create_date": int(create_date)},
        )
        if payload.get("code") not in (200, "200") and payload.get("status") not in ("ok", None):
            message = str(payload.get("msg") or payload.get("err_msg") or payload)
            raise RuntimeError(f"HTX liquidation {symbol}: {message}")
        rows = []
        for item in payload.get("data") or []:
            created = item.get("created_at")
            if created is None:
                continue
            turnover = item.get("trade_turnover")
            direction = str(item.get("direction") or "").lower()
            notion = float(turnover) if turnover not in (None, "") else 0.0
            rows.append(
                {
                    "ts": int(float(created)) // 1000,
                    "buy_turnover": notion if direction == "buy" else 0.0,
                    "sell_turnover": notion if direction == "sell" else 0.0,
                }
            )
        if not rows:
            return []
        import pandas as pd

        frame = pd.DataFrame(rows).groupby("ts", as_index=False)[["buy_turnover", "sell_turnover"]].sum()
        return frame.to_dict("records")

    def elite_ratio(self, symbol: str, kind: str, htx_period: str = "60min") -> list[dict]:
        path = {
            "account": "/linear-swap-api/v1/swap_elite_account_ratio",
            "position": "/linear-swap-api/v1/swap_elite_position_ratio",
        }[kind]
        payload = self._get(path, {"contract_code": contract_code(symbol), "period": htx_period})
        if payload.get("status") != "ok":
            message = str(payload.get("err_msg") or payload)
            raise RuntimeError(f"HTX elite {kind} {symbol}: {message}")
        items = ((payload.get("data") or {}).get("list")) or []
        rows = []
        for item in items:
            ts_ms = int(float(item["ts"]))
            rows.append(
                {
                    "ts": ts_ms // 1000,
                    "buy_ratio": float(item.get("buy_ratio") or 0.0),
                    "sell_ratio": float(item.get("sell_ratio") or 0.0),
                    "locked_ratio": float(item.get("locked_ratio") or 0.0),
                }
            )
        return _dedupe_ts(rows)


def _dedupe_ts(rows: list[dict]) -> list[dict]:
    kept: dict[int, dict] = {}
    for row in rows:
        kept[int(row["ts"])] = row
    return [kept[k] for k in sorted(kept)]


def empty_on_error(func, *args, **kwargs) -> list[dict]:
    """Call a client method. HTTP 4xx and 'no data' become an empty list."""
    try:
        return func(*args, **kwargs)
    except HttpError as exc:
        if exc.status in (400, 403, 404):
            return []
        raise
    except RuntimeError as exc:
        text = str(exc).lower()
        if "no data" in text or "not exist" in text or "invalid" in text or "input error" in text:
            return []
        raise
