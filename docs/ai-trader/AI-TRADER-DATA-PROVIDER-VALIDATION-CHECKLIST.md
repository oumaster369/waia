# AI-TRADER Data Provider Validation Checklist

**Phase:** Data Provider Readiness (DEE-392)  
**Next phase:** Full Market Data Source Integration  
**Repeat M9:** **BLOCKED** until both provider phases pass

Use this checklist for Architect/operator sign-off. No secret values — verify names and locations only.

---

## Automated repository audit

```bash
pnpm validate:provider-readiness
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
```

- [ ] `pnpm validate:provider-readiness` exits 0
- [ ] Full validation chain green

---

## Documentation

- [ ] [`AI-TRADER-DATA-PROVIDERS.md`](AI-TRADER-DATA-PROVIDERS.md) contains Canonical 20-source tier table
- [ ] Repeat M9 required vs deferred sources documented
- [ ] Environment and secrets section complete
- [ ] Provider health observability documented
- [ ] Gateway bypass inventory documented
- [ ] `order_book_snapshot` known gap documented
- [ ] [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) exists with Post-merge Operator Provisioning Sequence
- [ ] [`AI-TRADER-ENGINEERING-STATUS.md`](../../replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md) shows Data Provider Readiness as current phase
- [ ] [`GATE-A-VALIDATION.md`](../../replay-runs/RI-P7/m9-v2-research-campaign-org0/GATE-A-VALIDATION.md) lists both provider phases before Repeat M9

---

## Provider registry (Repeat M9 required)

- [ ] `htx_spot` — MTF bars + L1 quote via gateway
- [ ] `binance_public` — cross-venue confirmation (fail-soft)
- [ ] `bybit_public` — cross-venue confirmation (fail-soft)
- [ ] `alternative_me` — Fear & Greed (fail-soft)
- [ ] `coingecko_global` — global stats (fail-soft)
- [ ] `order_book_snapshot` gap acknowledged for Full Market Data Source Integration

---

## Environment templates (placeholders only)

- [ ] `.env.example` documents `HTX_REST_HOST`, `COINGECKO_API_KEY`, `MARKET_BRAIN_*`, `WATCHER_USDT_CONTRACT`, `WAIA_HTX_LIVE_SMOKE`
- [ ] `.dev.vars.example` documents MI worker preview vars
- [ ] `docs/cloudflare-env-vars.md` inventories AI-TRADER MI + watcher vars
- [ ] No `FRED_API_KEY` or `INFURA_*` invented in templates
- [ ] No real secrets in repo, fixtures, tests, or docs

---

## Secrets placement

- [ ] HTX trade credentials documented as **Trader UI only** — never env vars
- [ ] `COINGECKO_API_KEY` documented as optional local/Cloudflare secret
- [ ] `AI_TRADER_MASTER_KEY` / `AI_TRADER_MASTER_KEY_DEV` documented per DEE-220
- [ ] `TRONGRID_API_KEY` documented as payment watcher only — separate from future AI-TRADER intelligence key

---

## Gateway and bypass

- [ ] Governed path: Registry → Gateway → Normalization → Validation → Freshness/Reliability → Context Fusion → Understanding Bridge
- [ ] Research modules do not import provider clients directly (`trader-research-backtest-isolation.test.ts`)
- [ ] Intentional bypasses documented (execution connector, backfill script, replay builder)
- [ ] `COINGECKO_API_KEY` bridged in `lib/trader/cron/worker-cron-env.ts`

---

## Health and degradation

- [ ] Fail-soft for optional providers documented
- [ ] Fail-closed for HTX primary bars documented
- [ ] Health → CDE permission mapping documented
- [ ] Operator can verify via unit/integration tests without Repeat M9

---

## Operator provisioning sequence (post-merge)

- [ ] Operator executed steps 1–12 in runbook Post-merge Operator Provisioning Sequence
- [ ] Local `.env.local` configured (non-HTX-trade keys only)
- [ ] Production secrets provisioned via Cloudflare where applicable
- [ ] HTX credentials connected via Trader UI and encrypted
- [ ] Market Brain / Paper Loop connectivity verified

---

## Phase exit

- [ ] All items above checked
- [ ] **Data Provider Readiness — PASS**
- [ ] Authorized to start **Full Market Data Source Integration** grooming
- [ ] **Repeat M9 remains BLOCKED** until Full Market Data Source Integration passes

**Sign-off**

| Role | Name | Date | PASS/FAIL |
|------|------|------|-----------|
| Operator | | | |
| Architect | | | |
