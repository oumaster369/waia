# Gate 0 — HTX Endpoint Capability Validation

**Date:** 2026-07-02  
**Decision:** GO — Path A (REST `/market/history/candles` forward paging)  
**Rejected:** WebSocket `req` kline (Path B) — not required; REST path validated

## Evidence

| Artifact | Result |
|----------|--------|
| `gate0-rest-candles-spike-20260702T061625Z.log` | 129,603 unique bars, 130 pages, 90.0 days, 0 gaps |
| Live smoke 5000 (`WAIA_HTX_LIVE_SMOKE=1`) | 5 pages, 6.8s, 0 gaps |
| Live smoke 129600 (`WAIA_HTX_LIVE_SMOKE=1`) | 130 pages, 139.8s, span 90.00 days, 0 gaps |

## Chosen path

- **Endpoint:** `GET /market/history/candles`
- **Pagination:** forward from `start = now - target*period`, cursor `from = max(id) + periodSeconds`
- **Batch size cap:** 1000 (values above 1000 return empty)

## Rejected paths

- `/market/history/kline` + `from` — parameter ignored (latest-N only)
- WebSocket `req` kline — higher complexity; REST candles sufficient for RI-P7

## Org-0 DB backfill (operator)

After merging fix to execution host:

```bash
cd /root/waia && git pull
set -a && source .env.local && set +a
pnpm trader:htx:backfill -- \
  --org-id=3c50b4e9-1138-43a5-a29f-e65088124cfc \
  --symbol=BTC/USDT \
  --period=1min \
  --target-bars=129600
```

Re-run same command to verify idempotent insert (`onConflictDoNothing`).
