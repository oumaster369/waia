"""Print p50/p95 for /heatmap, /levels, and /api/liquidity against a local demo server."""

from __future__ import annotations

import threading
import time
import urllib.request

from obheat.engine import seed_demo
from obheat.serve import ENGINE, Handler, Server


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return ordered[idx]


def _sample(url: str, n: int = 25) -> list[float]:
    out = []
    for _ in range(n):
        t0 = time.perf_counter()
        with urllib.request.urlopen(url, timeout=5) as resp:
            resp.read()
        out.append((time.perf_counter() - t0) * 1000.0)
    return out


def main() -> None:
    seed_demo(ENGINE, "BTC", steps=240, price0=86_000.0, step_s=60.0)
    seed_demo(ENGINE, "ETH", steps=120, price0=2_300.0, step_s=60.0)
    ENGINE.prebuild(["BTC", "ETH"])
    httpd = Server(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    paths = {
        "/heatmap": f"{base}/heatmap?symbol=BTC&window=4h&venues=all",
        "/levels": f"{base}/levels?symbol=BTC&venues=all",
        "/api/liquidity": f"{base}/api/liquidity?symbol=BTC",
    }
    print(f"obheat bench  {base}")
    failed = False
    limits = {"/heatmap": 300.0, "/levels": 300.0, "/api/liquidity": 200.0}
    for name, url in paths.items():
        samples = _sample(url)
        p50 = _percentile(samples, 50)
        p95 = _percentile(samples, 95)
        print(f"{name:16} n={len(samples):2d}  p50={p50:7.2f} ms  p95={p95:7.2f} ms  max={max(samples):7.2f} ms")
        if p95 > limits[name]:
            failed = True
    httpd.shutdown()
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
