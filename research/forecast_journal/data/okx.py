"""Optional OKX public liquidation and open-interest history.

The client fails soft. A geo-block or a missing instrument becomes an empty
frame so the rest of the journal still runs. These columns are a separate
feature group and are absent on most of the HTX history.
"""

from __future__ import annotations

from research.forecast_journal.config import okx_inst_id
from research.forecast_journal.data.http_client import HttpError, RateLimiter, get_json

OKX_BASE = "https://www.okx.com"


class OkxClient:
    def __init__(self, limiter: RateLimiter | None = None, base: str = OKX_BASE) -> None:
        self.base = base.rstrip("/")
        self.limiter = limiter or RateLimiter(4.0)

    def _get(self, path: str, params: dict) -> dict:
        payload = get_json(f"{self.base}{path}", params, limiter=self.limiter, timeout=30)
        if str(payload.get("code", "0")) not in ("0", "None"):
            raise RuntimeError(f"OKX {path}: {payload.get('msg') or payload}")
        return payload

    def liquidation_orders(self, symbol: str, limit: int = 100) -> list[dict]:
        inst = okx_inst_id(symbol)
        payload = self._get(
            "/api/v5/public/liquidation-orders",
            {"instType": "SWAP", "instId": inst, "state": "filled", "limit": str(limit)},
        )
        rows = []
        for block in payload.get("data") or []:
            details = block.get("details") or [block]
            for item in details:
                ts_ms = item.get("ts") or block.get("ts")
                if ts_ms is None:
                    continue
                side = str(item.get("side") or item.get("posSide") or "")
                notional = item.get("sz") or item.get("bkPx") or 0
                try:
                    size = float(notional)
                except (TypeError, ValueError):
                    size = 0.0
                rows.append({"ts": int(ts_ms) // 1000, "side": side, "size": size, "symbol": symbol})
        return rows

    def open_interest_history(self, symbol: str, period: str = "1H") -> list[dict]:
        inst = okx_inst_id(symbol)
        payload = self._get(
            "/api/v5/rubik/stat/contracts/open-interest-history",
            {"instId": inst, "period": period},
        )
        rows = []
        for item in payload.get("data") or []:
            # OKX returns [ts, oi, oiCcy, oiUsd] lists or dicts depending on vintage.
            if isinstance(item, dict):
                ts_ms = int(item.get("ts"))
                oi_usd = float(item.get("oiUsd") or item.get("oi") or 0)
            else:
                ts_ms = int(item[0])
                oi_usd = float(item[3] if len(item) > 3 else item[1])
            rows.append({"ts": ts_ms // 1000, "okx_oi_usd": oi_usd})
        rows.sort(key=lambda row: row["ts"])
        return rows


def try_okx(symbol: str, limiter: RateLimiter | None = None) -> dict[str, list[dict]]:
    client = OkxClient(limiter=limiter)
    out: dict[str, list[dict]] = {"liquidations": [], "oi": []}
    for key, func in (
        ("liquidations", lambda: client.liquidation_orders(symbol)),
        ("oi", lambda: client.open_interest_history(symbol)),
    ):
        try:
            out[key] = func()
        except HttpError:
            out[key] = []
        except Exception:
            out[key] = []
    return out
