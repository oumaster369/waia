# M9 Operator Runbook

**Issue:** DEE-384  
**Vault:** `replay-runs/RI-P7/m9-v2-research-campaign-org0/`

## Preconditions

1. M9 Build merged to `dev`
2. Execution Server: `WAIA_DB_BACKEND=postgres`, `DATABASE_URL_POSTGRES` set (never log secrets)
3. RI migrations **0064–0066** applied
4. HTX bars ≥ 129600 for BTC/USDT 1m (`pnpm trader:htx:backfill` if needed)
5. Strategy version bumped; run candidate preflight (no duplicate row)
6. Operator authorization digests prepared (see below)
7. Fresh vault directory — never mutate prior campaign JSON

## Authorization digests

Compute campaign digest from scope (CLI verifies on start):

```bash
# Use Node REPL or a small helper with lib/trader/research/m9-operator-authorization.ts
# Fields: organizationId, strategyId, strategyVersion, symbol, interval, vaultDir, metricsSchemaVersion, campaignSuffix
```

Required flags:

- `--operator-campaign-authorization=<digest>`
- `--operator-blind-authorization=<digest>` (single-use blind warning)

## Campaign command

Run in **foreground only** — no background jobs, no Worker cron.

```bash
pnpm trader:m9:campaign -- \
  --org-id=<ORG0> \
  --strategy-id=mean_reversion_v0 \
  --strategy-version=<BUMPED> \
  --metrics-schema-version=2.0.0 \
  --operator-campaign-authorization=<DIGEST> \
  --operator-blind-authorization=<DIGEST> \
  --vault-dir=./replay-runs/RI-P7/m9-v2-research-campaign-org0 \
  --enable-guardian-exits=1 \
  2>&1 | tee replay-runs/RI-P7/m9-v2-research-campaign-org0/m9-campaign-run.log
```

Optional portfolio overrides (research path — **not** `PAPER_LOOP_*`):

- `--starting-balance-usdt=1000000.00`
- `--max-risk-per-trade-pct=0.10`
- `--default-stop-distance-pct=0.02`

## Process hygiene

| Rule | Action |
|------|--------|
| Single process | One foreground CLI; no `&` daemon |
| Timeout wrapper | Use `timeout 4h` if supported |
| Post-run check | `pgrep -fl 'm9-v2-research-campaign'` should be empty |
| Exit codes | `0` = success; `1` = regime fail or pipeline error |
| Orphans | Kill stale `node`/`tsx` only when operator explicitly requests |

## Failure handling

On regime failure:

- Append `m9-research-rejection-record.json` + `m9-evolution-cycle-mvp.json`
- **Never** edit success artifacts (`m9-research-evidence.json`, PKA, manifest)
- Document `blindConsumed: true` in VALIDATION.md when applicable

## Mock vs paper

Research campaign uses **mock ledger** for window isolation. Evidence `executionMode: backtest`. Forward paper soak (`PAPER_LOOP_*`) is a separate ledger — do not conflate.

## Forbidden

- Promotion FSM / live enable
- M8 discovery CLI
- Mutating sealed dee-371 / prior RI vault JSON
- Running campaign from Cursor agents without explicit operator authorization in chat
