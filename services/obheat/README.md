# obheat

Live aggregated order-book heatmap. Two processes:

| Unit | Module | Role |
| --- | --- | --- |
| `obheat-collect` | `python -m obheat.collect` | One thread per venue. Keeps the L2 book, resyncs on sequence gaps, publishes a coalesced snapshot a few times a second. |
| `obheat-serve` | `python -m obheat.serve` | Seals those snapshots into per-venue ring buffers and serves prebuilt JSON. Request handlers do not rescan history. |

The page is `GET /book`. It draws on a canvas, then subscribes to `GET /stream` and appends columns. A full `/heatmap` refetch happens on symbol, window, or venue-filter changes.

## Endpoints

Ports and the optional token come from the environment. Defaults match a localhost service behind the existing dashboard auth. Do not point this process at the public internet without that auth in front.

| Env | Default | Meaning |
| --- | --- | --- |
| `OBHEAT_BIND` | `127.0.0.1` | HTTP and ingest bind address |
| `OBHEAT_PORT` | `8787` | HTTP (`/book`, `/heatmap`, `/levels`, `/api/liquidity`, `/stream`, `/health`) |
| `OBHEAT_INGEST_PORT` | `8788` | Collector TCP (newline JSON). Not for browsers. |
| `OBHEAT_TOKEN` | empty | If set, `Authorization: Bearer` or `?token=` is required. Leave empty when the process has no token today. |
| `OBHEAT_SYMBOLS` | `BTC,ETH` | Comma-separated bases. Any symbol the collectors understand (`SOL`, …) can be added. |
| `OBHEAT_STALE_AFTER` | `20` | Seconds without a book update before a live venue is marked stale. |

`GET /heatmap?symbol=BTC&window=4h&venues=all`

`window` is `1m`, `4h`, `12h`, `24h`, or `3d`. The server downsamples to at most 240 columns. `venues` is `all` or a comma list of ids (`binance_perp`, `bybit_perp`, `okx_perp`, `htx_perp`, `bitget_perp`, `gate_perp`, `binance_spot`, `coinbase_spot`, `okx_spot`, `bybit_spot`).

Heatmap body (abridged): `symbol`, `window`, `p0`, `dp`, `bins`, `dt`, `t` (unix seconds), `last_path`, `bid_b64`, `ask_b64` (float32, column-major, `col * bins + bin`), `last`, `best_bid`, `best_ask`, `health`, `ok`, `freshness`.

`GET /levels?symbol=BTC` is the current column: bid/ask bins, nearest walls, liquidation clusters, health.

`GET /health?symbol=BTC` is `{ok, detail, venues}` for the dashboard dot. `ok` is false when a venue is stale or resyncing. A geo-blocked venue is `unavailable` and does not, by itself, clear `ok`.

### `GET /stream?symbol=BTC`

Server-sent events:

| event | payload |
| --- | --- |
| `hello` | `{symbol, venues}` |
| `column` | one new aggregated column (`p0`, `dp`, `bins`, `t`, `bid_b64`, `ask_b64`, `last`, `best_bid`, `best_ask`) |
| `levels` | last, best bid/ask, nearest walls, liquidation clusters, health |
| `liquidity` | the same object as `/api/liquidity` |

The browser reconnects with exponential backoff (1s, capped at 15s) and shows `live` / `stale` / `переподключение`.

### `GET /api/liquidity?symbol=BTC`

Compact machine-readable snapshot. Same JSON is pushed on the `liquidity` SSE event. Target well under 200 ms because the body is cached off the request path.

```json
{
  "symbol": "BTC",
  "ts": 1710000000000,
  "last": 86010.5,
  "best_bid": 86010.0,
  "best_ask": 86011.0,
  "walls": {
    "bid": [
      {"price": 85800.0, "size_usd": 4200000.0, "persistence_s": 38.0, "trend": "growing"}
    ],
    "ask": [
      {"price": 86250.0, "size_usd": 3100000.0, "persistence_s": 12.0, "trend": "pulled"}
    ]
  },
  "liquidations": {
    "source": "open_interest",
    "oi_usd": 24000000000.0,
    "longs": [
      {"price": 84200.0, "size_usd": 1800000.0, "leverage": 50, "distance_pct": -2.1}
    ],
    "shorts": [
      {"price": 87700.0, "size_usd": 1600000.0, "leverage": 50, "distance_pct": 1.96}
    ]
  },
  "magnet": {
    "0.5": {"up_usd": 1.0, "down_usd": 4.0, "score_up": 0.2, "score_down": 0.8, "bias": "down"},
    "1": {},
    "2": {},
    "3": {}
  },
  "freshness": {
    "binance_perp": {"status": "live", "age_ms": 120.0, "gaps": 0, "reason": null},
    "coinbase_spot": {"status": "unavailable", "age_ms": 10.0, "gaps": 0, "reason": "geo_blocked"}
  },
  "health": "Binance perp ok · Coinbase unavailable",
  "ok": true
}
```

| Field | Meaning |
| --- | --- |
| `last`, `best_bid`, `best_ask` | Last trade (or mid until a trade arrives), best bid, best ask. |
| `walls.bid` / `walls.ask` | Up to three nearest resting walls on that side of `last`. `size_usd` is aggregated dollar size in that price bin. `persistence_s` is how long that bin has stayed a wall. `trend` is `new` (< 2s), `growing` (size up > 15%), `pulled` (size down > 15%), or `stable`. |
| `liquidations.longs` / `shorts` | Model clusters, not exchange liquidations. Longs sit below price, shorts above. `distance_pct` is `(cluster - last) / last * 100`. `leverage` is the bucket (5, 10, 25, 50, 100). Weights are 8/22/35/25/10. Maintenance margin 0.4%. |
| `liquidations.source` | `open_interest` when Binance USDT-M open interest and account long/short ratio were fetched; `depth_proxy` when OI is missing (visible depth × 8); `unavailable` / `none` when there is nothing to scale. |
| `liquidations.oi_usd` | Notional used to scale the clusters. |
| `magnet."0.5"` / `"1"` / `"2"` / `"3"` | Resting dollar liquidity plus liquidation notional inside that percent band. `bias` is `up` when the ask side (resting asks + short liquidations) is > 5% larger, `down` for the bid side, otherwise `neutral`. `score_up` and `score_down` sum to 1. |
| `freshness.<venue>.status` | `live`, `stale`, `resync`, `reconnecting`, `connecting`, `rate_limited`, `unavailable`. |
| `freshness.<venue>.age_ms` | Milliseconds since the server last applied a book or health update. |
| `freshness.<venue>.gaps` | Sequence gaps observed on that connection. After a successful resync the status returns to `live` and the gap count is kept. |
| `freshness.<venue>.reason` | `geo_blocked`, `sequence gap`, `429`, or an exception name. |
| `health` | Single line, same facts as `freshness`, for the chart. |
| `ok` | False while any venue is stale, resyncing, or reconnecting. Unavailable venues do not clear it. |

## Venues

Each adapter runs in its own thread, so a blocked exchange cannot stall the others or the HTTP server.

- Binance spot and USDT-M: snapshot, then diffs. Futures require `pu == previous u`. Spot requires `U == previous u + 1` after the snapshot bridge. A break clears the book and refetches the snapshot.
- Bybit v5 linear (200) and spot (50): snapshot, then `u` must be previous + 1. App-level ping every 20s.
- OKX books: `seqId` / `prevSeqId`. Swap sizes are multiplied by `ctVal`. Text `ping` every 20s.
- HTX USDT swap: gzip frames, `pong` on every `ping` (the connection dies without it). `depth.step0` is a full image, so there is no diff gap; contract size scales the coin amount.
- Bitget USDT futures: snapshot then incremental apply, ping every 25s.
- Gate USDT futures: `U`/`u` range continuity, `futures.ping`.
- Coinbase Exchange `level2` + `heartbeat` + `ticker`. A missed heartbeat reconnects.

HTTP 451, HTTP 403 with a restricted-location body, or a websocket handshake 401/403/451 marks that venue `unavailable` and the thread sleeps five minutes. It is left out of the aggregate. HTTP 429 is `rate_limited` and backs off 30s, not `stale`.

## Develop

```bash
cd services/obheat
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
OBHEAT_PORT=8797 OBHEAT_INGEST_PORT=8798 .venv/bin/python -m obheat.bench
OBHEAT_PORT=8797 OBHEAT_INGEST_PORT=8798 .venv/bin/python -m obheat.serve --demo
```

`--demo` fills synthetic books so `/book` renders without exchange connectivity.

Dependencies: `numpy`, `websocket-client`. The HTTP server is the standard library.

## Deploy

Keep `/etc/obheat.env` as it is (bind, ports, token, symbol list). The unit files read it and do not hardcode a replacement port. If a variable name differs from the table above, copy the current port into `OBHEAT_PORT` and the current bind into `OBHEAT_BIND` rather than changing the dashboard proxy or the token.

1. Install the tree at `/opt/obheat` (this directory: package `obheat/`, `requirements.txt`).
2. `python3 -m venv /opt/obheat/.venv && /opt/obheat/.venv/bin/pip install -r /opt/obheat/requirements.txt`
3. Install `deploy/obheat-collect.service` and `deploy/obheat-serve.service` if those units are not already present. If they are, only point `ExecStart` / `WorkingDirectory` at the venv and `/opt/obheat`, and keep the existing `EnvironmentFile`.
4. Restart **collector first**, then **server**:

```bash
sudo systemctl daemon-reload
sudo systemctl restart obheat-collect
sudo systemctl restart obheat-serve
```

The collector reconnects to the ingest port on its own. The server keeps serving the last sealed columns as soon as it is back; new columns arrive once the collector has a snapshot again. Unavailable venues do not delay that.

Check:

```bash
curl -sS "http://127.0.0.1:${OBHEAT_PORT:-8787}/health?symbol=BTC"
curl -sS -o /dev/null -w '%{time_total}\n' "http://127.0.0.1:${OBHEAT_PORT:-8787}/heatmap?symbol=BTC&window=4h"
curl -sS -o /dev/null -w '%{time_total}\n' "http://127.0.0.1:${OBHEAT_PORT:-8787}/api/liquidity?symbol=BTC"
```

The dashboard route `/book` should proxy to this process (same port as before) so the canvas page replaces the old heatmap document. `/heatmap` and `/levels` stay on the same paths.
