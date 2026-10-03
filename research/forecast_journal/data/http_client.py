"""Tiny stdlib HTTP client with a shared rate limit and retries."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class RateLimiter:
    def __init__(self, rps: float) -> None:
        self.min_interval = 1.0 / rps if rps and rps > 0 else 0.0
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        if self.min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            delay = self._next - now if self._next > now else 0.0
            self._next = (now if delay <= 0 else self._next) + self.min_interval
        if delay > 0:
            time.sleep(delay)


class HttpError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


def get_json(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    timeout: float = 30.0,
    retries: int = 4,
    limiter: RateLimiter | None = None,
    user_agent: str = "waia-forecast-journal/1.0",
) -> Any:
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    full = f"{url}?{query}" if query else url
    last: Exception | None = None
    for attempt in range(retries):
        if limiter is not None:
            limiter.wait()
        request = urllib.request.Request(full, headers={"User-Agent": user_agent, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                body = ""
            last = HttpError(f"HTTP {exc.code} for {full}: {body}", status=exc.code, body=body)
            # 403/404 will not start working on retry; surface immediately.
            if exc.code in (400, 401, 403, 404):
                raise last
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as exc:
            last = exc
        time.sleep(min(8.0, 0.4 * (2**attempt)))
    raise HttpError(f"GET failed after {retries} attempts: {full}: {last}")
