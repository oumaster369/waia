# AI-TRADER Market Data Provider Provisioning Guide

**Status:** Canonical operator provisioning source of truth · **DEE-392 complete** · Date: 2026-07-07  
**Audience:** Operator provisioning from an empty workstation — no prior WAIA secrets assumed.

> **Authority order:** [AI-TRADER Security](AI-TRADER-SECURITY.md) · [Master Spec v2](AI-TRADER-MASTER-SPEC-v2.md) · [Data Providers binding spec](AI-TRADER-DATA-PROVIDERS.md) · parent intelligence evolution roadmap (`.cursor/plans/ai-trader_intelligence_evolution_48358215.plan.md`).

**Related (non-duplicative):**

| Document | Role |
|----------|------|
| **This guide** | **ONLY** canonical step-by-step provisioning from zero |
| [`AI-TRADER-DATA-PROVIDERS.md`](AI-TRADER-DATA-PROVIDERS.md) | Technical binding spec (registry, gateway, degradation) |
| [`DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](../ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) | Phase gate record + post-merge sequence |
| [`AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md) | Sign-off checklist |
| [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md) | Cloudflare variable inventory |

**Never commit real secret values.** Templates contain placeholders only.

---

## Section A — Architecture overview

### Runtime surfaces

| Surface | Role | Secrets belong here? |
|---------|------|----------------------|
| **Local development** | `pnpm dev`, unit/integration tests, operator CLI | `.env.local` (gitignored) — **non-HTX-trade keys only** |
| **Cloudflare Workers (production)** | Next.js on Workers, Market Brain cron, Paper loop cron, Payment watcher | Cloudflare **Secrets** + plain **Variables** in `wrangler.jsonc` / dashboard |
| **Execution Server (off-Cloudflare)** | Live order path, persistent exchange sessions (BP-6) | Operator-injected at deploy — **separate KMS path**, not Cloudflare Secrets Store |
| **Trader UI (`trader.waia.life`)** | HTX Read+Trade credential connect | **HTX API key/secret/passphrase enter here only** |

### Where secrets belong (binding)

```text
HTX trade credentials     → Trader UI → envelope encryption → Postgres (never .env / Cloudflare vars)
Master key (prod)         → Cloudflare Secrets Store (AI_TRADER_MASTER_KEY binding)
Master key (local)        → .env.local (AI_TRADER_MASTER_KEY_DEV)
Optional MI keys          → .env.local locally / wrangler secret in prod (e.g. COINGECKO_API_KEY)
Public REST endpoints     → nowhere (Binance/Bybit/Alternative.me/HTX public klines)
Payment watcher TronGrid  → wrangler secret TRONGRID_API_KEY (settlement — not MI gateway)
Deferred providers        → nowhere yet (FRED, Infura, GDELT, RSS, on-chain intelligence)
```

### Intelligence pipeline (reference)

All governed market data flows:

```text
Provider Registry → Market Data Gateway → Normalization → Validation
  → Freshness/Reliability → Context Fusion → Market Understanding Bridge (PR2.6)
```

Direct provider client imports from strategy, research, or CDE are **forbidden**.

---

## Section B — Environment variables

### File conventions

| File | Committed? | Purpose |
|------|------------|---------|
| `.env.example` | Yes | Placeholder inventory for all env names |
| `.env.local` | **No** (gitignored) | Operator local secrets and toggles |
| `.dev.vars.example` | Yes | Workers preview placeholder inventory |
| `.dev.vars` | **No** (gitignored) | Local Workers preview secrets |
| `wrangler.jsonc` | Yes | Non-secret production plain vars |
| Cloudflare Secrets | Never in git | Production server-only values |

### Market Intelligence variables

| Variable | Purpose | Required? | First required phase | Local | Production |
|----------|---------|-----------|---------------------|-------|------------|
| `HTX_REST_HOST` | HTX REST host override | Optional | Data Provider Readiness | `.env.local` optional | Cloudflare **Variable** (optional) |
| `COINGECKO_API_KEY` | CoinGecko rate-limit relief | Optional (fail-soft) | Data Provider Readiness | `.env.local` | Cloudflare **Secret** |
| `MARKET_BRAIN_ENABLED` | Enable MI cron ingest | When ingesting | Data Provider Readiness | `.env.local` | Cloudflare **Variable** |
| `MARKET_BRAIN_ORGANIZATION_ID` | Target org UUID | When MB enabled | Data Provider Readiness | `.env.local` | Cloudflare **Variable** |
| `PAPER_LOOP_*` | Paper cron config | When paper enabled | Paper loop ops | `.env.local` / `.dev.vars` | Cloudflare **Variables** |
| `AI_TRADER_MASTER_KEY_DEV` | Local credential crypto | **Required locally** for HTX UI creds | Before HTX connect (local) | `.env.local` | **Never in production** |
| `AI_TRADER_MASTER_KEY` | Production credential crypto | **Required prod** | Before HTX connect (prod) | Never | Secrets Store **binding** |
| `AI_TRADER_SEC_EDGAR_USER_AGENT` | SEC EDGAR User-Agent | Optional | Fail-soft without | `.env.local` | Secret |
| `AI_TRADER_CME_FEDWATCH_ENABLED` | CME FedWatch adapter toggle | Optional | Fail-soft when off | `.env.local` | Plain var |
| `WAIA_HTX_LIVE_SMOKE` | Live HTX integration smoke | Test-only | Never required for Repeat M9 | `.env.local` opt-in | Do not set in prod |

### Full Market Data Integration secrets (DEE-393 — optional MI providers)

| Variable | Purpose | Required? | Repeat M9 | Local | Cloudflare |
|----------|---------|-----------|-----------|-------|------------|
| `FRED_API_KEY` | FRED macro series | No | Not required | `.env.local` | Secret |
| `AI_TRADER_INFURA_PROJECT_ID` | Infura project id | No | Not required | `.env.local` | Secret |
| `AI_TRADER_INFURA_API_SECRET` | Infura API secret | No | Not required | `.env.local` | Secret |
| `AI_TRADER_TRONGRID_API_KEY` | TronGrid MI intelligence | No | Not required | `.env.local` | Secret |
| `AI_TRADER_GITHUB_TOKEN` | GitHub protocol releases | No | Not required | `.env.local` | Secret |

### Credential and platform variables (not MI gateway feeds)

| Variable | Purpose | Storage |
|----------|---------|---------|
| `WAIA_TRADER_EXECUTION_HOST_URL` | Execution host health URL | `.env.local` / Cloudflare Variable |
| `WAIA_TRADER_ORG0_ORGANIZATION_ID` | Org-0 live allowlist | Cloudflare Variable |
| `TRONGRID_API_KEY` | Payment watcher RPC auth | Cloudflare **Secret** (settlement) |
| `TRON_RPC_*`, `WATCHER_*` | Watcher tuning | Variables / optional secrets |

**Forbidden bare Infura names:** `INFURA_API_KEY`, `INFURA_PROJECT_ID` — use `AI_TRADER_INFURA_*` only.

---

## Section C — Provider catalog

For each provider: purpose, tier, Repeat M9 status, credentials, and **where they live today**.

### Tier 0 — HTX (Required for Repeat M9)

| Field | Detail |
|-------|--------|
| **Purpose** | Primary execution venue; MTF OHLCV (1m/15m/1h/4h/1d); L1 quote; account/fill truth |
| **Why AI-TRADER needs it** | Gate A MI stack requires HTX as primary market truth and execution venue |
| **Repeat M9** | **Required** (fail-closed on primary bars) |
| **Public market REST** | No API key — default `https://api.huobi.pro` |
| **Free tier** | Public endpoints sufficient for MI gateway |
| **Registration** | https://www.htx.com (account for trade API only) |
| **Trade API credentials** | HTX API Management → create Read+Trade key (**disable Withdraw**) |
| **Local storage** | Public REST: optional `HTX_REST_HOST` in `.env.local` only |
| **Cloudflare** | Optional `HTX_REST_HOST` Variable — **never trade keys** |
| **Trader UI** | **HTX key + secret + passphrase** — canonical location for trade creds |
| **Database** | Encrypted credential envelope (after UI connect) |
| **Execution server** | Decrypted at runtime for signed orders only — not env files |
| **Nowhere yet** | Trade credentials must never appear in `.env`, `.dev.vars`, or Cloudflare Variables |

### Tier 1 — CoinGecko (Required fail-soft for Repeat M9)

| Field | Detail |
|-------|--------|
| **Purpose** | Global crypto market stats (dominance, cap backdrop) |
| **Why** | Cross-asset regime context for understanding bridge |
| **Repeat M9** | Required (fail-soft without key) |
| **Free tier** | Demo API sufficient; public `/api/v3/global` works unauthenticated |
| **Recommended** | CoinGecko Demo API key for rate limits |
| **Registration** | https://www.coingecko.com/en/developers/dashboard |
| **Credentials issued** | Demo API key (header `x-cg-demo-api-key`) |
| **Local** | `COINGECKO_API_KEY` in `.env.local` |
| **Cloudflare** | `wrangler secret put COINGECKO_API_KEY` |
| **Trader UI / DB** | No |

### Tier 1 — Binance Public (Required fail-soft)

| Field | Detail |
|-------|--------|
| **Purpose** | Cross-exchange price confirmation |
| **Why** | Cross-venue triangulation (PR2.6) |
| **Repeat M9** | Required (fail-soft) |
| **Auth** | None — public market endpoints |
| **Registration** | Not required |
| **Local / Cloudflare / UI / DB** | **Nowhere** — no credentials |

### Tier 1 — Bybit Public (Required fail-soft)

Same as Binance — public v5 market tickers, no credentials, nowhere to store.

### Tier 2 — Alternative.me (Required fail-soft)

| Field | Detail |
|-------|--------|
| **Purpose** | Fear & Greed Index |
| **Why** | Crowd psychology evidence (MVP context flag) |
| **Repeat M9** | Required (fail-soft) |
| **Auth** | None — `https://api.alternative.me/fng/` |
| **Local / Cloudflare / UI / DB** | **Nowhere** |

### Tier 3 — FRED (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | Macro rates, monetary aggregates |
| **Why** | Macro evidence in fused context v2 |
| **Repeat M9** | **Not required** (fail-soft) |
| **Free tier** | FRED API free with registration |
| **Registration** | https://fredaccount.stlouisfed.org |
| **Env var** | `FRED_API_KEY` |
| **Local** | `.env.local` |
| **Cloudflare** | `wrangler secret put FRED_API_KEY` |
| **Adapter** | `fred-adapter.ts` |

### Tier 3 — Federal Reserve (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | Macro calendar event proximity |
| **Repeat M9** | Not required |
| **Auth** | No auth — public calendar |
| **Adapter** | `federal-reserve-adapter.ts` |

### Tier 3 — CME FedWatch (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | Rate probability backdrop |
| **Repeat M9** | Not required |
| **Env var** | `AI_TRADER_CME_FEDWATCH_ENABLED` (opt-in) |
| **Adapter** | `cme-fedwatch-adapter.ts` |

### Tier 4 — GDELT, CoinDesk RSS, Cointelegraph RSS, Decrypt RSS (Implemented — Repeat M9 deferred)

News evidence adapters — public feeds, no auth. Adapters in `lib/trader/market-data/adapters/*-rss-adapter.ts` and `gdelt-adapter.ts`.

### Tier 5 — Exchange announcements (Binance, HTX, Bybit) (Implemented — Repeat M9 deferred)

Event proximity for listings/maintenance — `*-announcements-adapter.ts` modules.

### Tier 6 — GitHub Public API (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | Protocol release intelligence |
| **Env var** | Optional `AI_TRADER_GITHUB_TOKEN` |
| **Adapter** | `github-releases-adapter.ts` |

### Tier 7 — Infura / MetaMask RPC (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | EVM network stats for blockchain evidence |
| **Registration** | https://app.infura.io |
| **Env vars** | `AI_TRADER_INFURA_PROJECT_ID`, `AI_TRADER_INFURA_API_SECRET` |
| **Adapter** | `infura-rpc-adapter.ts` |
| **Separate from** | Payment watcher — not bare `INFURA_*` names |

### Tier 7 — TronGrid AI-TRADER intelligence (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | TRON on-chain network stats |
| **Registration** | https://www.trongrid.io/dashboard/ |
| **Env var** | `AI_TRADER_TRONGRID_API_KEY` |
| **Critical** | **Separate key** from `TRONGRID_API_KEY` payment watcher |
| **Adapter** | `trongrid-intelligence-adapter.ts` |

### Tier 7 — mempool.space (Implemented — Repeat M9 deferred)

Bitcoin mempool REST — no auth. Adapter: `mempool-space-adapter.ts`.

### Tier 8 — SEC EDGAR (Implemented — Repeat M9 deferred)

| Field | Detail |
|-------|--------|
| **Purpose** | Regulatory filing evidence |
| **Env var** | `AI_TRADER_SEC_EDGAR_USER_AGENT` (policy-bound) |
| **Adapter** | `sec-edgar-adapter.ts` |

### Settlement — TronGrid Payment Watcher (not MI gateway)

| Field | Detail |
|-------|--------|
| **Purpose** | USDT TRC-20 deposit observation (WAIA Core settlement) |
| **Repeat M9** | Not required for MI |
| **Registration** | https://www.trongrid.io |
| **Local** | `.env.local` / `.dev.vars` for preview |
| **Cloudflare** | `TRONGRID_API_KEY` **Secret** |
| **Why separate from MI** | Settlement trust boundary ≠ market intelligence analytics |

---

## Section D — HTX trade credentials lifecycle

### Why HTX Read/Trade credentials must NEVER be in env files

Per [AI-TRADER Security](AI-TRADER-SECURITY.md):

1. API key, secret, and passphrase are **never stored in plaintext**.
2. Credentials must **never** reach the browser or logs.
3. Envelope encryption requires a **managed master key** before real credentials persist.
4. Env files are copied, logged in CI, and leaked in support bundles — incompatible with exchange trade secrets.
5. Cloudflare plain Variables are visible to anyone with project access — not a credential vault for trade keys.

**Forbidden locations for HTX trade credentials:**

- `.env`, `.env.local`, `.dev.vars`
- Cloudflare plain Variables
- `wrangler.jsonc` committed config
- Documentation, fixtures, tests, PR bodies

### Canonical lifecycle

```text
1. Operator creates HTX API key (Read+Trade only; Withdraw disabled)
2. Operator opens Trader Workspace → Connect HTX
3. UI submits key/secret/passphrase to server connect handler
4. Server validates permissions where HTX metadata exposes them
5. Envelope encryption wraps credential with master key (AI_TRADER_MASTER_KEY_*)
6. Encrypted blob persisted in Postgres (exchange_credentials)
7. Execution path decrypts in memory only for signed REST calls
8. Rotation: disconnect/reconnect in Trader UI; rotate master key per DEE-220 if compromised
9. Revocation: delete credential in admin/Trader UI; disable HTX key at exchange
```

Public market data (klines, ticker) uses **no trade credentials** — only optional `HTX_REST_HOST`.

---

## Section E — Canonical provisioning sequence

Starting from an **empty machine** with repo cloned.

### Phase 0 — Workstation bootstrap

1. Install Node 22+, pnpm, git.
2. Clone `waia` repository; checkout `dev` @ latest.
3. `cp .env.example .env.local` — leave placeholders empty initially.
4. `cp .dev.vars.example .dev.vars` if using Workers preview.

### Phase 1 — Local master key (required before HTX UI connect)

1. `openssl rand -base64 32` → set `AI_TRADER_MASTER_KEY_DEV=` in `.env.local`.
2. Set `AI_TRADER_MASTER_KEY_MODE=dev` and `WAIA_DEPLOYMENT_TIER=local`.
3. Verify: `curl http://127.0.0.1:3000/api/health/master-key` (when dev server running) → productionReady appropriate for local.

See [`DEE-220-MASTER-KEY-RUNBOOK.md`](../ops/DEE-220-MASTER-KEY-RUNBOOK.md).

### Phase 2 — Optional MI keys (non-HTX-trade)

1. Register CoinGecko developer account (optional).
2. Add `COINGECKO_API_KEY=` to `.env.local` if desired.
3. Set `MARKET_BRAIN_ENABLED=1` and `MARKET_BRAIN_ORGANIZATION_ID=<org-uuid>` for local cron testing.
4. Optionally set `HTX_REST_HOST` if not using default host.

**Do not add HTX trade key/secret to `.env.local`.**

### Phase 3 — Repository readiness audit

```bash
set -a && source .env.local && set +a
pnpm validate:provider-readiness
pnpm validate:market-data-integration
pnpm lint && pnpm typecheck && pnpm test --run
```

Fix any FAIL before continuing.

### Phase 4 — HTX trade credentials (Trader UI)

1. Create HTX API key (Read+Trade; no Withdraw).
2. Log in to local or staging Trader portal.
3. Connect HTX via Trader Workspace UI.
4. Verify balance sync: `/api/trader/exchange-credentials` + sync endpoints.

### Phase 5 — Cloudflare production provisioning

1. Provision Secrets Store + `AI_TRADER_MASTER_KEY` per DEE-220.
2. Set plain vars: `MARKET_BRAIN_ENABLED`, `MARKET_BRAIN_ORGANIZATION_ID`, optional `HTX_REST_HOST`.
3. `wrangler secret put COINGECKO_API_KEY` (optional).
4. Optional Tier 3–8 secrets: `FRED_API_KEY`, `AI_TRADER_INFURA_*`, `AI_TRADER_TRONGRID_API_KEY`, `AI_TRADER_GITHUB_TOKEN`, `AI_TRADER_SEC_EDGAR_USER_AGENT`.
5. Set `AI_TRADER_CME_FEDWATCH_ENABLED=1` if enabling CME FedWatch adapter.
6. `wrangler secret put TRONGRID_API_KEY` (payment watcher — if settlement enabled).
5. Deploy Worker from `dev` lineage.

See [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md).

### Phase 6 — Execution server (when live path enabled)

1. Provision isolated execution host per [`DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md`](../ops/DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md).
2. Set `WAIA_TRADER_EXECUTION_HOST_URL` — health check only in BP-6.
3. **No HTX trade secrets in execution host env** — credentials flow from encrypted store at runtime.

### Phase 7 — Health and provider verification (no Repeat M9)

| Check | Command / endpoint |
|-------|-------------------|
| Master key | `GET /api/health/master-key` |
| Database | `GET /api/health/database` |
| Payment watcher | `GET /api/health/payment-watcher` |
| Provider unit tests | `pnpm test --run tests/unit/trader-market-data-pr25.test.ts` |
| Provider adapters | `pnpm test --run tests/unit/trader-provider-adapters.test.ts` |
| Gateway integration | `pnpm test --run tests/integration/trader-htx-bar-poll-cycle.test.ts` |
| Readiness audit | `pnpm validate:provider-readiness` |
| Integration audit | `pnpm validate:market-data-integration` |

Optional live smoke: `WAIA_HTX_LIVE_SMOKE=1 pnpm test --run tests/integration/trader-htx-candles-live-smoke.test.ts`

### Phase 8 — System verification / first startup

1. Confirm Market Brain cron completes (`MARKET_BRAIN_CYCLE_OK` telemetry when enabled).
2. Confirm paper loop cycle completes if `PAPER_LOOP_ENABLED=1`.
3. Confirm fused context shows provider observations or documented degradation reasons.
4. Sign [`AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md`](AI-TRADER-DATA-PROVIDER-VALIDATION-CHECKLIST.md).

**Stop here for Data Provider Readiness.** Proceed to Full Market Data Source Integration (DEE-393) before Repeat M9.

### Phase 9 — Full Market Data Integration validation (DEE-393)

1. Add optional Tier 3–8 keys from `.env.example` comments.
2. Run `pnpm validate:market-data-integration` — all audits PASS.
3. Run gateway/integration tests listed in [`DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md`](../ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md).
4. Sign validation checklist DEE-393 section.

**Stop here for Full Market Data Source Integration.** Do not start Repeat M9 until operator sign-off.

---

## Section F — Operator readiness checklist

Required **before Full Market Data Source Integration** grooming:

- [ ] `dev` includes DEE-392 merge (`9c1df25` or later)
- [ ] `pnpm validate:provider-readiness` passes on operator workstation
- [ ] `.env.local` configured (master key + optional MI vars; **no HTX trade creds**)
- [ ] Cloudflare production secrets/vars provisioned per Section E Phase 5
- [ ] HTX trade credentials connected via Trader UI; balance sync verified
- [ ] CoinGecko key provisioned or documented fail-soft acceptance
- [ ] Public providers (Binance/Bybit/Alternative.me) verified via unit/integration tests
- [ ] Payment watcher `TRONGRID_API_KEY` separate from future AI-TRADER intelligence key
- [ ] Architect sign-off on validation checklist

Required **before Repeat M9 v0.1.7** (in addition to above):

- [ ] **Full Market Data Source Integration** phase complete (DEE-393 merged)
- [ ] `pnpm validate:market-data-integration` passes on operator workstation
- [ ] End-to-end provider validation through gateway path (20/20 registry)
- [ ] `order_book_snapshot` implemented via HTX depth adapter
- [ ] Fused context v2 verified (`waia.trader.fused_context.v2`)
- [ ] Provider sidecar v2 captured: `pnpm trader:m9:capture-sidecar -- --output=<vault>/m9-provider-sidecar.json`
- [ ] Blind authorization digest recomputed with `sidecarContentDigest` in scope
- [ ] M9 campaign run with `--require-provider-fusion=1` produces fusion + decision trace artifacts
- [ ] Fresh operator authorization for M9 v0.1.7 campaign
- [ ] Gate A accounting prerequisites (PR1+PR2) unchanged and verified

---

## Phase exit — Full Market Data Source Integration (DEE-393)

- [ ] All Tier 3–8 adapters registered and fail-soft
- [ ] Seven integration env vars documented and cron-bridged
- [ ] `pnpm validate:market-data-integration` exits 0
- [ ] Architect sign-off on validation checklist DEE-393 section
- [ ] **Full Market Data Source Integration — PASS**
- [ ] **Repeat M9 v0.1.7 may be operator-authorized**

---

## Deferred intentionally

| Item | Deferred to |
|------|-------------|
| Tier 3–8 deep CDE feature consumption | PR3–PR4 (evidence delivered today) |
| Repeat M9 v0.1.7 campaign | After DEE-393 merge + operator validation |
| PR3 Market Context depth | After Gate A |
| PR4 Market Memory / news engines | After Gate A |
