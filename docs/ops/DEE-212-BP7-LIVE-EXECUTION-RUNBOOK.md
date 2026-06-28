# DEE-212 / BP-7 — Org-0 Live Execution Operator Runbook

Bounded, operator-triggered live execution on the **isolated host machine** (Option B). The BP-6 Docker container remains **health-only**; live dispatch runs via `node --import tsx` CLI on the host.

## Preconditions

- Org-0 UUID configured: `WAIA_TRADER_ORG0_ORGANIZATION_ID`
- BP-5 **EFFECTIVE** promotion for drill strategy (`mean_reversion_v0` @ `0.1.0`)
- HTX Org-0 credentials connected (trade only; withdraw/transfer forbidden)
- Execution host running; `WAIA_TRADER_EXECUTION_HOST_URL` returns `GET /health` → 200
- Kill switches clear
- Production `AI_TRADER_MASTER_KEY` / Secrets Store live (credential decrypt on Worker/CLI path)
- Org live-enable cap set to minimal (e.g. **10 USDT** notional)

## Seven-stage drill

| Stage | Command / check | Evidence |
|-------|-----------------|----------|
| 1. Enable | `pnpm trader:live:request -- --org-id=<ORG0> --actor-id=op --cap=10` → confirm → mark-enabled | org live-enable state ENABLED |
| 2. Gate probe | Composite gate passes (org0 + enabled + promotion + host health) | status / authz logs |
| 3. Strategy | `pnpm trader:live:cycle` with `--fixture-path` | `strategySignalId` in JSON |
| 4. Risk | cycle output | `riskDecisionId` + APPROVE |
| 5. Execution | cycle output | `orderId`, state → FILLED |
| 6. HTX / Fill | exchange order id + fill rows | `exchangeOrderId` |
| 7. Reconciliation + Reporting | cycle output | reconciliation outcomes + `reportingPeriodId`, `periodRealizedStrategyProfit` |

### Enable sequence

```bash
pnpm trader:live:request -- --org-id=<ORG0> --actor-id=operator --cap=10
pnpm trader:live:confirm -- --org-id=<ORG0> --actor-id=operator --expected-state-version=1 --ack="ENABLE ORG-0 LIVE TRADING"
# wait cooling-off (default 15m; override TRADER_ORG_LIVE_ENABLE_COOLING_OFF_MS in test)
pnpm trader:live:enable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=2
pnpm trader:live:status -- --org-id=<ORG0>
```

### Bounded live cycle (single order, terminates)

```bash
pnpm trader:live:cycle -- \
  --org-id=<ORG0> \
  --account-key=htx-spot-1 \
  --exchange-account-id=htx-spot-1 \
  --strategy=mean_reversion_v0 \
  --version=0.1.0 \
  --credential-id=<CREDENTIAL_UUID> \
  --fixture-path=tests/fixtures/trader/btcusdt-1m-mean-reversion.json \
  --quantity=0.001 \
  --notional-cap=5
```

Collect stdout JSON evidence bundle; store off-repo.

## Fail-closed probes

| Probe | Expected |
|-------|----------|
| `pnpm trader:live:disable` then cycle | denied (`ORG_LIVE_ENABLE_REQUIRED`) |
| Kill switch active | `submit_blocked` / gate reject |
| Notional > cap | `LivePathNotionalCapExceededError` / risk veto |
| Unset `WAIA_TRADER_ORG0_ORGANIZATION_ID` | live path fail-closed |
| Host `/health` down | `ExecutionHostUnavailableError` |
| Worker default execution service (no gate hook) | `LiveExecutionNotSupportedError` |

## Boundaries (do not violate)

- **No** Worker-side HTX `placeOrder`
- **No** HTTP dispatch endpoint on execution host
- **No** scheduler / daemon / websocket loop
- **Org-0 only**; no multi-org routing
- **Single capped order** per cycle

## Disable after drill

```bash
pnpm trader:live:disable -- --org-id=<ORG0> --actor-id=operator --expected-state-version=<N>
```
