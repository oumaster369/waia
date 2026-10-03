"""Клиент HTX USDT-M (V5), ключи только аргументом. Импорт модуль сеть не открывает."""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import urllib.parse
import urllib.request

from .card_check import wilder_atr
from .journal import sanitize

HOST = "api.hbdm.com"


class HtxError(RuntimeError):
    pass


class HtxClient:
    def __init__(self, api_key: str, api_secret: str, transport=None, host: str = HOST):
        if not api_key or not api_secret:
            raise HtxError("пустые ключи HTX")
        self.api_key = api_key
        self.api_secret = api_secret
        self.host = host
        self.transport = transport

    def _sign(self, method: str, path: str, params: dict) -> str:
        signed = dict(params)
        signed.update(
            AccessKeyId=self.api_key,
            SignatureMethod="HmacSHA256",
            SignatureVersion="2",
            Timestamp=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        )
        query = "&".join(f"{key}={urllib.parse.quote(str(signed[key]), safe='')}" for key in sorted(signed))
        payload = f"{method}\n{self.host}\n{path}\n{query}".encode()
        signature = base64.b64encode(hmac.new(self.api_secret.encode(), payload, hashlib.sha256).digest()).decode()
        return query + "&Signature=" + urllib.parse.quote(signature, safe="")

    def _call(self, method: str, path: str, params: dict | None = None, body: dict | None = None, private: bool = True):
        params = params or {}
        if private:
            url = f"https://{self.host}{path}?" + self._sign(method, path, params)
        else:
            url = f"https://{self.host}{path}"
            if params:
                url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body if body is not None else {}).encode() if method == "POST" else None
        headers = {"Content-Type": "application/json", "User-Agent": "committee-autoexec"}
        try:
            if self.transport:
                raw = self.transport(method, url, data, headers)
            else:
                req = urllib.request.Request(url, data=data, method=method, headers=headers)
                with urllib.request.urlopen(req, timeout=20) as resp:
                    raw = resp.read()
        except Exception as exc:
            raise HtxError(sanitize(str(exc))) from exc
        if isinstance(raw, bytes):
            parsed = json.loads(raw.decode())
        else:
            parsed = raw
        return parsed

    def _ok(self, payload: dict, what: str):
        if str(payload.get("code")) != "200":
            raise HtxError(f"{what}: {payload.get('code')} {payload.get('message')}")
        return payload.get("data")

    def balance(self) -> tuple[float, float]:
        data = self._ok(self._call("GET", "/v5/account/balance"), "balance") or {}
        rows = [row for row in data.get("details", []) if row.get("currency") == "USDT"]
        if not rows:
            return 0.0, 0.0
        row = rows[0]
        equity = float(row.get("equity") or 0) + float(row.get("isolated_equity") or 0)
        available = float(row.get("available") or 0)
        return equity, available

    def positions(self) -> dict:
        data = self._ok(self._call("GET", "/v5/trade/position/opens"), "positions") or []
        return {row["contract_code"]: row for row in data}

    def open_orders(self) -> list:
        return list(self._ok(self._call("GET", "/v5/trade/order/opens"), "orders") or [])

    def algo_opens(self) -> list:
        rows = []
        for kind in ("tpsl", "sl"):
            data = self._ok(self._call("GET", "/v5/algo/order/opens", {"type": kind}), f"algo {kind}") or []
            rows.extend(data)
        return rows

    def ticker(self, contract: str) -> dict:
        payload = self._call("GET", "/linear-swap-ex/market/detail/merged", {"contract_code": contract}, private=False)
        tick = payload["tick"]
        ts_ms = payload.get("ts")
        ts = None
        if ts_ms is not None:
            ts = dt.datetime.fromtimestamp(float(ts_ms) / 1000.0, tz=dt.timezone.utc)
        return {
            "last": float(tick["close"]),
            "bid": float(tick["bid"][0]),
            "ask": float(tick["ask"][0]),
            "ts": ts,
        }

    def spec(self, contract: str) -> tuple[float, float]:
        payload = self._call("GET", "/linear-swap-api/v1/swap_contract_info", {"contract_code": contract}, private=False)
        row = payload["data"][0]
        return float(row["contract_size"]), float(row["price_tick"])

    def atr_1h(self, contract: str, period: int = 14) -> float | None:
        payload = self._call(
            "GET",
            "/linear-swap-ex/market/history/kline",
            {"contract_code": contract, "period": "60min", "size": period + 2},
            private=False,
        )
        bars = list(payload.get("data") or [])
        bars.sort(key=lambda row: row.get("id") or 0)
        return wilder_atr(bars, period)

    def set_leverage(self, contract: str, lever: int) -> None:
        current = self._ok(
            self._call("GET", "/v5/position/lever", {"contract_code": contract, "margin_mode": "isolated"}),
            "get lever",
        ) or []
        if any(int(row.get("lever_rate") or 0) == lever and row.get("contract_code") == contract for row in current):
            return
        self._ok(
            self._call(
                "POST",
                "/v5/position/lever",
                body={
                    "contract_code": contract,
                    "margin_mode": "isolated",
                    "position_side": "both",
                    "lever_rate": str(lever),
                },
            ),
            f"set lever {contract}",
        )

    def place_order(self, body: dict) -> dict:
        return self._ok(self._call("POST", "/v5/trade/order", body=body), "place") or {}

    def cancel_order(self, contract: str, order_id: str | None = None, client_order_id: str | None = None) -> dict:
        body = {"contract_code": contract}
        if order_id:
            body["order_id"] = order_id
        else:
            body["client_order_id"] = client_order_id
        return self._call("POST", "/v5/trade/cancel_order", body=body)

    def cancel_algo(self, contract: str, algo_id: str | None = None, client_order_id: str | None = None) -> dict:
        body = {"contract_code": contract}
        if algo_id:
            body["algo_id"] = algo_id
            body["order_id"] = algo_id
        if client_order_id:
            body["algo_client_order_id"] = client_order_id
        return self._call("POST", "/v5/algo/cancel_order", body=body)

    def find_order(self, client_order_id: str) -> dict | None:
        for order in self.open_orders():
            if str(order.get("client_order_id") or "") == str(client_order_id):
                return order
        try:
            data = self._ok(self._call("GET", "/v5/trade/order", {"client_order_id": client_order_id}), "find")
        except HtxError:
            return None
        if isinstance(data, dict) and str(data.get("client_order_id") or "") == str(client_order_id):
            return data
        if isinstance(data, list):
            for order in data:
                if str(order.get("client_order_id") or "") == str(client_order_id):
                    return order
        return None

    def place_algo(self, body: dict) -> dict:
        return self._call("POST", "/v5/algo/order", body=body)


class ReadOnlyExchange:
    """Второй предохранитель бумажного режима: мутации не доходят до клиента."""

    def __init__(self, inner):
        self.inner = inner

    def balance(self):
        return self.inner.balance()

    def positions(self):
        return self.inner.positions()

    def open_orders(self):
        return self.inner.open_orders()

    def algo_opens(self):
        return self.inner.algo_opens()

    def ticker(self, contract):
        return self.inner.ticker(contract)

    def spec(self, contract):
        return self.inner.spec(contract)

    def atr_1h(self, contract):
        return self.inner.atr_1h(contract)

    def set_leverage(self, contract, lever):
        raise HtxError("dry-run: плечо не менялось")

    def place_order(self, body):
        raise HtxError("dry-run: ордер не отправлен")

    def cancel_order(self, contract, order_id=None, client_order_id=None):
        raise HtxError("dry-run: отмена на биржу не ушла")

    def cancel_algo(self, contract, algo_id=None, client_order_id=None):
        raise HtxError("dry-run: стоп на биржу не снят")

    def find_order(self, client_order_id):
        finder = getattr(self.inner, "find_order", None)
        return finder(client_order_id) if finder else None

    def place_algo(self, body):
        raise HtxError("dry-run: стоп на биржу не ушёл")
