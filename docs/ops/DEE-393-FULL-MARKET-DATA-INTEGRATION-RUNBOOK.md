# DEE-393 — Full Market Data Source Integration Operator Runbook

**Status:** ⏳ **Phase complete pending merge** — engineering artifacts on integration branch  
**Linear:** [DEE-393](https://linear.app/deepsense/issue/DEE-393) — **In Review** (at PR readiness)  
**Phase:** Full Market Data Source Integration (post DEE-392, pre Repeat M9 v0.1.7)  
**Binding spec:** [`docs/ai-trader/AI-TRADER-DATA-PROVIDERS.md`](../ai-trader/AI-TRADER-DATA-PROVIDERS.md)  
**Canonical provisioning:** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md)  
**Validation checklist:** [`docs/ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](../ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md)  
**Prior phase:** [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md)

> **No secret values in this document.** Placeholders only.

---

## Preflight

1. Confirm **Data Provider Readiness (DEE-392)** merged to `dev`.
2. Read binding spec, provisioning guide Section C (Tier 3–8), and this runbook.
3. Run repository audits:

```bash
pnpm validate:provider-readiness
pnpm validate:market-data-integration
```

4. Run full validation chain before sign-off:

```bash
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build && pnpm validate:provider-readiness && pnpm validate:market-data-integration
```

**Repeat M9 v0.1.7 remains BLOCKED** until this phase merges to `dev` **and** operator validates the gateway path end-to-end.

---

## What this phase delivers

| Capability | Detail |
|------------|--------|
| **20/20 provider registry** | All canonical sources registered in `provider-registry.ts` + `MARKET_DATA_PROVIDER_IDS` |
| **Gateway + adapters** | Tier 0–2 via gateway clients; Tier 3–8 via optional adapters |
| **`order_book_snapshot`** | HTX depth fetch + `normalizeOrderBookSnapshotObservation` |
| **Fused context v2** | `waia.trader.fused_context.v2` with evidence slots (`macroEvidence`, `newsEvidence`, etc.) |
| **Optional env vars** | Seven new MI secrets/flags (see below) |
| **Cron bridging** | All new vars bridged in `worker-cron-env.ts` |

---

## New environment variables (placeholders only)

| Variable | Required? | Purpose | Storage |
|----------|-----------|---------|---------|
| `FRED_API_KEY` | No | FRED macro series | `.env.local` / Cloudflare Secret |
| `AI_TRADER_INFURA_PROJECT_ID` | No | Infura project id for EVM RPC stats | Secret |
| `AI_TRADER_INFURA_API_SECRET` | No | Infura API secret | Secret |
| `AI_TRADER_TRONGRID_API_KEY` | No | TronGrid MI intelligence (**not** `TRONGRID_API_KEY`) | Secret |
| `AI_TRADER_GITHUB_TOKEN` | No | GitHub protocol release rate limits | Secret |
| `AI_TRADER_SEC_EDGAR_USER_AGENT` | No | SEC EDGAR policy-bound User-Agent | Secret |
| `AI_TRADER_CME_FEDWATCH_ENABLED` | No | Opt-in CME FedWatch adapter (`1`/`true`) | Plain var |

**Forbidden bare names:** `INFURA_API_KEY`, `INFURA_PROJECT_ID` — use `AI_TRADER_INFURA_*` prefix only.

Templates: `.env.example`, `.dev.vars.example`, [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md).

---

## Post-merge operator provisioning sequence

Execute after the DEE-393 PR merges to `dev`:

1. **Merge this PR into dev.**
2. **Pull latest `dev`** on operator workstation.
3. **Update `.env.local`** — add optional Tier 3–8 keys from `.env.example` comments only; never HTX trade credentials.
4. **Update `.dev.vars`** for Workers preview if testing cron locally.
5. **Run `pnpm validate:market-data-integration`** — fix all FAIL findings.
6. **Run `pnpm validate:provider-readiness`** — must still pass with updated rules.
7. **Provision Cloudflare secrets** for optional providers you intend to enable (see [`cloudflare-env-vars.md`](../cloudflare-env-vars.md)).
8. **Verify gateway poll** via unit/integration tests (no Repeat M9 yet):

```bash
pnpm test --run tests/unit/trader-market-data-integration.test.ts
pnpm test --run tests/unit/trader-provider-adapters.test.ts
pnpm test --run tests/integration/trader-htx-bar-poll-cycle.test.ts
```

9. **Confirm fused context v2** — `schemaVersion: waia.trader.fused_context.v2` in gateway poll output.
10. **Sign validation checklist** — [`AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](../ai-trader/AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md) DEE-393 section.
11. **Only after operator sign-off** may Repeat M9 v0.1.7 be authorized.

---

## Provider coverage matrix (20/20)

| Tier | Registry ID | Wiring |
|------|-------------|--------|
| 0 | `htx_spot` | Gateway (`HtxRestClient`, `HtxDepthAdapter`) |
| 1 | `coingecko_global` | Gateway (`CoinGeckoGlobalMarketClient`) |
| 1 | `binance_public` | Gateway (`BinancePublicMarketClient`) |
| 1 | `bybit_public` | Gateway (`BybitPublicMarketClient`) |
| 2 | `alternative_me` | Gateway (`AlternativeMeFearGreedClient`) |
| 3 | `fred` | `fred-adapter.ts` |
| 3 | `federal_reserve` | `federal-reserve-adapter.ts` |
| 3 | `cme_fedwatch` | `cme-fedwatch-adapter.ts` |
| 4 | `gdelt` | `gdelt-adapter.ts` |
| 4 | `coindesk_rss` | `coindesk-rss-adapter.ts` |
| 4 | `cointelegraph_rss` | `cointelegraph-rss-adapter.ts` |
| 4 | `decrypt_rss` | `decrypt-rss-adapter.ts` |
| 5 | `binance_announcements` | `binance-announcements-adapter.ts` |
| 5 | `htx_announcements` | `htx-announcements-adapter.ts` |
| 5 | `bybit_announcements` | `bybit-announcements-adapter.ts` |
| 6 | `github_releases` | `github-releases-adapter.ts` |
| 7 | `infura_rpc` | `infura-rpc-adapter.ts` |
| 7 | `trongrid_intelligence` | `trongrid-intelligence-adapter.ts` |
| 7 | `mempool_space` | `mempool-space-adapter.ts` |
| 8 | `sec_edgar` | `sec-edgar-adapter.ts` |

All optional Tier 3–8 adapters are **fail-soft** — missing keys produce `UNAVAILABLE` observations, not crashes.

---

## Phase exit criteria

- [ ] `pnpm validate:market-data-integration` exits 0
- [ ] `pnpm validate:provider-readiness` exits 0
- [ ] Full test chain green
- [ ] Architect sign-off on validation checklist
- [ ] Operator optional secrets provisioned where desired
- [ ] **Full Market Data Source Integration — PASS**
- [ ] **Repeat M9 v0.1.7 may be operator-authorized** (still requires fresh campaign authorization)

---

## Related documents

| Document | Role |
|----------|------|
| [`AI-TRADER-DATA-PROVIDERS.md`](../ai-trader/AI-TRADER-DATA-PROVIDERS.md) | Binding 20/20 registry + fused context v2 |
| [`AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](../ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md) | Canonical provisioning Sections A–F |
| [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) | Prior phase record |
| [`AI-TRADER-ENGINEERING-STATUS.md`](../../replay-runs/RI-P7/AI-TRADER-ENGINEERING-STATUS.md) | Recovery entry point |
