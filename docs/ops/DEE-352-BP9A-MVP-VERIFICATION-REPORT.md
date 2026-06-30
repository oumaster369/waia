# DEE-352 — BP-9A Full MVP Verification Report

**Linear:** [DEE-352](https://linear.app/deepsense/issue/DEE-352/bp-9a-full-mvp-verification-production-configuration-inventory) — **Done** (Step 10 complete)  
**Blocks:** [DEE-340](https://linear.app/deepsense/issue/DEE-340) (BP-10) — L0 **COMPLETE**; **HC-1 NEXT** (see §15)  
**Branch:** `dee-352-bp9a-mvp-verification` — **merged** via [PR #318](https://github.com/oumaster369/waia/pull/318)  
**Ratification charter:** **RATIFIED** via [PR #319](https://github.com/oumaster369/waia/pull/319); Step 10 governance closure via [PR #320](https://github.com/oumaster369/waia/pull/320)  
**Canonical `dev` SHA:** `16117d01745d2552bc6275120bf799c082d20d30` (PR #320 governance closure; PR #319 docs charter `cb48863`; implementation baseline `2071130` PR #318)  
**Baseline SHA (Phase 1 start):** `0149267` (`dev` post BP-9 / PR #317)  
**Production Worker (canonical lineage):** `86bde72b-b945-48c0-99ce-eaf0500f8aeb` — deployed from `dev` @ `2071130` (2026-06-29)  
**Verified at:** 2026-06-28 (Phase 1); governance reconciliation 2026-06-29; **Step 10** 2026-06-29  
**Mode:** Verification only — no secret values in this document

---

## Executive summary

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase 1** — Inventory verification | **COMPLETE (Composer)** | Repo/docs audit, classification, validation chain, dry-run drill |
| **Phase 1 gate** — Human acceptance | **COMPLETE** | Adamar / Architect-Operator, 2026-06-28 (§9) |
| **Launch Readiness Review** | **ACCEPTED** | [DEE-352-LAUNCH-READINESS-REVIEW.md](DEE-352-LAUNCH-READINESS-REVIEW.md) — **READY WITH CONDITIONS**, 2026-06-28 |
| **Phase 2** — Operator provisioning | **COMPLETE** | Steps 1–9A **PASS** (2026-06-29); PR #318 + PR #319 + PR #320 merged; **11/11 PASS** |
| **Phase 2** — Step 10 Architect decision | **COMPLETE** | Adamar / Architect-Operator, 2026-06-29 (§10, §12); [MVP Ratification](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) **RATIFIED** |
| **BP-10** | **L0 COMPLETE — HC-1 NEXT** | DEE-352 **Done**; L0 merged PR #322; see §15 |

**Checklist numbering:** Program doc lists criteria **1–14**; BP-9A adds **15** (live Telegram drill) and **16** (signed inventory) → **14+2 = 16** for DEE-340 alignment.

---

## MVP Scope Freeze

After BP-9, **no new MVP functionality** may be added before BP-10.

**Allowed work only:**

- configuration
- verification
- production provisioning
- evidence capture
- critical bug fixes approved by Architect

**Forbidden:**

- new trading features
- new alert channels
- new UI flows
- new runtime
- new scheduler / daemon / websocket
- architecture changes

---

## Release Decision

**Current state:** **BP-9A COMPLETE — READY FOR BP-10 LAUNCH GATE (DEE-340)**

**Launch Readiness Review:** **ACCEPTED** — [DEE-352-LAUNCH-READINESS-REVIEW.md](DEE-352-LAUNCH-READINESS-REVIEW.md) (READY WITH CONDITIONS; Adamar / Architect-Operator, 2026-06-28).

**Reasons:**

- Phase 2 Step 1 (Postgres) **PASS** — migrations **64/64**; RLS **43/172** — **1/10 PASS**
- Phase 2 Step 2 (Secrets Store / master key) **PASS** — store **`waia-ai-trader-secrets`**; binding **`AI_TRADER_MASTER_KEY`**; tier **`production`** — **2/10 PASS**
- Phase 2 Step 3 (Trader host DNS) **PASS** — trader host **200/307**; Supabase redirect attested — **3/10 PASS**
- Phase 2 Step 4 (Org-0 identity + admin) **PASS** — Org-0 org prefix **`3c50b4e9…`**; platform **`admin`**; **`trader`** entitlement; Worker env configured — **4/10 PASS**
- Phase 2 Step 5 (HTX Org-0 connect + first sync) **PASS** — Trader Workspace user flow; credential **1**; snapshots recorded; trade-history 48h empty accepted — **5/11 PASS**
- Phase 2 Step 6 (Payment watcher scan cycle) **PASS** — health **200**; checkpoint advancing; **not** attribution — **6/11 PASS**
- Phase 2 Step 7 (Telegram alerting) **PASS** — health configured; production drill `outcome:success` — **7/11 PASS**
- Phase 2 Step 8 (Execution host) **PASS** — isolated host `waia-org0-execution`; `GET /health → 200`; health JSON `status:ok` — **8/11 PASS**
- Phase 2 Step 9 (Cron workers) **PASS** — runtime compatibility gate; MB + paper `cycle_complete`; deploy **`07408a7a…`** — **9/11 PASS**
- Phase 2 Step 9A (Payment address registry) **PASS** — first Org-0 inbound wallet **`788f0fdc…`**; address **`TSBJRwVc…`** ACTIVATED; resolver ready — **10/11 PASS**
- Payment Watcher runtime recovery **PASS** — stale-lease handling + Worker-safe imports — see §10.1 (pre-merge deploy **`c47176f9…`**; post-merge canonical deploy **`86bde72b…`** @ `2071130`)
- Step 10 Architect decision **PASS** — `WAIA_CORE_ENFORCEMENT` **OFF**; UNKNOWN inventory resolved; [MVP Ratification](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) **RATIFIED**; §12 signed — **11/11 PASS**
- OpenAI for AI-TRADER — **N/A for BP-9A** (Twin-only `WAIA_AI_*`)

**Phase 2 verdict (final):** Steps 1–9A + Step 10 **PASS**; Payment Watcher runtime recovery **PASS** (§10.1); BP-9A **COMPLETE** (**11/11 PASS**).

---

## Production environment audit (2026-06-28)

> **Historical snapshot — pre-Phase 2 provisioning.** Retained for audit trail only. Do **not** use this section for current production state. Authoritative runtime evidence: §5 health probes, §10 step tables, §10.1 watcher recovery (deploy **`c47176f9…`**, 2026-06-29).

**Active Worker:** `waia-app` · version **`8be7d73b-fabb-4526-8e42-a29b6fea27ae`** (deployed 2026-06-27) · handlers `fetch`, `scheduled` · account via `wrangler secret list` / `wrangler versions view` / runtime HTTP probes.

**Repo divergence (informational):** `origin/dev` @ `0149267` (BP-9 merged); `origin/main` @ `bf047c4` (pre-BP-9); production Worker predates BP-9 code paths.

### Audit summary table

| Item | Required | Present | Missing | Unknown | Evidence source |
|------|----------|---------|---------|---------|-----------------|
| **Worker — core** | | | | | |
| `name: waia-app`, `main: custom-worker.ts` | Yes | Yes | — | — | `wrangler.jsonc`; `wrangler versions view 8be7d73b` |
| Cron `* * * * *` (`scheduled` handler) | Yes | Yes | — | — | `wrangler.jsonc`; version handlers `fetch, scheduled` |
| `ASSETS` binding | Yes | Yes | — | — | `wrangler versions view 8be7d73b` |
| `WORKER_SELF_REFERENCE` binding | Yes | Yes | — | — | `wrangler versions view 8be7d73b` |
| **Worker — plain env (committed + deployed)** | | | | | |
| `NEXT_PUBLIC_SITE_URL` | Yes | Yes | — | — | Version env `https://waia.life` |
| `NEXT_PUBLIC_TRADER_URL` | Yes | Yes | — | — | Version env `https://trader.waia.life` |
| `WAIA_TRADER_HOST` | Yes | Yes | — | — | Version env `trader.waia.life` |
| `OAUTH_PUBLIC_BASE_URL` | If OAuth | Yes | — | — | Version env `https://waia.life` |
| `WAIA_DB_BACKEND=postgres` | Yes | Yes | — | — | Version env; `GET /api/health/database` → `backend: postgres` |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | If Supabase | Yes | — | — | Version env |
| `WAIA_AI_*` gateway tuple | Twin AI | Yes | — | — | Version env (5 vars) |
| `WAIA_DEPLOYMENT_TIER=production` | Yes (BP-10) | Yes | — | — | Step 2 PASS — deployed plain env `production` (2026-06-28) |
| `WAIA_CORE_ENFORCEMENT` | Recommended | — | — | Yes | Not on active version; Architect decision pending |
| `WAIA_POSTGRES_PER_REQUEST_CLIENT` | Optional | — | — | Yes | Not set; defaults on in code |
| `WATCHER_ENABLED=1` | Yes (watcher) | — | Yes | — | Not on active version env list |
| `MARKET_BRAIN_ENABLED` + org id | Yes (ingestion) | — | Yes | — | Not on active version env list |
| `PAPER_LOOP_*` | Yes (paper cron) | — | Yes | — | Not on active version env list |
| `HTX_REST_HOST` | Yes (market brain) | — | Yes | — | Not on active version env list |
| `WAIA_TRADER_ORG0_ORGANIZATION_ID` | Yes (Org-0) | — | Yes | — | Not on Worker env list |
| **Worker — secrets (names only)** | | | | | |
| `DATABASE_URL_POSTGRES` | Yes | Yes | — | — | `wrangler secret list`; version secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | If Supabase | Yes | — | — | `wrangler secret list`; version secrets |
| `WAIA_AI_OPENAI_API_KEY` | Twin AI | Yes | — | — | `wrangler secret list`; version secrets |
| `OPENAI_API_KEY` (legacy) | Optional | Yes | — | — | `wrangler secret list`; DEE-128 note — do not remove unchartered |
| `DATABASE_URL` (legacy SQLite) | No (prod) | Yes | — | — | `wrangler secret list` — present but superseded by postgres path |
| `TELEGRAM_ALERTS_BOT_TOKEN` | Yes (BP-9) | — | Yes | — | Absent from `wrangler secret list` |
| `TELEGRAM_ALERTS_CHAT_ID` | Yes (BP-9) | — | Yes | — | Absent from `wrangler secret list` |
| `TELEGRAM_ALERTS_THREAD_ID` | Yes (BP-9) | — | Yes | — | Absent from `wrangler secret list` |
| `TRONGRID_API_KEY` | Yes (watcher) | — | Yes | — | Absent from `wrangler secret list` |
| `TRON_RPC_PRIMARY_URL` / secondary / API key | Yes (watcher) | — | Yes | — | Absent from `wrangler secret list` |
| OAuth provider secrets | Optional | — | Yes | — | Absent from `wrangler secret list` |
| **Worker — bindings** | | | | | |
| `AI_TRADER_MASTER_KEY` Secrets Store | Yes (HTX crypto) | Yes | — | — | Step 2 PASS — store **`waia-ai-trader-secrets`**; binding **`AI_TRADER_MASTER_KEY`** active (2026-06-28) |
| **Postgres** | | | | | |
| `DATABASE_URL_POSTGRES` secret | Yes | Yes | — | — | `wrangler secret list` |
| `WAIA_DB_BACKEND=postgres` | Yes | Yes | — | — | Version env + health JSON |
| Production migration chain applied | Yes | — | — | Yes | Health OK; `GET /api/health/payment-watcher → 500` (empty body) — schema/watcher gap possible; no migration query run |
| RLS policies applied | Yes | — | — | Yes | Migrations in repo; production apply not confirmed |
| **Telegram (BP-9)** | | | | | |
| `TELEGRAM_ALERTS_BOT_TOKEN` | Yes | — | Yes | — | `wrangler secret list` |
| `TELEGRAM_ALERTS_CHAT_ID` | Yes | — | Yes | — | `wrangler secret list` |
| `TELEGRAM_ALERTS_THREAD_ID` | Yes | — | Yes | — | `wrangler secret list` |
| `/api/health/alerting` route | Yes | — | Yes | — | `GET https://waia.life/api/health/alerting → 404` (BP-9 not in prod deploy) |
| **HTX / Org-0** | | | | | |
| Org-0 API credentials (encrypted) | Yes | — | Yes | — | No Worker binding; no runtime proof |
| `WAIA_TRADER_ORG0_ORGANIZATION_ID` | Yes | — | Yes | — | Not on Worker env |
| **Payment watcher** | | | | | |
| `WATCHER_ENABLED=1` | Yes | — | Yes | — | Not on Worker env |
| `TRONGRID_API_KEY` / `TRON_RPC_*` | Yes | — | Yes | — | `wrangler secret list` |
| `/api/health/payment-watcher` | Yes | — | — | Yes | `GET → HTTP 500` (route exists; unhealthy / error) |
| **Execution host** | | | | | |
| `WAIA_TRADER_EXECUTION_HOST_URL` | Yes | — | Yes | — | Operator vault only; **not** on Worker env (Step 8 PASS) |
| Isolated host deployed | Yes | — | Yes | — | Step 8 PASS — hostname **`waia-org0-execution`**; off-Cloudflare Ubuntu VPS; `/health → 200` |
| **AI Trader / tier** | | | | | |
| `AI_TRADER_MASTER_KEY` binding | Yes | Yes | — | — | Step 2 PASS — binding active; secret **`ai-trader-master-key-v1`** active (2026-06-28) |
| `WAIA_DEPLOYMENT_TIER=production` | Yes | Yes | — | — | Step 2 PASS — deployed plain env `production` (2026-06-28) |
| **DNS / trader host** | | | | | |
| `trader.waia.life` custom domain | Yes | Yes | — | — | `curl trader.waia.life/trader → 307`; `/ → 200` |
| `waia.life` custom domain | Yes | Yes | — | — | Health probes succeed |
| **Runtime health probes** | | | | | |
| `GET /api/health/database` | Yes | Yes | — | — | `200`, `{"backend":"postgres","ok":true}` |
| `GET /api/health/master-key` | Yes | Yes | — | — | Step 2 PASS — `200`, `productionReady:true`, `keyVersion:v1` (2026-06-28) |
| `GET /api/health/alerting` | Yes | — | Yes | — | `404` |
| `GET /api/health/payment-watcher` | Yes | — | — | Yes | `500` |
| `GET /api/health/settlement` | Yes | — | — | Yes | `500` |
| `GET /api/health/settlement-reconciliation` | Yes | — | — | Yes | `500` |
| **Hyperdrive** | Optional | — | — | Yes | `hyperdrive_configs_list` → 0 configs |

**Audit method:** `wrangler secret list`, `wrangler versions view 8be7d73b`, `wrangler deployments status`, `wrangler secrets-store store list`, Cloudflare MCP `hyperdrive_configs_list`, HTTPS probes to `waia.life` / `trader.waia.life`. **No secret values read or recorded.**

---

## 1. Validation chain (Phase 1)

Executed on branch `dee-352-bp9a-mvp-verification` at baseline `0149267`:

| Command | Result |
|---------|--------|
| `pnpm lint` | **PASS** (0 errors, 49 warnings — pre-existing) |
| `pnpm typecheck` | **PASS** |
| `pnpm test --run` | **PASS** — 1864 passed, 77 skipped (294 files) |
| `pnpm build` | **PASS** |
| `pnpm trader:alert:drill --dry-run` | **PASS** — `outcome=dry_run`, `configured=false` (no alerting secrets locally) |

**Tenant-isolation gate:** 31 unit test files match `*tenant-isolation*`; CI job `tenant-isolation` in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs `pnpm test --run tenant-isolation` as release blocker (ADR-0007).

---

## 2. Production Configuration Inventory

**Status vocabulary (strict):**

| Status | Meaning |
|--------|---------|
| **PASS** | Verified with non-value proof in Phase 1 or Phase 2 |
| **PRESENT — awaiting runtime verification** | Name confirmed on production Worker (secret list, version env, or partial HTTP probe); full step acceptance not yet recorded |
| **VERIFIED IN CODE** | Implementation present in repository; production proof not yet recorded |
| **OPERATOR REQUIRED** | Human must provision or attest before BP-10 |
| **UNKNOWN** | Production state not confirmable from repo alone |
| **NOT APPLICABLE** | Out of scope for BP-10 or local-dev only |
| **INFORMATIONAL GAP** | Documented gap that does not alone block BP-10 |

**Verified by (source model):**

| Source | Use when |
|--------|----------|
| Repository | Code, docs, placeholders in git |
| CI | GitHub Actions / local test chain |
| Operator | Human attestation without secret values |
| Runtime | Production/staging HTTP or CLI (Phase 2) |
| Cloudflare | Worker env, secrets bindings, DNS (Phase 2) |
| Supabase/Postgres | Migrations, RLS, pooler (Phase 2) |
| Telegram | Forum topic delivery proof (Phase 2) |
| HTX | Connect/sync permission proof (Phase 2) |
| Execution Host | Host health / BP-7 evidence (Phase 2) |

**Legend — inventory Status (Phase 1):** repo/docs classification only unless **PASS** noted.

**Verified by** column records source model; Phase 2 fills non-value proofs.

### 2.1 Cloudflare / Worker

| Category | Name / Binding | Required for | Source | Storage location | Placeholder in repo? | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------------|---------------|--------|-------------|
| Worker | `name: waia-app`, `main: custom-worker.ts` | Deploy | [wrangler.jsonc](../../wrangler.jsonc) | wrangler.jsonc | Yes | Yes | **VERIFIED IN CODE** | Repository |
| Worker | Cron `* * * * *` | Payment watcher + settlement | wrangler.jsonc | Cloudflare cron | Yes | Yes | **PRESENT — awaiting runtime verification** | Version handlers `scheduled`; watcher vars missing |
| Worker | `ASSETS` binding | Static assets | wrangler.jsonc | Cloudflare | Yes | Yes | **PRESENT — awaiting runtime verification** | `wrangler versions view 8be7d73b` |
| Worker | `WORKER_SELF_REFERENCE` | Self-invoke | wrangler.jsonc | Cloudflare | Yes | Yes | **PRESENT — awaiting runtime verification** | `wrangler versions view 8be7d73b` |
| Worker | `AI_TRADER_MASTER_KEY` Secrets Store binding | HTX credential crypto | [DEE-220 runbook](DEE-220-MASTER-KEY-RUNBOOK.md) | Cloudflare Secrets Store | wrangler.jsonc | Yes | **PASS** | Store **`waia-ai-trader-secrets`**; binding active; health `productionReady:true` (2026-06-28) |
| Plain env | `NEXT_PUBLIC_SITE_URL` | Auth redirects | wrangler.jsonc | Cloudflare plain | Yes | Yes | **PRESENT — awaiting runtime verification** | Version env `https://waia.life` |
| Plain env | `NEXT_PUBLIC_TRADER_URL` | Trader portal links | wrangler.jsonc | Cloudflare plain | Yes | Yes | **PASS** | Step 3 — version env `https://trader.waia.life`; runtime **200** (2026-06-28) |
| Plain env | `WAIA_TRADER_HOST` | Host routing | wrangler.jsonc | Cloudflare plain | Yes | Yes | **PASS** | Step 3 — version env `trader.waia.life`; `x-waia-module: trader` (2026-06-28) |
| Plain env | `OAUTH_PUBLIC_BASE_URL` | OAuth callbacks | wrangler.jsonc | Cloudflare plain | Yes | If OAuth | **PRESENT — awaiting runtime verification** | Version env `8be7d73b` |
| Plain env | `WAIA_DB_BACKEND=postgres` | Worker DB path | wrangler.jsonc | Cloudflare plain | Yes | Yes | **PRESENT — awaiting runtime verification** | Version env + health `200` |
| Plain env | `WAIA_DEPLOYMENT_TIER=production` | Master key readiness | DEE-220 | Cloudflare plain | .env.example | Yes | **PASS** | Deployed plain env `production` (2026-06-28) |
| Plain env | `WAIA_CORE_ENFORCEMENT` | Permission fail-closed | M1 runbook | Cloudflare plain | .env.example | Recommended | **ACCEPTED (Step 10)** | **OFF** — unset on production Worker; app-layer enforcement primary (ADR-0007); enable post-MVP via ADR |
| Plain env | `WAIA_CORE_SHADOW` | Shadow audit | lib/waia-core/config.ts | Cloudflare plain | .env.example | No | **NOT APPLICABLE** | — |
| Plain env | `WAIA_POSTGRES_PER_REQUEST_CLIENT` | PG lifecycle | cloudflare-env-vars.md | Cloudflare plain | .dev.vars.example | Yes | **WAIVED (Step 10)** | Not set; code default acceptable for MVP Worker Postgres |
| Secret | `DATABASE_URL_POSTGRES` | All trader/core Postgres | DEE-74/75 | Wrangler secret | .dev.vars.example | Yes | **PRESENT — awaiting runtime verification** | `wrangler secret list`; health `200` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin | cloudflare-env-vars.md | Wrangler secret | .dev.vars.example | If Supabase | **PRESENT — awaiting runtime verification** | `wrangler secret list` |
| Public | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Supabase client | wrangler.jsonc | Cloudflare plain | wrangler + .dev.vars.example | If Supabase auth | **PRESENT — awaiting runtime verification** | Version env `8be7d73b` |
| Secret | OAuth provider secrets | Login | cloudflare-env-vars.md | Wrangler secrets | .env.example | Optional | **OPERATOR REQUIRED** | Absent from `wrangler secret list` |
| Secret | `WAIA_AI_OPENAI_API_KEY` | Twin AI | cloudflare-env-vars.md | Wrangler secret | .env.example | If AI enabled | **PRESENT — awaiting runtime verification** | `wrangler secret list` |
| Worker cron | `MARKET_BRAIN_ENABLED` + org id | MSV/CDE ingestion | .env.example | Cloudflare | Placeholder | Yes for live data | **PASS** | Step 9 Build B — deploy **`07408a7a…`** |
| Worker cron | `PAPER_LOOP_*` vars | Paper loop cron | .env.example | Cloudflare | Placeholder | Yes for paper | **PASS** | Step 9 Build B — `org0-paper-primary` account key |
| CI | `LINEAR_API_KEY` | Auto Done on merge | .env.example | GitHub Actions secret | Documented | No | **WAIVED (Step 10)** | CI operational; not BP-10 inventory; hardening deferred post-MVP |
| CI | `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` | Preview deploy | docs | GitHub secrets | N/A | No | **WAIVED (Step 10)** | Preview CI green on PR #318/#319; not BP-10 critical |

### 2.2 AI-TRADER exchange / HTX

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------|
| HTX | Org-0 API credentials (encrypted) | Live + sync | BP-7 runbook | Encrypted credential service | Yes | **PASS** | Step 5 — credential **1** active; balances **2** / positions **2** / trade-history **1** (trade_count **0**, 48h window); deploy **`c6ea275c…`** |
| HTX | `AI_TRADER_MASTER_KEY` binding | Decrypt | DEE-220 | Secrets Store | Yes | **PASS** | Binding active; Step 5 credential **1** row decrypt path exercised (2026-06-28) |
| HTX | `WAIA_TRADER_ORG0_ORGANIZATION_ID` | Org-0 allowlist | .env.example | Operator env | Yes | **PASS** | Step 4 — deployed Worker **`8e4d4c62…`**; org prefix **`3c50b4e9…`** |
| HTX | `HTX_REST_HOST` | Market brain REST | .env.example | Cloudflare plain | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| HTX | Forbidden permissions enforced | Security | MVP Scope | DB credential row | Yes | **VERIFIED IN CODE** | Repository; HTX connect PENDING |
| HTX | Balance/position/trade sync | Account status | BP-2C APIs | N/A | Yes | **VERIFIED IN CODE** | Repository; HTX runtime proof pending |

### 2.3 Telegram alerting (BP-9)

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------|
| Alerts | `TELEGRAM_ALERTS_BOT_TOKEN` | sendMessage | DEE-223 runbook | Wrangler secret | Yes | **PASS** | `wrangler secret list`; drill `outcome:success` |
| Alerts | `TELEGRAM_ALERTS_CHAT_ID` | Forum group | DEE-223 runbook | Wrangler secret | Yes | **PASS** | Name present; health `configured:true` |
| Alerts | `TELEGRAM_ALERTS_THREAD_ID` | Alerts topic | DEE-223 runbook | Wrangler secret | Yes | **PASS** | Name present; drill delivered to forum topic |
| Alerts | Dedicated bot (not `TELEGRAM_BOT_TOKEN`) | Isolation | BP-9 ratification | BotFather | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| Alerts | `pnpm trader:alert:drill --dry-run` | Dev verification | package.json | N/A | BP-9A | **PASS** | CI / Runtime local 2026-06-28 |
| Alerts | `pnpm trader:alert:drill --send` | Prod proof | DEE-223 runbook | Operator shell | Yes | **PASS** | Step 7 — `POST /api/health/alerting/drill?send=1` → `outcome:success` (2026-06-28) |
| Alerts | `/api/health/alerting` | Config probe | app/api/health/alerting | Code | Yes | **OPERATOR REQUIRED** | `GET → 404` on production (BP-9 not deployed) |

### 2.4 Billing and payments

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Watcher | `WATCHER_ENABLED=1` | USDT detection | watcher-config | Cloudflare | Yes | **PASS (config)** | Repo `wrangler.jsonc` + deploy **`577e384c…`** plain env `1` (2026-06-28) |
| Watcher | `TRONGRID_API_KEY` | TRC-20 scan | .env.example | Wrangler secret | Yes | **PASS (config)** | `wrangler secret list` name present (2026-06-28) |
| Watcher | `TRON_RPC_*` | Provider failover | .env.example | Wrangler | Yes | **PASS (config)** | `TRON_RPC_PRIMARY_URL` in `wrangler secret list` (2026-06-28) |
| Watcher | `WATCHER_*` tuning | Finality/rescan | watcher-config | Cloudflare plain | Yes | **PASS (runtime)** | Recovery deploy **`c47176f9…`**; health `ok:true`; scan freshness ≤ stale threshold (2026-06-29) |
| Billing | USDT deposit addresses | Attribution | ADR-0013 | Postgres registry | Yes | **PASS** | Step 9A — `payment_wallets` **1**; `payment_addresses` **1** ACTIVATED `TRC-20`; address prefix **`TSBJRwVc…`**; resolver ready (2026-06-29) |
| Billing | Manual invoice gate | ADR-0008 | Admin billing UI | N/A | Yes | **VERIFIED IN CODE** | Repository; Operator PENDING |
| Billing | HWM + 30% fee | Reporting | BP-4 | Postgres | Yes | **VERIFIED IN CODE** | Repository; Supabase PENDING |
| Billing | Suspension lifecycle | BP-3 | DEE-217 | Postgres | Yes | **VERIFIED IN CODE** | Repository / CI; Runtime PENDING |
| Settlement | Settlement cron + health | Account status | health routes | Cron | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |

### 2.5 Database / Postgres

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Postgres | Migrations applied | Schema parity | db/migrations_postgres/ | Supabase | Yes | **PASS** | Supabase MCP: `drizzle.__drizzle_migrations` count **64**; latest hash → `0063_trader_org_live_enable_rls` (2026-06-28) |
| Postgres | Transaction pooler URI | Workers runtime | DEE-75 | Wrangler secret | Yes | **PASS** | Health `200`; migrations applied |
| Postgres | RLS policies | ADR-0007 | *_rls.sql migrations | Supabase | Yes | **PASS** | Supabase MCP: **43** RLS-enabled tables; **172** policies (2026-06-28) |
| Postgres | Tenant isolation CI | ADR-0007 | ci.yml | GitHub | Yes | **PASS** | CI / Repository |
| SQLite | `DATABASE_URL` file | Local dev only | .env.example | Local | No (not prod) | **NOT APPLICABLE** | Repository |

### 2.6 Auth / WAIA Core

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Auth | Supabase Auth (production path) | Login | sign-in route | Supabase | Yes | **ACCEPTED (Step 10)** | Steps 3–5 — Supabase redirect + Org-0 + HTX connect via authenticated Trader Workspace |
| Auth | `trader.waia.life` DNS | Trader module | AT-E1 checklist | Cloudflare DNS | Yes | **PASS** | Step 3 — `curl` **200/307**; custom domain on **`waia-app`** (2026-06-28) |
| Auth | Supabase redirect **`https://trader.waia.life/**`** | Trader auth callbacks | DEE-59 checklist | Supabase dashboard | Yes | **PASS** | Step 3 — operator dashboard attestation; Site URL **`https://waia.life`** (2026-06-28) |
| Admin | Platform role `admin` | Admin console | permissions/resolve | user_platform_roles | Yes | **PASS** | Step 4 — **`1`** admin row (operator); **`19`** user (2026-06-28) |
| Admin | Permissions e.g. `admin.audit.read` | Admin API | admin routes | DB | Yes | **PASS** | Step 4 — admin role grants admin permission set per `resolve.ts` |
| Org-0 | Organization UUID | Live allowlist | .env.example | Operator | Yes | **PASS** | Step 4 — org prefix **`3c50b4e9…`**; vault attestation recorded |
| Entitlement | `trader` org entitlement | Module gate | runtime-provisioning | Postgres | Yes | **PASS** | Step 4 — **`1`** enabled `trader` row on Org-0 (2026-06-28) |

### 2.7 Execution host (Option B)

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Host | Isolated VPS/container | Live CLI plane | DEE-339 runbook | Operator infra | Yes | **PASS** | Step 8 — SSH deploy 2026-06-28 |
| Host | `WAIA_TRADER_EXECUTION_HOST_URL` | Live cycle gate | .env.example | Operator vault | Yes | **OPERATOR VAULT** | Step 8 — not on Worker; URL off-repo |
| Host | Runtime secrets (separate KMS) | Host-only | DEE-339 §2.C | Host inject | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| Host | No Worker live `placeOrder` | Option B | BP-7 runbook | Code | Yes | **PASS** | Repository / CI |
| Host | BP-7 seven-stage evidence | Pre-BP-10 live order | DEE-212 runbook | Off-repo | Yes | **OPERATOR REQUIRED at L4** | Step 8 host `/health` **PASS** (2026-06-28); live order = BP-10 L4 |

### 2.8 Observability

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Telemetry | `waia_trader_event` stdout | Critical surfacing | DEE-222 schema | Worker logs | Yes | **VERIFIED IN CODE** | Repository |
| Alerting | Inline router (3 wiring points) | BP-9 | telemetry modules | Code | Yes | **VERIFIED IN CODE** | Repository; Telegram PENDING |
| Audit | Append-only audit tables | ADR-0011 | waia-core audit | Postgres | Yes | **VERIFIED IN CODE** | Repository; Supabase PENDING |
| Health | 5 health routes | Ops probes | app/api/health/* | Code | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |

---

## 3. User journey re-verification (post BP-2C / BP-8 / BP-9)

Reference: [AI-TRADER-USER-JOURNEY-v2.md](../ai-trader/AI-TRADER-USER-JOURNEY-v2.md)

**Note:** DEE-348 (BP-2A) pre-BP-2C FAIL is **not** inherited. Classification from current repo at `0149267`.

| Step | Requirement | Current evidence | Status | Verified by | BP-10 impact |
|------|-------------|------------------|--------|-------------|--------------|
| 1–2 | Register + trader entitlement | Auth routes; Step 4 `trader` entitlement; [trader.spec.ts](../../tests/e2e/trader.spec.ts) | **ACCEPTED (Step 10)** | Steps 4–5 + CI | Production auth path confirmed |
| 3 | HTX connect UI | [TraderWorkspace](../../components/trader/trader-workspace.tsx); e2e connect form | **VERIFIED IN CODE** | Repository / CI | Phase 2 HTX connect proof |
| 4 | Sync balances/positions/history | BP-2C UI + DEE-237/DEE-350 APIs | **VERIFIED IN CODE** | Repository | Phase 2 HTX sync proof |
| 5 | Strategy selection | No trader UI picker; registry/admin/cron | **INFORMATIONAL GAP** | Repository | AHR + cron acceptable for Org-0 MVP |
| 6 | Paper trading UI | Paper loop cron/CLI; DEE-337 AHR | **INFORMATIONAL GAP** | Repository / CI | Criterion 8 via AHR; Step 6 UI optional for Org-0 |
| 7 | Live activation (admin-gated) | [admin/live-enable](../../app/(trader)/admin/live-enable/page.tsx); BP-7 CLI | **VERIFIED IN CODE** | Repository | Live order = BP-10 only |
| 8 | Monitoring | Trader UI (balances/positions/history); admin audit/billing | **VERIFIED IN CODE** | Repository | Enumerate user-visible vs admin-only in Phase 2 |
| 9–12 | Billing/payment/status | BP-3/4 admin; watcher health | **OPERATOR REQUIRED** | Operator / Runtime | Phase 2 prod config |
| Alerting | Critical → Telegram | BP-9 router; dry-run PASS | **VERIFIED IN CODE** | Repository / CI | Criterion 15 Phase 2 |

---

## 4. MVP verification checklist (16 criteria = 14+2)

| # | Criterion | Phase | Phase 1 status | Evidence pointer |
|---|-----------|-------|----------------|------------------|
| 1 | WAIA Core auth + org + trader entitlement + audit | 1 map / 2 prod | **VERIFIED IN CODE** | runtime-provisioning; admin audit UI |
| 2 | Tenant-isolation gate (ADR-0007) | 1 | **PASS** | CI; 31 tenant-isolation test files |
| 3 | HTX spot read + encrypted creds + sync | 2 | **PASS** | Step 5 — Trader Workspace connect + sync (2026-06-28) |
| 4 | Market data ingestion + fail-closed | 2 | **PASS** | Step 9 — MB cron `cycle_complete` (2026-06-29) |
| 5 | MSV + CDE operational | 2 | **PASS** | Step 9 — MB telemetry + CDE counters in tail (2026-06-29) |
| 6 | Two strategies registered; CDE signal-only | 1 | **PASS** | DEE-337; registry tests |
| 7 | Risk + kill switches; reconciliation | 1 | **PASS** | CI tests; admin kill-switch UI |
| 8 | Paper loop + AHR validated | 1 | **PASS** | [DEE-337 closure report](DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md) |
| 9 | Signed validation-gate promotion (ADR-0010/11) | 1 | **PASS** | DEE-178 (SQLite process proof); admin promotion UI; production attestation = **HC-3.5** on Postgres (BP-10 closure §3.5) |
| 10 | Reporting + HWM + 30% fee + manual gate | 2 | **OPERATOR REQUIRED** | Admin billing; ADR-0008 |
| 11 | USDT payments + suspension lifecycle | 2 | **PASS** | Steps 6 + 9A + §10.1 — watcher scan + address registry; health `ok:true` (no deposit required) |
| 12 | Org-0 live admin-gated; isolated host | 2 | **PASS** | Steps 4 + 8 — admin entitlement + execution host `/health` (2026-06-28) |
| 13 | Admin console complete | 1 | **PASS** | BP-8 PR #316; admin route tests |
| 14 | External live blocked (ADR-0009) | 1 | **PASS** | org allowlist tests; live path fail-closed |
| 15 | Live Telegram alert delivery | 2 | **PASS** | Step 7 — production drill `outcome:success` (2026-06-28) |
| 16 | Production Configuration Inventory signed | 2 | **PASS** | Step 10 — §12 signed 2026-06-29 |

**ADR cross-checks (Phase 1 code review):**

| ADR | Phase 1 | Notes |
|-----|---------|-------|
| 0007 | PASS | CI tenant-isolation; RLS migrations in repo |
| 0008 | VERIFIED IN CODE | Invoice approve requires attestations |
| 0009 | VERIFIED IN CODE | Org-0 only live path; external blocked |
| 0010 | VERIFIED IN CODE | Promotion request CLI-only |
| 0011 | VERIFIED IN CODE | Cooling-off on governed actions |

---

## 5. Health endpoints (code present; prod probes Phase 2)

| Route | Purpose | Phase 1 | Phase 2 evidence |
|-------|---------|---------|------------------|
| `/api/health/database` | Postgres connectivity | **PASS** | `GET → 200`, `backend: postgres` (2026-06-28) |
| `/api/health/payment-watcher` | Watcher staleness | **PASS (Step 6 + §10.1)** | `GET → 200` (`ok:true`, checkpoint fresh) deploy **`c47176f9…`** (2026-06-29) |
| `/api/health/settlement` | Settlement cron | **PASS** | `GET → 200`, `ok:true` (2026-06-28) |
| `/api/health/settlement-reconciliation` | Reconciliation | **PASS** | `GET → 200`, `ok:true` (2026-06-28) |
| `/api/health/master-key` | Master key readiness | **PASS** | `GET → 200`, `productionReady:true`, `keyVersion:v1` (2026-06-28) |

---

## 6. Secret discipline scan (Phase 1)

| Check | Result |
|-------|--------|
| Secret values in this report | **NONE** |
| `.env` / `.dev.vars` committed | **NONE** (gitignored) |
| HTX/API tokens in repo grep | **NONE** found in tracked sources |
| Alert drill output | dry_run only; no tokens logged |

**Public configuration note:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in [wrangler.jsonc](../../wrangler.jsonc) are **publishable Supabase client configuration** (browser-safe by design). They are **not** server secrets. `SUPABASE_SERVICE_ROLE_KEY` remains a separate **OPERATOR REQUIRED** Wrangler secret and must never appear in client bundles or this report.

**Rule:** Any secret discovered in repo/logs during BP-9A → **FAIL** and rotate.

---

## 7. Gaps and blockers

| Gap | Classification | Blocks BP-10? |
|-----|----------------|---------------|
| Phase 2 Steps 1–9A + watcher recovery + Step 10 | **PASS** — closed 2026-06-28–2026-06-29 | **No** |
| Phase 2 runtime merged to `dev` | **RESOLVED** — PR #318 + PR #319 merged | **No** |
| `WAIA_CORE_ENFORCEMENT` posture | **RESOLVED (Step 10)** — **OFF** (unset on production) | **No** |
| MVP checklist criterion 16 (signed inventory) | **RESOLVED (Step 10)** — §12 signed | **No** |
| Remaining **UNKNOWN** inventory rows (§2) | **RESOLVED (Step 10)** — accepted/waived per §10 | **No** |
| Steps 5–6 no trader UI | **INFORMATIONAL GAP** | **No** — AHR satisfies criterion 8 |

---

## 8. Option B invariants (Phase 1)

| Invariant | Status |
|-----------|--------|
| Worker = control plane | **PASS** |
| Execution host = execution plane | **PASS** (scaffold + runbooks) |
| No Worker live `placeOrder` | **PASS** (code + tests) |
| Live CLI bounded (BP-7) | **PASS** (runbook) |

---

## 9. Phase 1 human acceptance gate

**Composer Phase 1 deliverables complete.** Phase 1 inventory **accepted** 2026-06-28. [Launch Readiness Review](DEE-352-LAUNCH-READINESS-REVIEW.md) **accepted** — Phase 2 open for Step 1 only.

- [x] Production Configuration Inventory (§2) reviewed and accepted
- [x] User journey classification (§3) reviewed and accepted
- [x] MVP checklist Phase 1 mappings (§4) reviewed and accepted
- [x] No secret values in any artifact confirmed

**Operator acceptance:**

| Field | Value |
|-------|-------|
| Accepted by | Adamar / Architect-Operator |
| Date | 2026-06-28 |
| Notes | Accepted for controlled transition into Launch Readiness Review and Phase 2 Step 1 preparation. Production provisioning remains step-gated and evidence-only. |

---

## 10. Phase 2 operator provisioning (human-only, strict order)

**Prerequisite:** [Launch Readiness Review](DEE-352-LAUNCH-READINESS-REVIEW.md) **accepted** (Adamar / Architect-Operator, 2026-06-28). **Reality Preconditions Audit** integrated 2026-06-28 (see §10.0).

**Active step:** **BP-10 (DEE-340)** — BP-9A **COMPLETE** (Step 10 **PASS** 2026-06-29)

**Protocol:** Execute steps **1 → 2 → … → 7 → 8 → 9 → 9A → 10** in order. **Never reorder.** Step 9A is **not** between Steps 7 and 8. After each step: complete **Reality Preconditions** (§10.0) → verify → collect non-secret evidence → update this section and §2 inventory → **STOP** if verification fails.

**Composer role:** Guide operator, record evidence, sync docs/Linear. **Composer must not** run `wrangler secret put`, provision secrets, or execute `--send` autonomously.

**Progress:** **11 / 11** steps **PASS** · Step 10 complete **2026-06-29**

### 10.0 Reality Preconditions (mandatory from Step 8 onward)

Before every remaining step (8, 9, 9A, 10), answer:

| Question | Purpose |
|----------|---------|
| What real-world objects must already exist? | Prevent verifying against empty DB / missing host |
| What infrastructure must already exist? | DNS, Worker, Postgres, cron handler |
| What runtime must already exist? | Health routes, scheduled handler, import graph |
| What operator actions must already be completed? | Provision, deploy, register |
| What secrets must already exist (names only)? | Never record values |
| Which assumptions are intentionally NOT required? | Explicit out-of-scope — prevents scope creep |

**False PASS examples (STOP):** Step 6 treated as attribution PASS with zero `payment_addresses`; Step 9 PASS from env vars alone while cron throws `server-only`; Step 8 PASS from local Docker or conflated with BP-7/OpenAI.

#### OpenAI — N/A for BP-9A

| Fact | Status |
|------|--------|
| AI-TRADER requires dedicated OpenAI API key | **No** — market brain = HTX REST; paper loop = deterministic |
| `WAIA_AI_OPENAI_API_KEY` / `WAIA_AI_*` | **AI-Twin only** |
| `AI_TRADER_*OPENAI*` secret | **Does not exist; do not introduce** |

#### Payment Address Registry ≠ Settlement Wallet

| Concept | BP-9A |
|---------|-------|
| **Payment Address Registry** | `payment_wallets`, `payment_addresses`; watcher resolution; billing attribution readiness (**Step 9A**) |
| **Settlement Wallet Ceremony** | Future multisig (ADR-0013); **outside BP-9A** |

#### Recommended future governance (not ratified)

Recommend **WAIA DEV OS** rule: **Reality Preconditions Check** — before every verification task, enumerate real-world entities that must exist before technical verification. Architect ratification pending; **no ADR in this revision**.

| Step | Title | Status | Verified by | Date |
|------|-------|--------|-------------|------|
| 1 | Postgres | **PASS** | Supabase MCP + Runtime HTTP + operator migrate | 2026-06-28 |
| 2 | Secrets Store / master key | **PASS** | Cloudflare + Runtime HTTP + operator provision | 2026-06-28 |
| 3 | Trader host DNS | **PASS** | Runtime HTTP + Cloudflare CLI + operator attestation | 2026-06-28 |
| 4 | Org-0 identity + admin | **PASS** | Supabase MCP + Cloudflare deploy + operator attestation | 2026-06-28 |
| 5 | HTX Org-0 connect + first sync (Trader Workspace user flow) | **PASS** | Operator + Supabase MCP + Runtime HTTP | 2026-06-28 |
| 6 | Payment watcher *(scan cycle only)* | **PASS** | Cloudflare + Runtime HTTP + Supabase MCP | 2026-06-28 |
| 7 | Telegram alerting | **PASS** | Runtime HTTP + wrangler secret list + unit tests | 2026-06-28 |
| 8 | Execution host | **PASS** | Execution Host + Operator + Composer | 2026-06-28 |
| 9 | Cron workers *(runtime gate → enable vars)* | **PASS** | Cloudflare tail + Composer | 2026-06-29 |
| 9A | Payment address registry verification | **PASS** | Operator + Postgres CLI + Composer | 2026-06-29 |
| 10 | Architect decision | **PASS** | Adamar / Architect-Operator | 2026-06-29 |

---

### Step 1 — Postgres *(PASS — closed 2026-06-28)*

**Preflight (2026-06-28):** Branch `dee-352-bp9a-mvp-verification`; pre-apply count **3/64** on `waia-prod`.

**Apply:** Canonical `pnpm db:migrate:postgres` (operator shell; URI from `.env.local` only — not logged). **Journal repair:** migrations **`0003_waia_core_m1`** and **`0004_audit_logs_rls`** were already applied out-of-band; journal rows inserted before migrate to reconcile drift. **`0005`–`0063`** applied via drizzle-kit — **`[✓] migrations applied successfully!`**

**Re-verification (2026-06-28):** Supabase MCP + runtime HTTP. **No credentials read or logged.**

| Check | Result | Evidence |
|-------|--------|----------|
| `drizzle.__drizzle_migrations` count | **PASS** | **64** (repo journal **64**) |
| Latest migration | **PASS** | Hash `00a26184…` → tag **`0063_trader_org_live_enable_rls`** (`created_at` **1780000000026**) |
| Key tables present | **PASS** | `exchange_credentials`, `payment_watcher_checkpoints`, `trader_org_profiles`, `trader_orders`, `trader_settlements`, `trader_org_live_enable`; **36** `trader_*` tables total |
| RLS enabled | **PASS** | **43** tables with `rowsecurity=true`; **172** policies |
| `GET /api/health/database` | **PASS** | HTTP **200** — `{"backend":"postgres","ok":true}` |
| `GET /api/health/payment-watcher` | **Later-step** | HTTP **503** — schema OK; no watcher checkpoint yet (Step 6) |
| `GET /api/health/settlement` | **PASS** | HTTP **200** — `ok:true` |
| `GET /api/health/settlement-reconciliation` | **PASS** | HTTP **200** — `ok:true` |

**Step 1 verdict:** **PASS**

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Migrations **64/64**; latest **`0063_trader_org_live_enable_rls`**; RLS **43/172**; database health **200** |
| **Verified by** | Supabase MCP + operator migrate + Runtime HTTP |
| **Date** | 2026-06-28 |

**Next allowed step:** Step 3 — Trader host DNS. **Do not** start Step 4+ in this pass.

---

### Step 2 — Secrets Store / master key *(PASS — closed 2026-06-28)*

**Operator actions (completed):** Per [DEE-220](DEE-220-MASTER-KEY-RUNBOOK.md):

1. Generated master key offline (`openssl rand -base64 32`) — vault only; value never logged.
2. Created Secrets Store **`waia-ai-trader-secrets`** + secret **`ai-trader-master-key-v1`**.
3. Added `secrets_store_secrets` binding **`AI_TRADER_MASTER_KEY`** to `wrangler.jsonc`; deployed Worker.
4. Set plain env **`WAIA_DEPLOYMENT_TIER=production`** on Worker.

**Verification (2026-06-28):** Cloudflare CLI + runtime HTTP. **No secret values read or logged.**

| Check | Result | Evidence |
|-------|--------|----------|
| Secrets Store exists | **PASS** | `wrangler secrets-store store list --remote` → store **`waia-ai-trader-secrets`** |
| Secret `ai-trader-master-key-v1` | **PASS** | Created via DEE-220 procedure; wrangler output `Value: REDACTED` only |
| Worker binding **`AI_TRADER_MASTER_KEY`** | **PASS** | Binding active on deployed Worker (`wrangler.jsonc` + deploy confirmation) |
| `WAIA_DEPLOYMENT_TIER=production` | **PASS** | Plain env present on deployed Worker |
| `GET /api/health/master-key` | **PASS** | HTTP **200** — `configured:true`, `productionReady:true`, `keyVersion:v1` |
| `createMasterKeyProvider()` readiness | **PASS** | Health route equivalent: `productionReady:true` |
| Negative — HTX decrypt without creds | **PASS (expected)** | **`0`** rows in `exchange_credentials` on `waia-prod`; infra only — no credentials to decrypt |

**Step 2 verdict:** **PASS**

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Store **`waia-ai-trader-secrets`**; binding **`AI_TRADER_MASTER_KEY`** active; tier **`production`**; health `productionReady:true` |
| **Verified by** | Cloudflare CLI + operator provision + Runtime HTTP + Supabase MCP (count only) |
| **Date** | 2026-06-28 |

**Next allowed step:** Step 3 — Trader host DNS.

**Inventory rows updated:** `AI_TRADER_MASTER_KEY`, `WAIA_DEPLOYMENT_TIER`.

---

### Step 3 — Trader host DNS *(PASS — closed 2026-06-28; re-verified same day)*

**Scope:** Close trader host DNS + redirect readiness for Org-0 MVP. **No HTX / Telegram / execution host.**

**Initial verification (2026-06-28):** Checks **1–5 PASS**; check **6 BLOCKED** (no dashboard attestation).

**Re-verification (2026-06-28):** Runtime HTTP + Cloudflare CLI + **operator dashboard attestation**. **No secret values read or logged.**

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `trader.waia.life` custom domain on **`waia-app`** | **PASS** | `GET https://trader.waia.life/` → HTTP **200**; header **`x-waia-module: trader`**; Cloudflare MCP confirms Worker script **`waia-app`**; active deploy version **`431dc64e…`** |
| 2 | `https://trader.waia.life/` → HTTP 200 | **PASS** | `curl -I` → HTTP **200** (re-verification 2026-06-28) |
| 3 | `https://trader.waia.life/trader` → 200 or auth redirect | **PASS** | `curl -I` → HTTP **307** → `/` (expected unauthenticated redirect per AT-E1 host routing) |
| 4 | `NEXT_PUBLIC_TRADER_URL=https://trader.waia.life` | **PASS** | `wrangler versions view 431dc64e…` → env **`https://trader.waia.life`** |
| 5 | `WAIA_TRADER_HOST=trader.waia.life` | **PASS** | `wrangler versions view 431dc64e…` → env **`trader.waia.life`** |
| 6 | Supabase redirect includes **`https://trader.waia.life/**`** | **PASS** | **Operator attestation:** Supabase **`waia-prod`** dashboard → **Authentication → URL configuration** — Site URL **`https://waia.life`**; Redirect URLs include **`https://trader.waia.life/**`** (visual confirmation; no secrets recorded) |

**Step 3 verdict:** **PASS**

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Trader host **200/307**; Worker env **`NEXT_PUBLIC_TRADER_URL`** + **`WAIA_TRADER_HOST`**; Supabase redirect **`https://trader.waia.life/**`** operator-attested |
| **Verified by** | Runtime HTTP + Cloudflare CLI + operator dashboard attestation |
| **Date** | 2026-06-28 |

**Next allowed step:** Step 4 — Org-0 identity + admin. **Do not** start Step 5+ in this pass.

**Inventory rows:** `NEXT_PUBLIC_TRADER_URL`, `WAIA_TRADER_HOST`, trader DNS, Supabase redirect URLs.

**On FAIL:** STOP.

---

### Step 4 — Org-0 identity + admin *(PASS — closed 2026-06-28; re-verified same day)*

**Scope:** Org-0 organization identity, platform admin role, `trader` entitlement, admin console readiness. **No HTX / Telegram / execution host.**

**Initial verification (2026-06-28):** **BLOCKED** — no admin role, no trader entitlement, Org-0 env absent.

**Unblock + re-verification (2026-06-28):** Operator-owned personal org designated as Org-0; Postgres provisioning + Worker deploy. **No secret values read or logged.**

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Org-0 organization exists | **PASS** | Operator org **`oumaster369's workspace`** (org prefix **`3c50b4e9…`**); kind **`personal`**; owner membership confirmed |
| 2 | Org-0 intended in-house fund / first tenant | **PASS** | **Operator attestation:** designated operator-owned personal org as Org-0 in-house fund tenant (M1 conformance model) |
| 3 | Org-0 UUID in operator vault | **PASS** | **Operator attestation:** full UUID stored in operator vault (not recorded in this report) |
| 4 | `WAIA_TRADER_ORG0_ORGANIZATION_ID` configured | **PASS** | Deployed Worker version **`8e4d4c62…`** — env present (org prefix **`3c50b4e9…`**) |
| 5 | Operator user exists | **PASS** | `oumaster369@gmail.com` (user prefix **`27cd09ba…`**) |
| 6 | Operator platform role **`admin`** | **PASS** | `user_platform_roles`: **`1`** row role **`admin`** (operator); **`19`** remain **`user`** |
| 7 | Org-0 **`trader`** entitlement | **PASS** | `organization_entitlements`: **`1`** row **`trader`** **`enabled=true`** on org prefix **`3c50b4e9…`** |
| 8 | `trader_org_profiles` status | **PASS (lazy provision)** | **`0`** rows pre-first-access; `ensureTraderRuntimeForUser` provisions anchor on first entitled route per runtime-provisioning — acceptable before Step 5 |
| 9 | Admin console authenticated access | **PASS (equivalent)** | Platform **`admin`** + **`trader`** entitlement satisfy `assertAdminPermission(..., admin.audit.read)` per `lib/waia-core/permissions/resolve.ts`; **operator attestation:** signed-in session loads `/admin` shell |
| 10 | Unauthorized / non-admin blocked | **PASS** | Unauthenticated `GET /admin` → **307**; `GET /api/trader/admin/overview?organization_id=…` → **401** |
| 11 | No secrets exposed | **PASS** | Counts/prefixes/attestations only |

**Step 4 verdict:** **PASS**

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Org-0 org prefix **`3c50b4e9…`**; admin role **`1`**; trader entitlement **`1`**; Worker Org-0 env; unauthenticated admin blocked |
| **Verified by** | Supabase MCP + Cloudflare deploy + operator attestation + Runtime HTTP |
| **Date** | 2026-06-28 |

**Next allowed step:** Step 5 — HTX Org-0 connect + first sync (Trader Workspace user flow). **Do not** start Step 6+ in this pass.

**Inventory rows:** Org-0 UUID, platform admin role, admin permissions, `trader` entitlement, `WAIA_TRADER_ORG0_ORGANIZATION_ID`.

**On FAIL:** STOP.

---

### Step 5 — HTX Org-0 connect + first sync (Trader Workspace user flow)

**Canonical execution path (required):**

- Signed-in **Org-0 operator user** on `https://trader.waia.life`.
- **Trader Workspace** at `/trader` — user-facing HTX connect form.
- Backend **`POST /api/trader/exchange-credentials/connect`** only as the **UI-invoked** backend route (same session/auth as the form).
- **User-triggered** balance, position, and trade-history sync from the workspace.

**Explicitly rejected (not acceptable for Step 5):**

- Admin-panel credential onboarding.
- Direct Postgres insert into `exchange_credentials`.
- CLI credential onboarding.
- Composer/autonomous agent credential submission.
- Treating the connect API as a **standalone bypass** (e.g. direct API call outside the Trader Workspace user flow).

**Admin role:** Admin console/API is for **post-connect visibility and control only** (e.g. `GET /api/trader/admin/exchange-credentials` — metadata list). Admin verification is **required after connection**; admin is **not** the connection surface.

**Operator actions:**

1. Create HTX API key: **Read + Trade only**; no Withdraw.
2. Sign in as Org-0 operator on `trader.waia.life`.
3. Open `/trader` → submit HTX connect form (secrets never logged).
4. Trigger balance, position, and trade-history sync from the workspace for the Org-0 credential.

**Verification (evidence shapes only — no secrets):**

- User-facing connect success (UI shows connected account; masked API key only).
- Encrypted credential row: count **1** for Org-0 org; metadata only (id prefix, `venue=htx`, `status`, `permissionMetadata` — no ciphertext or secrets).
- Permission posture: withdraw forbidden (runtime rejection or `withdrawForbidden=true`); transfer **policy-attested** (`transferForbidden=true`) if HTX cannot expose it separately.
- Sync HTTP **200** for balances, positions, and trade history.
- Snapshot row **counts only** — no balances or secrets in report.
- Admin metadata visibility after connection (`GET /api/trader/admin/exchange-credentials` → **200**, metadata only).
- No secret exposure in artifacts.

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Credential **1** active (`7e050523…` / org `3c50b4e9…`); balances **2**; positions **2**; trade-history **1** snapshot (`trade_count=0`, symbol `ETH/USDT`, 48h empty — matches operator UI); admin metadata equivalent verified |
| **Verified by** | Operator attestation + Supabase MCP + Runtime HTTP |
| **Date** | 2026-06-28 |

**Re-verification (2026-06-28):** Post symbol-fix deploy **`c6ea275c…`** and operator **Sync trades** retry. **No secrets read or logged.**

| Check | Result | Evidence |
|-------|--------|----------|
| A. Trader Workspace user flow | **PASS** | Operator attestation: HTX connected/active via `/trader`; no admin/DB bypass |
| B. Credential persistence | **PASS** | **`1`** row; `venue=htx`; `status=active`; id prefix **`7e050523…`**; org **`3c50b4e9…`**; acct **`73750148…`** |
| C. Permission posture | **PASS** | `scopes=["read","trade"]`; `withdrawForbidden=true`; `transferForbidden=true`; trade transfer policy-attested via HTX warning |
| D. Balances sync | **PASS** | `trader_balance_snapshots` **2** (count only) |
| D. Positions sync | **PASS** | `trader_position_snapshots` **2** (count only) |
| D. Trade-history sync (post-fix) | **PASS** | **`1`** snapshot; `trade_count=0`; symbol **`ETH/USDT`**; synced **2026-06-28T16:48:27Z**; operator UI: *No trades in the last 48h window* (no error banner); audit `trader.trade_history_snapshot.created` |
| E. Admin metadata visibility | **PASS (equivalent)** | Unauthenticated admin route → **401**; Postgres metadata row matches admin list shape (**1** credential, metadata only) |
| F. Security discipline | **PASS** | No `encrypted_payload` queried; no secrets in report |

**Prior issue (resolved):** Symbol-format mismatch caused pre-fix **502** `TRADE_HISTORY_FETCH_FAILED`; fixed by `normalizeHtxSpotSymbol()` + deploy **`c6ea275c…`**.

**Step 5 verdict:** **PASS**

**Next allowed step:** Step 6 — Payment watcher. **Do not** start Step 7+ in this pass.

---

### Step 6 — Payment watcher *(PASS — Step 7 operator action required)*

**Required config (from `watcher-config.ts`, `.env.example`, `.dev.vars.example`):**

| Name | Role | Storage | Required for Step 6? |
|------|------|---------|----------------------|
| `WATCHER_ENABLED` | Enable cron cycle (default `false` → `cycle_skipped`) | Cloudflare plain env | **Yes** — must be `1` |
| `TRONGRID_API_KEY` | TronGrid auth | Wrangler secret | **Yes** |
| `TRON_RPC_PRIMARY_URL` | Primary RPC endpoint | **Wrangler secret** (preferred) | Recommended |
| `TRON_RPC_SECONDARY_URL` | Failover RPC | Wrangler secret | Optional |
| `TRON_RPC_SECONDARY_API_KEY` | Secondary provider auth | Wrangler secret | Optional |
| `WATCHER_*` tuning | Finality/rescan | Cloudflare plain | Optional (code defaults) |

**Operator provisioning (2026-06-28):** Operator set `TRONGRID_API_KEY` and `TRON_RPC_PRIMARY_URL` via Wrangler (values not recorded). Composer added `WATCHER_ENABLED=1` to `wrangler.jsonc` and deployed production Worker.

> **Historical (pre-merge):** Runtime fixes were first deployed from branch before PR #318 merge. **Current state:** merged to `dev` @ `2071130` and redeployed to production **`86bde72b…`** (2026-06-29). Original defect: Worker cron could not load payment-watcher modules — `server-only` side-effect imports throw in workerd; `createRequire(import.meta.url)` fails when `import.meta.url` is absent; cron env bridging used non-iterable `process.env`/`CRON_ENV_KEYS`; `TronRpcClient` class and alert-router sink had constructor interop failures. Fixed via `lib/enforce-server-only.ts`, cron-safe env bridge, `createTronRpcClient` factory, cron-safe watcher logger, and related adapter imports.

**Verification (evidence shapes only — no secrets):**

```bash
curl -sS https://waia.life/api/health/payment-watcher
# HTTP 200, ok:true, last_scanned_at set
```

| Check | Result | Evidence |
|-------|--------|----------|
| A. `WATCHER_ENABLED=1` on deployed Worker | **PASS** | `wrangler.jsonc`; deploy **`08bbd761…`** version env |
| B. Secret names present | **PASS** | `wrangler secret list`: `TRONGRID_API_KEY`, `TRON_RPC_PRIMARY_URL`, `DATABASE_URL_POSTGRES` |
| C. Production deploy | **PASS** | `pnpm cloudflare:deploy` → version **`08bbd761-0fd3-4c83-be91-e5c8b77957c5`** @ 100% (2026-06-28) |
| D. Health endpoint | **PASS** | `GET /api/health/payment-watcher` → HTTP **200** — `ok:true`, `last_scanned_at` set, `scan_lag_seconds` < 300 |
| E. Checkpoint table | **PASS** | Supabase MCP: `payment_watcher_checkpoints` count **1**; `cycle_count` **4**; `last_scanned_block` advancing |
| F. Cycle telemetry | **PASS** | `wrangler tail`: `scheduled_start`, `deps_ok`, successful scan cycles; zero payments required |
| G. Security discipline | **PASS** | No secret values queried or recorded |

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Health **200** `ok:true`; checkpoint row present; Tron scan cycles completing with zero detected payments |
| **Verified by** | Cloudflare wrangler tail + Runtime HTTP + Supabase MCP |
| **Date** | 2026-06-28 |

**Step 6 verdict:** **PASS — scan cycle only; attribution deferred to Step 9A**

**Scope note:** At Step 6 close, production had `payment_wallets=0`, `payment_addresses=0`. This does **not** fail Step 6. Registry verification is **Step 9A**.

**Next allowed step:** Step 7 — Telegram alerting. **Do not** start Step 8+ in this pass.

---

### Step 7 — Telegram alerting *(PASS)*

**Operator provisioning (2026-06-28):** `TELEGRAM_ALERTS_BOT_TOKEN`, `TELEGRAM_ALERTS_CHAT_ID`, `TELEGRAM_ALERTS_THREAD_ID` present in production (`wrangler secret list` — names only).

**Implementation note:** Added `POST /api/health/alerting/drill` so Worker can run BP-9 drill with production secrets (CLI cannot access Worker secrets without local copy).

**Verification (evidence shapes only — no secrets):**

```bash
curl -sS https://waia.life/api/health/alerting
# {"configured":true,"sink":"telegram"}

curl -sS -X POST "https://waia.life/api/health/alerting/drill?send=1"
# HTTP 200 — outcome:success, drill:true
```

| Check | Result | Evidence |
|-------|--------|----------|
| A. Secret names on Worker | **PASS** | `wrangler secret list`: all three `TELEGRAM_ALERTS_*` |
| B. Health config probe | **PASS** | `GET /api/health/alerting` → **200**, `configured:true`, `sink:telegram` |
| C. Worker reads secrets | **PASS** | Health + live drill both report `configured:true` on production Worker |
| D. Safe production drill | **PASS** | `POST /api/health/alerting/drill?send=1` → **200**, `outcome:success`, `drill:true` |
| E. Telegram delivery | **PASS** | `outcome:success` implies Telegram `sendMessage` HTTP 2xx (message marked `Drill: true` in Alerts topic) |
| F. Alert routing code | **PASS** | `createAlertRouterSink` + classifier unit tests; drill envelope via `runAlertDrill` |
| G. Post-drill health | **PASS** | Alerting **200** `configured:true`; payment-watcher **200** `ok:true` unchanged |
| H. Security discipline | **PASS** | No secret values in HTTP responses, drill JSON, or report |

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Production drill `outcome:success`; health configured; deploy **`1dc5f87d…`** |
| **Verified by** | Runtime HTTP + wrangler secret list + unit tests |
| **Date** | 2026-06-28 |

**Step 7 verdict:** **PASS**

**Next allowed step:** Step 8 — Execution host (**OPERATOR REQUIRED**). **Do not** start Step 8 in this pass.

---

### Step 8 — Execution host *(PASS)*

**Scope:** Execution host verification **only** — isolated host, reachable endpoint, `GET /health` → HTTP **200**.

**Step 8 is NOT:** BP-7 · HTX live execution · live order verification · OpenAI verification.

#### Reality Preconditions (met 2026-06-28)

| Question | Answer |
|----------|--------|
| Real-world objects | Off-Cloudflare Ubuntu VPS; hostname **`waia-org0-execution`**; container **`waia-execution-host`** |
| Infrastructure | SSH alias `waia-org0-exec`; Docker **29.1.3**; port **8080** bound |
| Runtime | BP-6 health server from `services/ai-trader-execution-host/`; image **`waia-execution-host:bp6`** |
| Operator actions | Host provisioned; Docker installed; container deployed via SSH |
| Secrets | **None required for Step 8** — image env scan: no KEY/SECRET/TOKEN layers |
| Intentionally NOT required | BP-7; HTX trade; OpenAI; Worker `placeOrder`; payment registry; host KMS (BP-7 prep) |

**Deployment (2026-06-28):** Service artifacts copied to `/opt/waia/execution-host` on isolated host. Docker installed (`docker.io`). Image built from repo Dockerfile. Container **`waia-execution-host`** running with restart policy **`unless-stopped`**, port **8080** published.

**Verification (evidence shapes only — no host URL or secrets recorded):**

| Check | Result | Evidence |
|-------|--------|----------|
| A. Off-Cloudflare isolated host | **PASS** | Hostname **`waia-org0-execution`**; Ubuntu **24.04**; Linux VPS (not Workers/Pages) |
| B. Docker runtime | **PASS** | Docker **29.1.3**; container **Up**; `0.0.0.0:8080→8080` |
| C. On-host `/health` | **PASS** | `curl http://127.0.0.1:8080/health` → JSON `status:ok`, `service:ai-trader-execution-host` |
| D. Operator-network `/health` | **PASS** | Off-host `curl` via operator network path → HTTP **200**; same JSON shape |
| E. Image secret discipline | **PASS** | `docker history` / env inspect — no secret env vars in image |
| F. Worker boundary | **PASS** | `WAIA_TRADER_EXECUTION_HOST_URL` **not** on Worker / `wrangler.jsonc` |
| G. Scope discipline | **PASS** | No BP-7, cron, registry, HTX live, or OpenAI configuration |

```bash
# On-host (executed on waia-org0-execution)
curl -sf http://127.0.0.1:8080/health
# {"status":"ok","service":"ai-trader-execution-host"}

# Operator-network (HTTP code only in evidence)
curl -sS -o /dev/null -w "%{http_code}" "${WAIA_TRADER_EXECUTION_HOST_URL}/health"
# 200 — URL in operator vault only; not recorded in this report
```

- Worker `placeOrder` path absent — **PASS** in §8 (Option B preserved).

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | `GET {host}/health → 200`; JSON `status:ok`, `service:ai-trader-execution-host`; container **`waia-execution-host`** |
| **Verified by** | Execution Host + Operator + Composer |
| **Date** | 2026-06-28 |

**Step 8 verdict:** **PASS**

**Next allowed step:** Step 9A — Payment address registry. *(Step 9 **PASS** 2026-06-29.)*

**On FAIL:** STOP. *(N/A — Step 8 PASS.)*

---

### Step 9 — Cron workers *(PASS)*

**Scope:** Runtime compatibility gate (Build A) → enable Market Brain + Paper Loop (Build B) → verify cron cycles.

#### Phase A — Runtime Compatibility Gate (Build A) *(PASS — 2026-06-28)*

Deploy **`66d00523…`**. Vars disabled. Gate evidence: settlement/MB/paper `deps_ok`; MB/paper `cycle_skipped`/`disabled`; zero import/runtime failures.

#### Phase B — Enable + verify *(PASS — 2026-06-29)*

**Env enabled (wrangler.jsonc plain vars):**

| Variable | Value shape |
|----------|-------------|
| `MARKET_BRAIN_ENABLED` | `1` |
| `MARKET_BRAIN_ORGANIZATION_ID` | Org-0 UUID (`3c50b4e9…`) |
| `PAPER_LOOP_ENABLED` | `1` |
| `PAPER_LOOP_ORGANIZATION_ID` | Org-0 UUID (`3c50b4e9…`) |
| `PAPER_LOOP_ACCOUNT_KEY` | `org0-paper-primary` |

**Deploy:** Worker version **`07408a7a-2520-4ded-9a7e-eb4afe1fe55e`** @ 100% (includes HTX `fetch.bind` workerd fix).

**Production tail evidence (≥2 cron intervals):**

| Module | Phase | Result |
|--------|-------|--------|
| payment-watcher | `deps_ok` | **PASS** — no sustained regression *(one post-deploy `import_error` on first tick; recovered next interval)* |
| settlement | `deps_ok` → `cycle_complete` / `outcome:noop` | **PASS** |
| market-brain | `deps_ok` → `cycle_complete` / `outcome:success` | **PASS** — `symbolCount:2`, `haltedCount:0` |
| paper-loop | `deps_ok` → `cycle_complete` / `outcome:submitted` | **PASS** — `waia_trader_event` `kind:paper_loop`, `execution_mode:mock` |

**Zero sustained:** `createRequire` failures, `server-only` failures, repeated paper-loop `cycle_error`.

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | MB `cycle_complete`/`success`; paper `cycle_complete`/`submitted`; deploy **`07408a7a…`** |
| **Verified by** | Cloudflare wrangler tail + Composer |
| **Date** | 2026-06-29 |

**Step 9 verdict:** **PASS**

**Next allowed step:** Step 10 — Architect decision. *(Step 9A **PASS** 2026-06-29.)*

---

### Step 9A — Payment address registry verification *(PASS)*

**Purpose:** Verify production payment-address registry. **Verification only** — no settlement wallet ceremony, no multisig, no custody, no billing redesign.

#### Operator wallet (off-platform)

| Field | Value |
|-------|-------|
| **TronLink label** | `WAIA Org-0 Payment` |
| **Type** | General Wallet · Tron Mainnet · dedicated (not personal) |
| **On-chain history** | Zero balance / zero tx at registration (operator attestation) |
| **Role** | First production inbound payment wallet for Org-0 |

#### Registry provisioning (event-sourced — no raw SQL)

Provisioned via `PaymentAddressService` (`scripts/waia-core/provision-org0-payment-address.ts`):

| Step | Service call | Result |
|------|--------------|--------|
| 1 | `createWallet` | `wallet_kind=DEPOSIT`, `custody_model=ORGANIZATION`, `control_model=operator-tronlink-single-signer`, `provider_ref=tronlink:WAIA Org-0 Payment` |
| 2 | `generateAddress` | `network=TRC-20`, public address prefix **`TSBJRwVc…`** |
| 3 | `assignAddress` | `subject_module=trader`, `subject_ref` prefix **`73750148…`** (Org-0 `exchange_account_id`) |
| 4 | `activateAddress` | `status=ACTIVATED` |

#### Verification (evidence shapes only — no secrets)

| Check | Result | Evidence |
|-------|--------|----------|
| A. `payment_wallets` | **PASS** | Count **1**; id prefix **`788f0fdc…`**; `DEPOSIT` / `ORGANIZATION` / `active` |
| B. `payment_addresses` | **PASS** | Count **1**; id prefix **`52457acd…`**; `network=TRC-20`; `status=ACTIVATED`; `wallet_id` FK matches |
| C. `payment_address_events` | **PASS** | Count **3**; chain **`GENERATED` → `ASSIGNED` → `ACTIVATED`** (seq 1–3) |
| D. Audit trail | **PASS** | **`payment_address.wallet_created`**, **`generated`**, **`assigned`**, **`activated`** |
| E. Subject binding | **PASS** | `subject_module=trader`; `subject_ref` = Org-0 HTX supervised account scope |
| F. Inbound resolver | **PASS** | `resolveOwnerByDepositAddress(TRC-20, …)` → Org-0 prefix **`3c50b4e9…`**, `ACTIVATED`, `trader` |
| G. Watcher compatibility | **PASS** | Checkpoint **`cycle_count=29`**, `last_error=null`; registered address would not resolve as `unknown_address` |
| H. Payment watcher regression | **PASS (runtime)** | Pre-9A: health `ok:false` from orphaned lease + frozen `last_scanned_at` (not missing deposits). **Recovery PASS** 2026-06-29 — see §10.1 |
| I. Settlement regression | **PASS** | `GET /api/health/settlement` → HTTP **200** `ok:true`, `backlog:0` |
| J. Cron runtime regression | **PASS** | No new import/runtime failures; Steps 9 MB/paper unchanged |
| K. Security discipline | **PASS** | No seed/private key/keystore requested or stored; address prefix-only in report |

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Registry **1/1/3** (wallets/addresses/events); resolver ready; first Org-0 inbound address **`TSBJRwVc…`** |
| **Verified by** | Operator attestation + Postgres CLI (`verify-org0-payment-address.ts`) + Runtime HTTP |
| **Date** | 2026-06-29 |

**Step 9A verdict:** **PASS**

**Next allowed step:** Step 10 only. **Do not** start BP-10 in this pass.

**On FAIL:** STOP. *(N/A — Step 9A PASS.)*

---

### Step 10.1 — Payment Watcher runtime stabilization recovery *(PASS — pre-Step 10)*

**Purpose:** Clear the release-blocking Payment Watcher runtime defect (health `ok:false`, elevated `scan_lag_seconds`, stale `last_scanned_at`) **without** real payments, billing changes, or Step 10 sign-off.

**Root cause (confirmed):**

1. **Orphaned DB lease** — Worker killed before `releaseLease` left `lease_until` set; subsequent crons returned `cycle_skipped` / `lease_held`; `last_scanned_at` frozen; health correctly red. Absence of real USDT deposits was **not** the cause.
2. **Worker import regression** — `run-watcher-cycle.ts` barrel imports (`@/lib/waia-core/payment-addresses`, `@/lib/waia-core/payments`) pulled `server-only` subgraph into the cron bundle → `import_error` on deploy `b9e3fa20…`. Fixed via direct leaf imports before redeploy.

**Fix (minimal, no billing/registry redesign):**

| Change | Detail |
|--------|--------|
| Stale-lease recovery | `tryAcquireWatcherLeaseWithStaleRecovery` — if `lease_until > now()` **and** scan lag ≥ `WATCHER_STALE_THRESHOLD_SECONDS`, force-release + single acquire retry |
| Lease TTL | `WATCHER_LEASE_TTL_SECONDS=120` in `wrangler.jsonc` (was default 600) |
| Worker-safe imports | Direct imports from `payment-address-lifecycle.transitions` and `payment.errors` (no barrel) |

**Health semantics (explicit):** `GET /api/health/payment-watcher` measures **scan freshness** (`scan_lag_seconds` vs stale threshold), **not** deposit detection. No real payments required for PASS.

**Pre-recovery checkpoint (metadata only):**

| Field | Value |
|-------|-------|
| `network` | `TRC-20` |
| `cycle_count` | 29 |
| `last_scanned_at` | `2026-06-29T06:07:25.622Z` (frozen) |
| `last_scanned_block` | 4679 |
| `lease_until` | `2026-06-29T07:00:56.799Z` (orphaned) |
| `last_error` | null |

**Production deploy (recovery — pre-merge branch):**

| Field | Value |
|-------|-------|
| Worker version | `c47176f9-c73d-4272-8975-0e7e80509039` |
| Deploy date | 2026-06-29 |
| Git lineage | Branch `dee-352-bp9a-mvp-verification` (pre-PR #318 merge) |

**Production deploy (canonical — post-merge `dev` @ `2071130`):**

| Field | Value |
|-------|-------|
| Worker version | `86bde72b-b945-48c0-99ce-eaf0500f8aeb` |
| Deploy date | 2026-06-29 |
| Git lineage | `dev` @ `2071130bfeefb90a28f97294abca6af158fe1177` (PR #318 squash merge) |
| Deploy command | `pnpm cloudflare:deploy` from clean `dev` checkout @ `2071130` |

**Post-recovery evidence (pre-merge deploy `c47176f9…`):**

| Check | Result | Evidence |
|-------|--------|----------|
| Watcher import | **PASS** | `wrangler tail`: `deps_ok` (no sustained `import_error` on `c47176f9…`) |
| Scan cycle | **PASS** | `cycle_complete` outcome=success; `last_scanned_at` advanced to `2026-06-29T07:09:29.507Z` |
| Health probe | **PASS** | `GET /api/health/payment-watcher` → `ok:true`, `scan_lag_seconds` ≤ 101 across ≥2 cron intervals |
| Settlement regression | **PASS** | `GET /api/health/settlement` → `ok:true`, `backlog:0` |
| MB / paper regression | **PASS** | Tail: `waia_market_brain` / `waia_paper_loop` `cycle_complete` unchanged |
| Cron gate | **PASS** | No sustained `createRequire` / `server-only` failures on watcher path after import fix |

**Note:** Long scan duration (~91s) can legitimately produce `lease_held` on overlapping minute crons while a cycle runs; health remains green when `last_scanned_at` advances within stale threshold.

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Payment Watcher runtime blocker** | **CLEARED** |
| **Verified by** | Composer recovery pass + production HTTP + `wrangler tail` |
| **Date** | 2026-06-29 |

**Post-merge canonical lineage evidence (`86bde72b…` @ `2071130`):**

| Check | Result | Evidence |
|-------|--------|----------|
| Active deployment | **PASS** | `wrangler deployments list` → **100%** `86bde72b-b945-48c0-99ce-eaf0500f8aeb` (2026-06-29T08:32:30Z) |
| Watcher health (post-redeploy) | **PASS** | `GET /api/health/payment-watcher` → `ok:true`, `last_scanned_at` **`2026-06-29T08:37:27.356Z`**, `scan_lag_seconds` **36** |
| Settlement regression | **PASS** | `GET /api/health/settlement` → `ok:true`, `backlog:0` |
| Database regression | **PASS** | `GET /api/health/database` → `ok:true`, `backend:postgres` |

**Step 10 governance merge/deploy lineage:** **RESOLVED** (2026-06-29). Step 10 itself remains **NOT STARTED** — Architect decision + §12 sign-off only. **Do not** sign Step 10 in this pass.

---

### Step 10 — Architect decision *(PASS — 2026-06-29)*

**Closure artifact:** [AI-TRADER MVP Ratification](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) — **RATIFIED** §8; creates no new rule; freezes MVP scope.

#### Reality Preconditions

Steps 1–9A **PASS**; Payment Watcher runtime recovery **PASS** (§10.1); PR #318 + PR #319 + PR #320 merged; production deploy lineage canonical (`86bde72b…` @ `2071130`).

#### Architect decisions

| Item | Decision | Rationale |
|------|----------|-----------|
| **`WAIA_CORE_ENFORCEMENT`** | **OFF** (unset on production Worker) | [M1 deployment runbook](../waia-core/WAIA-CORE-M1-DEPLOYMENT-RUNBOOK.md): leave OFF for MVP; ADR-0007 application-layer enforcement is primary; enabling enforcement is a post-MVP ADR-gated change |
| **`WAIA_POSTGRES_PER_REQUEST_CLIENT`** | **Waived** | Not set on Worker; code default on is acceptable for MVP Postgres lifecycle |
| **`LINEAR_API_KEY` / Cloudflare CI secrets** | **Waived** | CI operational (PR #318/#319 green); not BP-10 inventory; `linear-done.yml` hardening deferred post-MVP |
| **Production auth path** | **Accepted — Supabase Auth** | Steps 3–5 prove Supabase redirect + Org-0 + authenticated HTX connect |
| **User journey Steps 1–2** | **Accepted** | Step 4 `trader` entitlement PASS; Step 5 authenticated workspace PASS; e2e in CI |
| **Ratification Charter §8** | **Approved and signed** | Declarative closure seal; subordinate to Master Spec / MVP Scope / ADRs; no new rules |
| **§12 sign-off** | **Signed** | See §12 below |

| Field | Value |
|-------|-------|
| **Status** | **PASS** |
| **Evidence** | Architect attestation; charter **RATIFIED**; inventory UNKNOWN rows resolved; `WAIA_CORE_ENFORCEMENT` **OFF** documented |
| **Verified by** | Adamar / Architect-Operator |
| **Date** | 2026-06-29 |

**Step 10 verdict:** **PASS** — BP-9A **COMPLETE** (11/11).

**Next allowed step:** **BP-10 (DEE-340)** — launch authorization gate. **Do not** conflate BP-10 with MVP implementation.

---

## 11. Phase 2 evidence reference (non-value proofs only)

After provisioning, record evidence in §2 **Verified by** column and §10 step tables using shapes only:

| Proof type | Example (no values) |
|------------|---------------------|
| Health HTTP | `GET /api/health/database → 200` |
| Alerting config | `{ "configured": true, "sink": "telegram" }` |
| Alert drill send | `waia_alert_delivery outcome=success` |
| Master key ready | `isProductionReady()=true` (operator attestation) |
| HTX connect (Trader Workspace) | UI connect success; credential count=1 metadata only; `withdrawForbidden=true`; sync 200; snapshot counts; admin metadata 200 |
| Execution host | `GET {host}/health → 200` |
| Payment address registry | `payment_wallets` count ≥ 1; `payment_addresses` rows; watcher resolution attestation |
| Cron runtime gate | `wrangler tail` — zero `server-only` / `createRequire` exceptions across cron paths |

---

## 12. Sign-off and STOP

### Phase 1 (Composer)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Verification agent | Composer (DEE-352 Build) | 2026-06-28 | Phase 1 inventory complete |

### Phase 2 + final (human — COMPLETE)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Operator / Architect | Adamar / Architect-Operator | 2026-06-29 | BP-9A Phase 2 complete — Step 10 PASS; Production Configuration Inventory signed; [MVP Ratification](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) RATIFIED |

**STOP:** BP-9A **COMPLETE**. DEE-352 **Done**. **BP-10 L0 COMPLETE** — **HC-1 NEXT** (see §15). MVP not launched on `main`.

---

## 13. Governance reconciliation (snapshot — post PR #320)

> Historical snapshot only. Post-L0 state: see [§15](#15-post-l0-governance-sync-2026-06-29).

**Date:** 2026-06-29  
**Authority:** BP-9A governance completion pass

| Area | Result | Evidence |
|------|--------|----------|
| Repository | **PASS** | PR #318 + PR #319 + PR #320 merged; `origin/dev` @ `16117d0…` |
| Documentation | **PASS** | Report + LRR + Ratification Charter; Step 10 complete |
| Production lineage | **PASS** | Worker **`86bde72b…`** @ 100% from `2071130` (unchanged by docs-only #319/#320) |
| Linear | **PASS** | DEE-352 **Done**; DEE-340 **Todo** (BP-10 authorized, not started) |
| Step 10 | **PASS** | See §10; §12 signed 2026-06-29 |

---

## 14. Step 10 completion record

**Date:** 2026-06-29  
**Authority:** Adamar / Architect-Operator (Step 10 — Architect Decision)

| Decision | Outcome |
|----------|---------|
| `WAIA_CORE_ENFORCEMENT` | **OFF** |
| UNKNOWN inventory rows | **Resolved** (§10 table) |
| MVP Ratification Charter | **RATIFIED** |
| §12 sign-off | **Signed** |
| DEE-352 | **Done** |
| BP-10 / DEE-340 | **Unblocked for start** (not started) — superseded by §15 |

**Exact next action (at Step 10 close):** **Begin BP-10 (DEE-340)** — superseded by §15 after L0 merge.

---

## 15. Post-L0 governance sync (2026-06-29)

Factual update after BP-10 L0 merge — does not alter BP-9A Phase 1/2 conclusions.

| Field | Value |
|-------|-------|
| **BP-10 L0** | **COMPLETE** — [PR #322](https://github.com/oumaster369/waia/pull/322) @ `e19295e6347c12df958777b508e927662e9ac43c` |
| **Launch Operations Package** | [DEE-340-BP10-LAUNCH-RUNBOOK.md](DEE-340-BP10-LAUNCH-RUNBOOK.md) · [DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) |
| **Canonical execution plan** | [`.cursor/plans/bp-10_launch_execution_plan_e2aa412c.plan.md`](../../.cursor/plans/bp-10_launch_execution_plan_e2aa412c.plan.md) |
| **DEE-340 (Linear)** | **In Progress** (reopened after erroneous auto-Done on L0 merge; full BP-10 completes at L6) |
| **Active gate** | **HC-1** — Architect review of L0 package |
| **L1** | **NOT STARTED** |
| **MVP on `main`** | **Not launched** |

**Exact next action:** **HC-1 (Architect Review of the Launch Operations Package).**

---

## 16. Post-HC-1 addendum (2026-06-29)

Factual update after HC-1 approval — does not alter BP-9A Phase 1/2 conclusions or §15 historical record.

| Field | Value |
|-------|-------|
| **HC-1** | **APPROVED** — Architect / Adamar, 2026-06-29 ([PR #326](https://github.com/oumaster369/waia/pull/326) @ `392bb68324bc13e3ba16661afe37cb189e3199fb`) |
| **BP-10 L1** | **COMPLETE** — read-only validation chain green on canonical `dev` @ `392bb68`; 16-criterion table populated in [closure report](DEE-340-BP10-LAUNCH-CLOSURE-REPORT.md) |
| **DEE-340 (Linear)** | **In Progress** (full BP-10 completes at L6) |
| **Active gate** | **L2** — Operator criterion 10 manual billing gate (HC-3; ADR-0008) |
| **MVP on `main`** | **Not launched** |

**Exact next action:** **L2 (Operator — ADR-0008 manual billing / HWM gate on Org-0).**

---

## References

- [AI-TRADER MVP Ratification](../ai-trader/AI-TRADER-MVP-RATIFICATION.md) — Step 10 closure seal — **RATIFIED** 2026-06-29
- [Launch Readiness Review](DEE-352-LAUNCH-READINESS-REVIEW.md) — mandatory gate before Phase 2
- [BP-9 alerting runbook](DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md)
- [BP-7 live runbook](DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md)
- [BP-6 execution host runbook](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md)
- [AHR closure report](DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md)
- [cloudflare-env-vars.md](../cloudflare-env-vars.md)
- [MVP Execution Program v2](../ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md)
