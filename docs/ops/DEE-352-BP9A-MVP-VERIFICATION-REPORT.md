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
| **Phase 1 gate** — Human acceptance | **PENDING** | Operator must sign §12 before Phase 2 |
| **Phase 2** — Operator provisioning | **PENDING** | Human-only; checklist §13 |
| **Phase 2** — Evidence recording | **PENDING** | After provisioning; template §14 |
| **BP-10** | **STOPPED** | Not started per plan |

**Secret discipline:** No secret values recorded. Publishable Supabase anon key in `wrangler.jsonc` is intentional public config (not a server secret). No leaked credentials found in repo scan.

**Checklist numbering:** Program doc lists criteria **1–14**; BP-9A adds **15** (live Telegram drill) and **16** (signed inventory) → **14+2 = 16** for DEE-340 alignment.

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

**Legend — Status (Phase 1, repo/docs only):**

- **Present** — committed placeholder, code route, or documented plain env in repo
- **Missing** — not documented in repo placeholders
- **Unknown** — production state not confirmable from repo alone
- **Operator Required** — real production value must be provisioned by human

**Evidence (Phase 2)** column filled only after operator provisioning (non-value proofs).

### 2.1 Cloudflare / Worker

| Category | Name / Binding | Required for | Source | Storage location | Placeholder in repo? | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------------|---------------|--------|-------------------|
| Worker | `name: waia-app`, `main: custom-worker.ts` | Deploy | [wrangler.jsonc](../../wrangler.jsonc) | wrangler.jsonc | Present | Yes | **Present** | — |
| Worker | Cron `* * * * *` | Payment watcher + settlement | wrangler.jsonc | Cloudflare cron | Present | Yes | **Present** | PENDING |
| Worker | `ASSETS` binding | Static assets | wrangler.jsonc | Cloudflare | Present | Yes | **Present** | — |
| Worker | `WORKER_SELF_REFERENCE` | Self-invoke | wrangler.jsonc | Cloudflare | Present | Yes | **Present** | — |
| Worker | `AI_TRADER_MASTER_KEY` Secrets Store binding | HTX credential crypto | [DEE-220 runbook](DEE-220-MASTER-KEY-RUNBOOK.md) | Cloudflare Secrets Store | Commented in wrangler | Yes | **Operator Required** | PENDING |
| Plain env | `NEXT_PUBLIC_SITE_URL` | Auth redirects | wrangler.jsonc | Cloudflare plain | Yes | Yes | **Present** | PENDING |
| Plain env | `NEXT_PUBLIC_TRADER_URL` | Trader portal links | wrangler.jsonc | Cloudflare plain | Yes | Yes | **Operator Required** (DNS) | PENDING |
| Plain env | `WAIA_TRADER_HOST` | Host routing | wrangler.jsonc | Cloudflare plain | Yes | Yes | **Present** | — |
| Plain env | `OAUTH_PUBLIC_BASE_URL` | OAuth callbacks | wrangler.jsonc | Cloudflare plain | Yes | If OAuth | **Present** | PENDING |
| Plain env | `WAIA_DB_BACKEND=postgres` | Worker DB path | wrangler.jsonc | Cloudflare plain | Yes | Yes | **Present** | PENDING |
| Plain env | `WAIA_DEPLOYMENT_TIER=production` | Master key readiness | DEE-220 | Cloudflare plain | [.env.example](../../.env.example) | Yes | **Operator Required** | PENDING |
| Plain env | `WAIA_CORE_ENFORCEMENT` | Permission fail-closed | M1 runbook | Cloudflare plain | .env.example | Recommended | **Unknown** (default off) | PENDING |
| Plain env | `WAIA_CORE_SHADOW` | Shadow audit | lib/waia-core/config.ts | Cloudflare plain | .env.example | No | **Unknown** | — |
| Plain env | `WAIA_POSTGRES_PER_REQUEST_CLIENT` | PG lifecycle | cloudflare-env-vars.md | Cloudflare plain | .dev.vars.example | Yes | **Unknown** | PENDING |
| Secret | `DATABASE_URL_POSTGRES` | All trader/core Postgres | DEE-74/75 | Wrangler secret | .dev.vars.example | Yes | **Operator Required** | PENDING |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin | cloudflare-env-vars.md | Wrangler secret | .dev.vars.example | If Supabase | **Operator Required** | PENDING |
| Public | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | Supabase client | wrangler.jsonc | Cloudflare plain | wrangler + .dev.vars.example | If Supabase auth | **Present** | PENDING |
| Secret | OAuth provider secrets | Login | cloudflare-env-vars.md | Wrangler secrets | .env.example | Optional | **Operator Required** | PENDING |
| Secret | `WAIA_AI_OPENAI_API_KEY` | Twin AI | cloudflare-env-vars.md | Wrangler secret | .env.example | If AI enabled | **Unknown** | — |
| Worker cron | `MARKET_BRAIN_ENABLED` + org id | MSV/CDE ingestion | .env.example | Cloudflare | Placeholder | Yes for live data | **Operator Required** | PENDING |
| Worker cron | `PAPER_LOOP_*` vars | Paper loop cron | .env.example | Cloudflare | Placeholder | Yes for paper | **Operator Required** | PENDING |
| CI | `LINEAR_API_KEY` | Auto Done on merge | .env.example | GitHub Actions secret | Documented | No | **Unknown** | — |
| CI | `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` | Preview deploy | docs | GitHub secrets | N/A | No | **Unknown** | — |

### 2.2 AI-TRADER exchange / HTX

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| HTX | Org-0 API key (Read+Trade only) | Live + sync | BP-7 runbook | Encrypted credential service | Yes | **Operator Required** | PENDING |
| HTX | `AI_TRADER_MASTER_KEY` binding | Decrypt | DEE-220 | Secrets Store | Yes | **Operator Required** | PENDING |
| HTX | `WAIA_TRADER_ORG0_ORGANIZATION_ID` | Org-0 allowlist | .env.example | Operator env | Yes | **Operator Required** | PENDING |
| HTX | `HTX_REST_HOST` | Market brain REST | .env.example | Cloudflare plain | Yes | **Operator Required** | PENDING |
| HTX | Forbidden permissions enforced | Security | MVP Scope | DB credential row | Yes | **Present** (code) | PENDING connect proof |
| HTX | Balance/position/trade sync | Account status | BP-2C APIs | N/A | Yes | **Present** (code) | PENDING prod sync |

### 2.3 Telegram alerting (BP-9)

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Alerts | `TELEGRAM_ALERTS_BOT_TOKEN` | sendMessage | DEE-223 runbook | Wrangler secret | Yes | **Operator Required** | PENDING |
| Alerts | `TELEGRAM_ALERTS_CHAT_ID` | Forum group | DEE-223 runbook | Wrangler secret | Yes | **Operator Required** | PENDING |
| Alerts | `TELEGRAM_ALERTS_THREAD_ID` | Alerts topic | DEE-223 runbook | Wrangler secret | Yes | **Operator Required** | PENDING |
| Alerts | Dedicated bot (not `TELEGRAM_BOT_TOKEN`) | Isolation | BP-9 ratification | BotFather | Yes | **Operator Required** | PENDING |
| Alerts | `pnpm trader:alert:drill --dry-run` | Dev verification | package.json | N/A | BP-9A | **Present** | PASS local 2026-06-28 |
| Alerts | `pnpm trader:alert:drill --send` | Prod proof | DEE-223 runbook | Operator shell | Yes | **Operator Required** | PENDING |
| Alerts | `/api/health/alerting` | Config probe | app/api/health/alerting | Code | Yes | **Present** (code) | PENDING prod curl |

### 2.4 Billing and payments

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Watcher | `WATCHER_ENABLED=1` | USDT detection | watcher-config | Cloudflare | Yes | **Operator Required** | PENDING |
| Watcher | `TRONGRID_API_KEY` | TRC-20 scan | .env.example | Wrangler secret | Yes | **Operator Required** | PENDING |
| Watcher | `TRON_RPC_*` | Provider failover | .env.example | Wrangler | Yes | **Operator Required** | PENDING |
| Watcher | `WATCHER_*` tuning | Finality/rescan | watcher-config | Cloudflare plain | Yes | **Present** (defaults) | PENDING |
| Billing | USDT deposit addresses | Attribution | ADR-0013 | Postgres registry | Yes | **Operator Required** | PENDING |
| Billing | Manual invoice gate | ADR-0008 | Admin billing UI | N/A | Yes | **Present** (code) | PENDING walkthrough |
| Billing | HWM + 30% fee | Reporting | BP-4 | Postgres | Yes | **Present** (code) | PENDING data |
| Billing | Suspension lifecycle | BP-3 | DEE-217 | Postgres | Yes | **Present** (code/tests) | PENDING prod re-verify |
| Settlement | Settlement cron + health | Account status | health routes | Cron | Yes | **Present** (code) | PENDING prod health |

### 2.5 Database / Postgres

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Postgres | Migrations applied | Schema parity | db/migrations_postgres/ | Supabase | Yes | **Operator Required** | PENDING |
| Postgres | Transaction pooler URI | Workers runtime | DEE-75 | Wrangler secret | Yes | **Operator Required** | PENDING |
| Postgres | RLS policies | ADR-0007 | *_rls.sql migrations | Supabase | Yes | **Present** (code) | PENDING apply proof |
| Postgres | Tenant isolation CI | ADR-0007 | ci.yml | GitHub | Yes | **Present** | PASS local tests |
| SQLite | `DATABASE_URL` file | Local dev only | .env.example | Local | No (not prod) | **Present** | — |

### 2.6 Auth / WAIA Core

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Auth | Supabase Auth OR legacy session | Login | sign-in route | Supabase / SQLite | Yes | **Unknown** (dual-path) | PENDING prod path |
| Auth | `trader.waia.life` DNS | Trader module | AT-E1 checklist | Cloudflare DNS | Yes | **Operator Required** | PENDING |
| Entitlement | `trader` org entitlement | Module gate | runtime-provisioning | Postgres | Yes | **Present** (code) | PENDING seed proof |
| Admin | Platform role `admin` | Admin console | permissions/resolve | user_platform_roles | Yes | **Operator Required** | PENDING |
| Admin | Permissions e.g. `admin.audit.read` | Admin API | admin routes | DB | Yes | **Operator Required** | PENDING |
| Org-0 | Organization UUID | Live allowlist | .env.example | Operator | Yes | **Operator Required** | PENDING |

### 2.7 Execution host (Option B)

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Host | Isolated VPS/container | Live CLI plane | DEE-339 runbook | Operator infra | Yes | **Operator Required** | PENDING |
| Host | `WAIA_TRADER_EXECUTION_HOST_URL` | Live cycle gate | .env.example | Host env | Yes | **Operator Required** | PENDING |
| Host | Runtime secrets (separate KMS) | Host-only | DEE-339 §2.C | Host inject | Yes | **Operator Required** | PENDING |
| Host | No Worker live `placeOrder` | Option B | BP-7 runbook | Code | Yes | **Present** | Code review PASS |
| Host | BP-7 seven-stage evidence | Pre-BP-10 | DEE-212 runbook | Off-repo | Yes | **Operator Required** | PENDING |

### 2.8 Observability

| Category | Name / Binding | Required for | Source | Storage location | Before BP-10? | Status | Evidence (Phase 2) |
|----------|----------------|--------------|--------|------------------|---------------|--------|-------------------|
| Telemetry | `waia_trader_event` stdout | Critical surfacing | DEE-222 schema | Worker logs | Yes | **Present** | — |
| Alerting | Inline router (3 wiring points) | BP-9 | telemetry modules | Code | Yes | **Present** | PENDING prod delivery |
| Audit | Append-only audit tables | ADR-0011 | waia-core audit | Postgres | Yes | **Present** | PENDING admin UI |
| Health | 5 health routes | Ops probes | app/api/health/* | Code | Yes | **Present** | PENDING prod curl |

---

## 3. User journey re-verification (post BP-2C / BP-8 / BP-9)

Reference: [AI-TRADER-USER-JOURNEY-v2.md](../ai-trader/AI-TRADER-USER-JOURNEY-v2.md)

**Note:** DEE-348 (BP-2A) pre-BP-2C FAIL is **not** inherited. Classification from current repo at `0149267`.

| Step | Requirement | Current evidence | Phase 1 classification | BP-10 impact |
|------|-------------|------------------|------------------------|--------------|
| 1–2 | Register + trader entitlement | Auth routes; [trader.spec.ts](../../tests/e2e/trader.spec.ts) | **Verify** — prod auth path TBD | Blocks if prod auth broken |
| 3 | HTX connect UI | [TraderWorkspace](../../components/trader/trader-workspace.tsx); e2e connect form | **Likely Present** | Phase 2 prod connect proof |
| 4 | Sync balances/positions/history | BP-2C UI + DEE-237/DEE-350 APIs | **Likely Present** | Phase 2 prod sync proof |
| 5 | Strategy selection | No trader UI picker; registry/admin/cron | **Gap candidate** | Document: AHR + cron acceptable for Org-0 MVP |
| 6 | Paper trading UI | Paper loop cron/CLI; DEE-337 AHR | **Gap candidate** | Criterion 8 via AHR; Step 6 UI optional for Org-0 |
| 7 | Live activation (admin-gated) | [admin/live-enable](../../app/(trader)/admin/live-enable/page.tsx); BP-7 CLI | **Likely Present** | Live order = BP-10 only |
| 8 | Monitoring | Partial trader UI; admin audit/billing | **Partial** | Enumerate in Phase 2 report |
| 9–12 | Billing/payment/status | BP-3/4 admin; watcher health | **Verify** Phase 2 | Operator Required config |
| Alerting | Critical → Telegram | BP-9 router; dry-run PASS | **Present (code)** | Criterion 15 Phase 2 |

---

## 4. MVP verification checklist (16 criteria = 14+2)

| # | Criterion | Phase | Phase 1 status | Evidence pointer |
|---|-----------|-------|----------------|------------------|
| 1 | WAIA Core auth + org + trader entitlement + audit | 1 map / 2 prod | **Mapped** | runtime-provisioning; admin audit UI |
| 2 | Tenant-isolation gate (ADR-0007) | 1 | **PASS** | 31 tenant-isolation test files; CI job |
| 3 | HTX spot read + encrypted creds + sync | 2 | **PENDING** | Connect API + sync handlers present |
| 4 | Market data ingestion + fail-closed | 2 | **PENDING** | MARKET_BRAIN_* operator required |
| 5 | MSV + CDE operational | 2 | **PENDING** | Telemetry + code present |
| 6 | Two strategies registered; CDE signal-only | 1 | **PASS** | DEE-337, registry tests |
| 7 | Risk + kill switches; reconciliation | 1 | **PASS** | CI tests; admin kill-switch UI |
| 8 | Paper loop + AHR validated | 1 | **PASS** | [DEE-337 closure report](DEE-337-P5-TWO-STRATEGY-AHR-CLOSURE-REPORT.md) |
| 9 | Signed validation-gate promotion (ADR-0010/11) | 1 | **PASS** | DEE-178; admin promotion UI read-only request |
| 10 | Reporting + HWM + 30% fee + manual gate | 2 | **PENDING** | Admin billing; ADR-0008 attestations |
| 11 | USDT payments + suspension lifecycle | 2 | **PENDING** | BP-3 evidence; watcher health |
| 12 | Org-0 live admin-gated; isolated host | 2 | **PENDING** | BP-7 runbook preconditions |
| 13 | Admin console complete | 1 | **PASS** | BP-8 PR #316; admin route tests |
| 14 | External live blocked (ADR-0009) | 1 | **PASS** | org allowlist tests; live path fail-closed |
| 15 | Live Telegram alert delivery | 2 | **PENDING** | `--send` drill + delivery telemetry |
| 16 | Production Configuration Inventory signed | 2 | **PENDING** | This document §12 operator sign-off |

**ADR cross-checks (Phase 1 code review):**

| ADR | Phase 1 | Notes |
|-----|---------|-------|
| 0007 | PASS | CI tenant-isolation; RLS migrations in repo |
| 0008 | PASS (code) | Invoice approve requires attestations |
| 0009 | PASS (code) | Org-0 only live path; external blocked |
| 0010 | PASS (code) | Promotion request CLI-only |
| 0011 | PASS (code) | Cooling-off on governed actions |

---

## 5. Health endpoints (code present; prod probes Phase 2)

| Route | Purpose | Phase 1 | Phase 2 evidence |
|-------|---------|---------|------------------|
| `/api/health/database` | Postgres connectivity | **Present** | PENDING HTTP 200 |
| `/api/health/payment-watcher` | Watcher staleness | **Present** | PENDING |
| `/api/health/settlement` | Settlement cron | **Present** | PENDING |
| `/api/health/settlement-reconciliation` | Reconciliation | **Present** | PENDING |
| `/api/health/alerting` | Telegram config | **Present** | PENDING `{configured:true}` |

---

## 6. Secret discipline scan (Phase 1)

| Check | Result |
|-------|--------|
| Secret values in this report | **NONE** |
| `.env` / `.dev.vars` committed | **NONE** (gitignored) |
| HTX/API tokens in repo grep | **NONE** found in tracked sources |
| Alert drill output | dry_run only; no tokens logged |
| wrangler.jsonc | Public Supabase URL + publishable anon key only (documented public vars) |

**Rule:** Any secret discovered in repo/logs during BP-9A → **FAIL** and rotate.

---

## 7. Gaps and blockers

| Gap | Classification | Blocks BP-10? |
|-----|----------------|---------------|
| Production secrets unprovisioned (§2) | Operator Required | **Yes** |
| Phase 1 human acceptance pending | Gate | **Yes** (Phase 2 blocked) |
| Live `--send` Telegram drill not run | Operator Required | **Yes** (criterion 15) |
| Execution host not provisioned | Operator Required | **Yes** |
| Steps 5–6 no trader UI | Gap candidate | **Informational** — AHR satisfies criterion 8 |
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

**Composer Phase 1 deliverables complete.** Operator review required before Phase 2.

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

## 10. Phase 2 operator provisioning checklist (human-only)

Perform in order. **Do not paste secret values into git, Linear, or this report.**

1. **Postgres:** Apply full migration chain to production Supabase; `wrangler secret put DATABASE_URL_POSTGRES`.
2. **Secrets Store:** Provision `AI_TRADER_MASTER_KEY` per [DEE-220](DEE-220-MASTER-KEY-RUNBOOK.md); uncomment binding in wrangler at deploy; set `WAIA_DEPLOYMENT_TIER=production`.
3. **Trader host:** Attach `trader.waia.life` custom domain; set redirect URLs per [AT-E1 checklist](AT-E1-S2-PR-OPERATOR-CHECKLIST.md).
4. **Org-0 identity:** Record Org-0 UUID in `WAIA_TRADER_ORG0_ORGANIZATION_ID`; grant platform `admin` to BP-10 operator; ensure `trader` entitlement.
5. **HTX Org-0:** Create Read+Trade-only API key; connect via trader UI; verify sync + permission metadata (no withdraw/transfer).
6. **Payment watcher:** Enable `WATCHER_ENABLED=1`; provision TronGrid/RPC secrets; verify `/api/health/payment-watcher`.
7. **Telegram:** Create dedicated Alerts Bot + forum topic; `wrangler secret put` all three `TELEGRAM_ALERTS_*`; run `pnpm trader:alert:drill --send`; confirm `/api/health/alerting` configured.
8. **Execution host:** Deploy health container per [DEE-339](DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md); set `WAIA_TRADER_EXECUTION_HOST_URL`; verify `/health`.
9. **Cron workers:** Enable `MARKET_BRAIN_*` and/or `PAPER_LOOP_*` per production policy.
10. **Architect decision:** Confirm `WAIA_CORE_ENFORCEMENT` posture for production.

---

## 11. Phase 2 evidence template (non-value proofs only)

After provisioning, record evidence in §2 **Evidence (Phase 2)** column using shapes only:

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
