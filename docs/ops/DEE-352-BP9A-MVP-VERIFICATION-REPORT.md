# DEE-352 — BP-9A Full MVP Verification Report

**Linear:** [DEE-352](https://linear.app/deepsense/issue/DEE-352/bp-9a-full-mvp-verification-production-configuration-inventory)  
**Blocks:** [DEE-340](https://linear.app/deepsense/issue/DEE-340) (BP-10)  
**Branch:** `dee-352-bp9a-mvp-verification`  
**Baseline SHA:** `0149267` (`dev` post BP-9 / PR #317)  
**Verified at:** 2026-06-28  
**Mode:** Verification only — no secret values in this document

---

## Executive summary

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase 1** — Inventory verification | **COMPLETE (Composer)** | Repo/docs audit, classification, validation chain, dry-run drill |
| **Phase 1 gate** — Human acceptance | **CHARTERED** | Operator chartered Phase 2 execution; formal sign-off §9 still open |
| **Phase 2** — Operator provisioning | **IN PROGRESS (0/10)** | Operator-guided; §10 playbook — **Composer does not autonomously provision** |
| **Phase 2** — Evidence recording | **IN PROGRESS** | Evidence slots ready; filled per operator step |
| **BP-10** | **BLOCKED** | DEE-340 blocked by DEE-352; not started |

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

**Current state:** **NOT READY FOR BP-10**

**Reasons:**

- Phase 2 not executed
- production secrets / configuration not evidenced
- live Telegram `--send` drill not executed
- execution host not evidenced
- Org-0 HTX production readiness not evidenced
- final human sign-off pending

**Future target state (after Phase 2):** **READY FOR BP-10** — only if all §10 steps verified and operator sign-off recorded in §12.

**Phase 2 verdict (current):** **OPERATOR ACTION REQUIRED** — 0/10 provisioning steps verified.

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
| Worker | Cron `* * * * *` | Payment watcher + settlement | wrangler.jsonc | Cloudflare cron | Yes | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |
| Worker | `ASSETS` binding | Static assets | wrangler.jsonc | Cloudflare | Yes | Yes | **VERIFIED IN CODE** | Repository |
| Worker | `WORKER_SELF_REFERENCE` | Self-invoke | wrangler.jsonc | Cloudflare | Yes | Yes | **VERIFIED IN CODE** | Repository |
| Worker | `AI_TRADER_MASTER_KEY` Secrets Store binding | HTX credential crypto | [DEE-220 runbook](DEE-220-MASTER-KEY-RUNBOOK.md) | Cloudflare Secrets Store | Commented in wrangler | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Plain env | `NEXT_PUBLIC_SITE_URL` | Auth redirects | wrangler.jsonc | Cloudflare plain | Yes | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |
| Plain env | `NEXT_PUBLIC_TRADER_URL` | Trader portal links | wrangler.jsonc | Cloudflare plain | Yes | Yes | **OPERATOR REQUIRED** | Cloudflare DNS PENDING |
| Plain env | `WAIA_TRADER_HOST` | Host routing | wrangler.jsonc | Cloudflare plain | Yes | Yes | **VERIFIED IN CODE** | Repository |
| Plain env | `OAUTH_PUBLIC_BASE_URL` | OAuth callbacks | wrangler.jsonc | Cloudflare plain | Yes | If OAuth | **VERIFIED IN CODE** | Repository; Runtime PENDING |
| Plain env | `WAIA_DB_BACKEND=postgres` | Worker DB path | wrangler.jsonc | Cloudflare plain | Yes | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |
| Plain env | `WAIA_DEPLOYMENT_TIER=production` | Master key readiness | DEE-220 | Cloudflare plain | .env.example | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Plain env | `WAIA_CORE_ENFORCEMENT` | Permission fail-closed | M1 runbook | Cloudflare plain | .env.example | Recommended | **UNKNOWN** | Operator decision PENDING |
| Plain env | `WAIA_CORE_SHADOW` | Shadow audit | lib/waia-core/config.ts | Cloudflare plain | .env.example | No | **NOT APPLICABLE** | — |
| Plain env | `WAIA_POSTGRES_PER_REQUEST_CLIENT` | PG lifecycle | cloudflare-env-vars.md | Cloudflare plain | .dev.vars.example | Yes | **UNKNOWN** | Cloudflare PENDING |
| Secret | `DATABASE_URL_POSTGRES` | All trader/core Postgres | DEE-74/75 | Wrangler secret | .dev.vars.example | Yes | **OPERATOR REQUIRED** | Supabase/Postgres PENDING |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin | cloudflare-env-vars.md | Wrangler secret | .dev.vars.example | If Supabase | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Public | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Supabase client | wrangler.jsonc | Cloudflare plain | wrangler + .dev.vars.example | If Supabase auth | **VERIFIED IN CODE** | Repository; Runtime PENDING |
| Secret | OAuth provider secrets | Login | cloudflare-env-vars.md | Wrangler secrets | .env.example | Optional | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Secret | `WAIA_AI_OPENAI_API_KEY` | Twin AI | cloudflare-env-vars.md | Wrangler secret | .env.example | If AI enabled | **UNKNOWN** | Not BP-10 critical |
| Worker cron | `MARKET_BRAIN_ENABLED` + org id | MSV/CDE ingestion | .env.example | Cloudflare | Placeholder | Yes for live data | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Worker cron | `PAPER_LOOP_*` vars | Paper loop cron | .env.example | Cloudflare | Placeholder | Yes for paper | **OPERATOR REQUIRED** | Cloudflare PENDING |
| CI | `LINEAR_API_KEY` | Auto Done on merge | .env.example | GitHub Actions secret | Documented | No | **UNKNOWN** | Not BP-10 critical |
| CI | `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` | Preview deploy | docs | GitHub secrets | N/A | No | **UNKNOWN** | Not BP-10 critical |

### 2.2 AI-TRADER exchange / HTX

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------|
| HTX | Org-0 API key (Read+Trade only) | Live + sync | BP-7 runbook | Encrypted credential service | Yes | **OPERATOR REQUIRED** | HTX PENDING |
| HTX | `AI_TRADER_MASTER_KEY` binding | Decrypt | DEE-220 | Secrets Store | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| HTX | `WAIA_TRADER_ORG0_ORGANIZATION_ID` | Org-0 allowlist | .env.example | Operator env | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| HTX | `HTX_REST_HOST` | Market brain REST | .env.example | Cloudflare plain | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| HTX | Forbidden permissions enforced | Security | MVP Scope | DB credential row | Yes | **VERIFIED IN CODE** | Repository; HTX connect PENDING |
| HTX | Balance/position/trade sync | Account status | BP-2C APIs | N/A | Yes | **VERIFIED IN CODE** | Repository; HTX runtime proof pending |

### 2.3 Telegram alerting (BP-9)

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------|
| Alerts | `TELEGRAM_ALERTS_BOT_TOKEN` | sendMessage | DEE-223 runbook | Wrangler secret | Yes | **OPERATOR REQUIRED** | Telegram PENDING |
| Alerts | `TELEGRAM_ALERTS_CHAT_ID` | Forum group | DEE-223 runbook | Wrangler secret | Yes | **OPERATOR REQUIRED** | Telegram PENDING |
| Alerts | `TELEGRAM_ALERTS_THREAD_ID` | Alerts topic | DEE-223 runbook | Wrangler secret | Yes | **OPERATOR REQUIRED** | Telegram PENDING |
| Alerts | Dedicated bot (not `TELEGRAM_BOT_TOKEN`) | Isolation | BP-9 ratification | BotFather | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| Alerts | `pnpm trader:alert:drill --dry-run` | Dev verification | package.json | N/A | BP-9A | **PASS** | CI / Runtime local 2026-06-28 |
| Alerts | `pnpm trader:alert:drill --send` | Prod proof | DEE-223 runbook | Operator shell | Yes | **OPERATOR REQUIRED** | Telegram PENDING |
| Alerts | `/api/health/alerting` | Config probe | app/api/health/alerting | Code | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |

### 2.4 Billing and payments

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Watcher | `WATCHER_ENABLED=1` | USDT detection | watcher-config | Cloudflare | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Watcher | `TRONGRID_API_KEY` | TRC-20 scan | .env.example | Wrangler secret | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Watcher | `TRON_RPC_*` | Provider failover | .env.example | Wrangler | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Watcher | `WATCHER_*` tuning | Finality/rescan | watcher-config | Cloudflare plain | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |
| Billing | USDT deposit addresses | Attribution | ADR-0013 | Postgres registry | Yes | **OPERATOR REQUIRED** | Supabase/Postgres PENDING |
| Billing | Manual invoice gate | ADR-0008 | Admin billing UI | N/A | Yes | **VERIFIED IN CODE** | Repository; Operator PENDING |
| Billing | HWM + 30% fee | Reporting | BP-4 | Postgres | Yes | **VERIFIED IN CODE** | Repository; Supabase PENDING |
| Billing | Suspension lifecycle | BP-3 | DEE-217 | Postgres | Yes | **VERIFIED IN CODE** | Repository / CI; Runtime PENDING |
| Settlement | Settlement cron + health | Account status | health routes | Cron | Yes | **VERIFIED IN CODE** | Repository; Runtime PENDING |

### 2.5 Database / Postgres

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Postgres | Migrations applied | Schema parity | db/migrations_postgres/ | Supabase | Yes | **OPERATOR REQUIRED** | Supabase/Postgres PENDING |
| Postgres | Transaction pooler URI | Workers runtime | DEE-75 | Wrangler secret | Yes | **OPERATOR REQUIRED** | Supabase/Postgres PENDING |
| Postgres | RLS policies | ADR-0007 | *_rls.sql migrations | Supabase | Yes | **VERIFIED IN CODE** | Repository; Supabase PENDING |
| Postgres | Tenant isolation CI | ADR-0007 | ci.yml | GitHub | Yes | **PASS** | CI / Repository |
| SQLite | `DATABASE_URL` file | Local dev only | .env.example | Local | No (not prod) | **NOT APPLICABLE** | Repository |

### 2.6 Auth / WAIA Core

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Auth | Supabase Auth OR legacy session | Login | sign-in route | Supabase / SQLite | Yes | **UNKNOWN** | Operator PENDING prod path |
| Auth | `trader.waia.life` DNS | Trader module | AT-E1 checklist | Cloudflare DNS | Yes | **OPERATOR REQUIRED** | Cloudflare PENDING |
| Entitlement | `trader` org entitlement | Module gate | runtime-provisioning | Postgres | Yes | **VERIFIED IN CODE** | Repository; Supabase PENDING |
| Admin | Platform role `admin` | Admin console | permissions/resolve | user_platform_roles | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| Admin | Permissions e.g. `admin.audit.read` | Admin API | admin routes | DB | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| Org-0 | Organization UUID | Live allowlist | .env.example | Operator | Yes | **OPERATOR REQUIRED** | Operator PENDING |

### 2.7 Execution host (Option B)

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Verified by |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Host | Isolated VPS/container | Live CLI plane | DEE-339 runbook | Operator infra | Yes | **OPERATOR REQUIRED** | Execution Host PENDING |
| Host | `WAIA_TRADER_EXECUTION_HOST_URL` | Live cycle gate | .env.example | Host env | Yes | **OPERATOR REQUIRED** | Execution Host PENDING |
| Host | Runtime secrets (separate KMS) | Host-only | DEE-339 §2.C | Host inject | Yes | **OPERATOR REQUIRED** | Operator PENDING |
| Host | No Worker live `placeOrder` | Option B | BP-7 runbook | Code | Yes | **PASS** | Repository / CI |
| Host | BP-7 seven-stage evidence | Pre-BP-10 | DEE-212 runbook | Off-repo | Yes | **OPERATOR REQUIRED** | Execution Host PENDING |

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
| 1–2 | Register + trader entitlement | Auth routes; [trader.spec.ts](../../tests/e2e/trader.spec.ts) | **UNKNOWN** | Repository / CI | Blocks if prod auth broken |
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
| 3 | HTX spot read + encrypted creds + sync | 2 | **OPERATOR REQUIRED** | Connect API + sync handlers in repo |
| 4 | Market data ingestion + fail-closed | 2 | **OPERATOR REQUIRED** | MARKET_BRAIN_* config pending |
| 5 | MSV + CDE operational | 2 | **OPERATOR REQUIRED** | Telemetry + code present |
| 6 | Two strategies registered; CDE signal-only | 1 | **PASS** | DEE-337; registry tests |
| 7 | Risk + kill switches; reconciliation | 1 | **PASS** | CI tests; admin kill-switch UI |
| 8 | Paper loop + AHR validated | 1 | **PASS** | [DEE-337 closure report](DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md) |
| 9 | Signed validation-gate promotion (ADR-0010/11) | 1 | **PASS** | DEE-178; admin promotion UI |
| 10 | Reporting + HWM + 30% fee + manual gate | 2 | **OPERATOR REQUIRED** | Admin billing; ADR-0008 |
| 11 | USDT payments + suspension lifecycle | 2 | **OPERATOR REQUIRED** | BP-3 evidence; watcher health |
| 12 | Org-0 live admin-gated; isolated host | 2 | **OPERATOR REQUIRED** | BP-7 runbook preconditions |
| 13 | Admin console complete | 1 | **PASS** | BP-8 PR #316; admin route tests |
| 14 | External live blocked (ADR-0009) | 1 | **PASS** | org allowlist tests; live path fail-closed |
| 15 | Live Telegram alert delivery | 2 | **OPERATOR REQUIRED** | `--send` drill + delivery telemetry |
| 16 | Production Configuration Inventory signed | 2 | **OPERATOR REQUIRED** | §12 operator sign-off |

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
| `/api/health/database` | Postgres connectivity | **VERIFIED IN CODE** | Runtime PENDING HTTP 200 |
| `/api/health/payment-watcher` | Watcher staleness | **VERIFIED IN CODE** | Runtime PENDING |
| `/api/health/settlement` | Settlement cron | **VERIFIED IN CODE** | Runtime PENDING |
| `/api/health/settlement-reconciliation` | Reconciliation | **VERIFIED IN CODE** | Runtime PENDING |
| `/api/health/alerting` | Telegram config | **VERIFIED IN CODE** | Runtime PENDING `{configured:true}` |

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
| Production secrets unprovisioned (§2) | **OPERATOR REQUIRED** | **Yes** |
| Phase 1 human acceptance | Gate | **CHARTERED** — formal §9 sign-off open | Phase 2 guided prep active |
| Live `--send` Telegram drill not run | **OPERATOR REQUIRED** | **Yes** (criterion 15) |
| Execution host not provisioned | **OPERATOR REQUIRED** | **Yes** |
| Steps 5–6 no trader UI | **INFORMATIONAL GAP** | **No** — AHR satisfies criterion 8 |
| `WAIA_CORE_ENFORCEMENT` default off | Architect decision | Informational |

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

**Composer Phase 1 deliverables complete.** Phase 2 operator-guided execution **chartered** — formal acceptance still required.

- [ ] Production Configuration Inventory (§2) reviewed and accepted
- [ ] User journey classification (§3) reviewed and accepted
- [ ] MVP checklist Phase 1 mappings (§4) reviewed and accepted
- [ ] No secret values in any artifact confirmed

**Operator acceptance:**

| Field | Value |
|-------|-------|
| Accepted by | _PENDING_ |
| Date | _PENDING_ |
| Notes | _PENDING_ |

---

## 10. Phase 2 operator provisioning (human-only, strict order)

**Protocol:** Execute steps **1 → 10** in order. **Never reorder.** After each step: verify expected outcome → collect non-secret evidence → update this section and §2 inventory → **STOP** if verification fails.

**Composer role:** Guide operator, record evidence, sync docs/Linear. **Composer must not** run `wrangler secret put`, provision secrets, or execute `--send` autonomously.

**Progress:** **0 / 10** steps verified (last updated 2026-06-28)

| Step | Title | Status | Verified by | Date |
|------|-------|--------|-------------|------|
| 1 | Postgres | **OPERATOR REQUIRED** | — | — |
| 2 | Secrets Store / master key | **OPERATOR REQUIRED** | — | — |
| 3 | Trader host DNS | **OPERATOR REQUIRED** | — | — |
| 4 | Org-0 identity + admin | **OPERATOR REQUIRED** | — | — |
| 5 | HTX Org-0 connect + sync | **OPERATOR REQUIRED** | — | — |
| 6 | Payment watcher | **OPERATOR REQUIRED** | — | — |
| 7 | Telegram alerting | **OPERATOR REQUIRED** | — | — |
| 8 | Execution host | **OPERATOR REQUIRED** | — | — |
| 9 | Cron workers | **OPERATOR REQUIRED** | — | — |
| 10 | Architect decision | **UNKNOWN** | — | — |

---

### Step 1 — Postgres

**Operator actions:**

1. Apply full Postgres migration chain to production Supabase (`pnpm db:migrate:postgres` against production URI — operator shell only).
2. Store transaction pooler URI: `npx wrangler secret put DATABASE_URL_POSTGRES` (never paste URI into this report).
3. Confirm `WAIA_DB_BACKEND=postgres` on Worker.

**Verification (operator or Composer after operator confirms deploy):**

```bash
curl -sS -o /dev/null -w "%{http_code}" https://waia.life/api/health/database
# Expect: 200
```

**Expected outcome:** Health returns `200`; no secret values in response body logged to report.

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — e.g. `GET /api/health/database → 200`_ |
| **Verified by** | _pending — Supabase/Postgres + Runtime_ |
| **Date** | _pending_ |

**Inventory rows updated when PASS:** `DATABASE_URL_POSTGRES`, Postgres migrations, RLS apply proof.

**On FAIL:** STOP. Do not proceed to Step 2.

---

### Step 2 — Secrets Store / master key

**Operator actions:** Per [DEE-220](DEE-220-MASTER-KEY-RUNBOOK.md):

1. Generate master key offline (`openssl rand -base64 32`) — vault only.
2. Create Secrets Store + upload `ai-trader-master-key-v1`.
3. Add `secrets_store_secrets` binding to `wrangler.jsonc` with real `store_id`; deploy.
4. Set plain env `WAIA_DEPLOYMENT_TIER=production` on Worker.

**Verification:**

- Operator attestation: `createMasterKeyProvider().isProductionReady()` equivalent passes on deployed Worker (no key material in logs).
- HTX credential encrypt/decrypt smoke after Step 5 depends on this step.

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — operator attestation: Secrets Store binding active; tier=production_ |
| **Verified by** | _pending — Cloudflare + Operator_ |
| **Date** | _pending_ |

**Inventory rows:** `AI_TRADER_MASTER_KEY`, `WAIA_DEPLOYMENT_TIER`.

**On FAIL:** STOP.

---

### Step 3 — Trader host DNS

**Operator actions:** Per [AT-E1 checklist](AT-E1-S2-PR-OPERATOR-CHECKLIST.md):

1. Attach `trader.waia.life` custom domain on `waia-app` Worker.
2. Add Supabase redirect URL `https://trader.waia.life/**`.
3. Confirm `NEXT_PUBLIC_TRADER_URL` / `WAIA_TRADER_HOST` on Worker.

**Verification:**

```bash
curl -sS -o /dev/null -w "%{http_code}" https://trader.waia.life/trader
# Expect: 200 or 302 to auth (not DNS failure)
```

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — HTTPS resolves; trader route reachable_ |
| **Verified by** | _pending — Cloudflare + Runtime_ |
| **Date** | _pending_ |

**Inventory rows:** `NEXT_PUBLIC_TRADER_URL`, trader DNS.

**On FAIL:** STOP.

---

### Step 4 — Org-0 identity + admin

**Operator actions:**

1. Record Org-0 organization UUID → `WAIA_TRADER_ORG0_ORGANIZATION_ID` (host/operator env + Worker if applicable).
2. Grant platform role `admin` to BP-10 operator user in `user_platform_roles`.
3. Confirm `trader` entitlement on Org-0 org.

**Verification:**

- Admin console loads at `https://trader.waia.life/admin` for operator user (HTTP 200 on shell; 403 without role).
- Operator attestation: org UUID recorded in operator vault (not in report).

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — admin route 200 for operator; entitlement confirmed_ |
| **Verified by** | _pending — Operator + Supabase/Postgres_ |
| **Date** | _pending_ |

**Inventory rows:** Org-0 UUID, admin role, permissions, entitlement.

**On FAIL:** STOP.

---

### Step 5 — HTX Org-0 connect + sync

**Operator actions:**

1. Create HTX API key: **Read + Trade only**; no Withdraw/Transfer.
2. Connect via trader UI or connect API (secrets never logged).
3. Run balance, position, and trade-history sync for Org-0 credential.

**Verification:**

- Operator attestation: `permissionMetadata.withdraw=false`, `transfer=false` (or equivalent rejection at connect).
- Sync API returns success (HTTP 200); snapshot rows present (count only, no balances in report unless non-sensitive aggregate).

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — connect success; forbidden permissions absent; sync 200_ |
| **Verified by** | _pending — HTX + Operator + Runtime_ |
| **Date** | _pending_ |

**Inventory rows:** Org-0 HTX creds, sync APIs, forbidden permissions runtime proof.

**On FAIL:** STOP.

---

### Step 6 — Payment watcher

**Operator actions:**

1. Set `WATCHER_ENABLED=1` on Worker.
2. `wrangler secret put TRONGRID_API_KEY` and `TRON_RPC_*` as required.
3. Deploy; wait for at least one cron cycle.

**Verification:**

```bash
curl -sS https://waia.life/api/health/payment-watcher
# Expect: JSON with ok/stale fields; HTTP 200 when healthy
```

- Telemetry: `waia_payment_watcher` cycle events in Worker logs (no secret values).

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — health JSON shape; cycle_complete in logs_ |
| **Verified by** | _pending — Cloudflare + Runtime_ |
| **Date** | _pending_ |

**Inventory rows:** `WATCHER_*`, `TRONGRID_*`, `TRON_RPC_*`.

**On FAIL:** STOP.

---

### Step 7 — Telegram alerting

**Operator actions:** Per [DEE-223 runbook](DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md):

1. Create **dedicated Alerts Bot** (not OAuth bot).
2. Forum supergroup + **Alerts** topic.
3. `wrangler secret put TELEGRAM_ALERTS_BOT_TOKEN`, `TELEGRAM_ALERTS_CHAT_ID`, `TELEGRAM_ALERTS_THREAD_ID`.
4. Operator runs: `pnpm trader:alert:drill --send` (with secrets in local env — not Composer-autonomous).

**Telegram permission verification (all required):**

- [ ] Dedicated Alerts Bot can post into Forum topic **Alerts**
- [ ] `TELEGRAM_ALERTS_CHAT_ID` verified (non-value attestation)
- [ ] `TELEGRAM_ALERTS_THREAD_ID` verified (non-value attestation)
- [ ] `--send` drill message visible in correct topic
- [ ] `waia_alert_delivery outcome=success` in logs/telemetry

**Verification:**

```bash
curl -sS https://waia.life/api/health/alerting
# Expect: {"configured":true,"sink":"telegram"}
```

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — health configured:true; drill success; delivery telemetry_ |
| **Verified by** | _pending — Telegram + Cloudflare + Runtime_ |
| **Date** | _pending_ |

**Inventory rows:** all `TELEGRAM_ALERTS_*`, criterion 15.

**On FAIL:** STOP.

---

### Step 8 — Execution host

**Operator actions:** Per [DEE-339](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md):

1. Deploy isolated execution host container.
2. Inject host-only secrets via operator KMS (not Cloudflare Secrets Store).
3. Set `WAIA_TRADER_EXECUTION_HOST_URL` on operator/host env.

**Verification:**

```bash
curl -sS -o /dev/null -w "%{http_code}" "${WAIA_TRADER_EXECUTION_HOST_URL}/health"
# Expect: 200 (operator runs — do not paste host secrets)
```

- Option B: confirm no Worker `placeOrder` path (already **PASS** in §8).

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — GET /health → 200; URL recorded in operator vault only_ |
| **Verified by** | _pending — Execution Host + Operator_ |
| **Date** | _pending_ |

**Inventory rows:** host URL, host secrets, BP-7 seven-stage evidence bundle.

**On FAIL:** STOP.

---

### Step 9 — Cron workers

**Operator actions:**

1. Enable `MARKET_BRAIN_ENABLED=1` + `MARKET_BRAIN_ORGANIZATION_ID` (Org-0) if prod ingestion required.
2. Enable `PAPER_LOOP_*` vars per production policy.
3. Deploy Worker.

**Verification:**

- Worker logs: `waia_trader_event` paper_loop / market_brain cycles (event names only).
- Operator attestation: which paths enabled documented in operator notes (not secrets).

| Field | Value |
|-------|-------|
| **Status** | **OPERATOR REQUIRED** |
| **Evidence** | _pending — telemetry event names; operator policy note_ |
| **Verified by** | _pending — Cloudflare + Runtime + Operator_ |
| **Date** | _pending_ |

**On FAIL:** STOP.

---

### Step 10 — Architect decision

**Operator actions:**

1. Confirm `WAIA_CORE_ENFORCEMENT` posture for production (on/off documented).
2. Waive or resolve any remaining **UNKNOWN** inventory rows.

| Field | Value |
|-------|-------|
| **Status** | **UNKNOWN** |
| **Evidence** | _pending — Architect attestation line_ |
| **Verified by** | _pending — Operator_ |
| **Date** | _pending_ |

**On FAIL:** STOP.

---

## 11. Phase 2 evidence reference (non-value proofs only)

After provisioning, record evidence in §2 **Verified by** column and §10 step tables using shapes only:

| Proof type | Example (no values) |
|------------|---------------------|
| Health HTTP | `GET /api/health/database → 200` |
| Alerting config | `{ "configured": true, "sink": "telegram" }` |
| Alert drill send | `waia_alert_delivery outcome=success` |
| Master key ready | `isProductionReady()=true` (operator attestation) |
| HTX connect | `permissionMetadata.withdraw=false` (operator attestation) |
| Execution host | `GET {host}/health → 200` |

---

## 12. Sign-off and STOP

### Phase 1 (Composer)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Verification agent | Composer (DEE-352 Build) | 2026-06-28 | Phase 1 inventory complete |

### Phase 2 + final (human — PENDING)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Operator / Architect | _PENDING_ | _PENDING_ | _PENDING_ |

**STOP:** BP-10 / DEE-340 not started. DEE-340 remains blocked by DEE-352 until this issue is Done with full Phase 2 evidence.

---

## References

- [BP-9 alerting runbook](DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md)
- [BP-7 live runbook](DEE-212-BP7-LIVE-EXECUTION-RUNBOOK.md)
- [BP-6 execution host runbook](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md)
- [AHR closure report](DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md)
- [cloudflare-env-vars.md](../cloudflare-env-vars.md)
- [MVP Execution Program v2](../ai-trader/AI-TRADER-MVP-EXECUTION-PROGRAM-v2.md)
