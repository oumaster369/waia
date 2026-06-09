# WAIA Infrastructure Parity Audit — 2026

**Status:** Read-only audit (no code, deploy, Linear, or git changes).  
**Date:** 2026-06-09  
**Context:** Workstation recovery complete. GitHub, Wrangler, OpenAI, and Supabase access restored. Local dev runs on SQLite with fake AI provider. Production Worker (`waia-app` → `waia.life`) uses Postgres + real OpenAI-compatible inference + Supabase Auth (email/password only).

**Related:** [`WAIA-RECOVERY-2026.md`](WAIA-RECOVERY-2026.md) (recovery snapshot), [`../cloudflare-env-vars.md`](../cloudflare-env-vars.md) (production inventory), [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) (Postgres migration program).

---

## Executive Summary

WAIA’s **local development environment is intentionally simpler than production**. A new developer can clone, install, migrate SQLite, and run `pnpm dev` within an hour **without any secrets** — but that path does **not** match production behavior for auth, database, or Twin dialogue AI.

| Layer | Local default (`pnpm dev`) | Production (`waia-app` Worker) |
|-------|---------------------------|--------------------------------|
| **Database** | SQLite (`DATABASE_URL=file:./.data/waia.db`) | Supabase Postgres via `WAIA_DB_BACKEND=postgres` + `DATABASE_URL_POSTGRES` |
| **Auth** | SQLite session cookie (`users.password_hash`) | Supabase Auth email/password (`NEXT_PUBLIC_SUPABASE_*` + SSR cookies) |
| **Twin AI** | Legacy inline stub or fake gateway (no network) | Real OpenAI-compatible API (`WAIA_AI_*` + `WAIA_AI_OPENAI_API_KEY`) |
| **OAuth** | Disabled (env unset → UI hides providers) | Disabled (same; Google/Telegram/Apple not configured) |

**What still needs restoration or synchronization:**

1. **Populate local secrets** for optional parity tiers (real AI, Postgres, Supabase Auth) — values live only in provider dashboards, not git.
2. **Reconcile documentation drift** — `.dev.vars.example` lags `wrangler.jsonc` on AI gateway vars; several Worker secrets are **not read by application code**.
3. **Publish a single “Getting started” runbook** — README points to governance docs but lacks a step-by-step local bootstrap.
4. **Decide auth parity for local dev** — uncommenting Supabase public vars switches sign-in to Supabase without documenting the full flow.
5. **GitHub Actions secrets** — empty; Cloudflare preview deploys skip.

**Bottom line:** Infrastructure is **operational** for production and **functional** for local MVP development, but **full parity requires deliberate env configuration** that is under-documented and secret-dependent.

---

## 1. OpenAI Integration Audit

### 1.1 Environment variables read by application code

All Twin dialogue network inference flows through `lib/ai-gateway/*`. The following `process.env` keys are **actually referenced in production TypeScript** (excluding tests):

| Variable | File(s) | Required for real AI | Default / behavior |
|----------|---------|---------------------|-------------------|
| `WAIA_AI_GATEWAY_FOUNDATION` | `lib/ai-gateway/config.ts` | Yes | Unset → gateway off; legacy inline stub path |
| `WAIA_AI_PROVIDER` | `lib/ai-gateway/provider-selector.ts` | Yes | Unset or unknown → `fake` (no egress) |
| `WAIA_AI_OPENAI_API_KEY` | `lib/ai-gateway/openai-compatible-completion-provider.ts` | **Yes** when provider is `openai-compatible` | Missing → provider fails; route falls back to stub |
| `WAIA_AI_OPENAI_BASE_URL` | same | No | Defaults to `https://api.openai.com` |
| `WAIA_AI_OPENAI_MODEL` | same | No | Code default if unset (see provider) |
| `WAIA_AI_OPENAI_TEMPERATURE` | same | No | Unset → `0`; omitted from API body for reasoning models |
| `WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS` | same | No | Default 15000 ms |
| `WAIA_AI_OPENAI_REASONING_MIN_COMPLETION_TOKENS` | same | No | Default 4096 floor for reasoning models |
| `WAIA_AI_OPENAI_PARSE_DIAGNOSTICS` | same | No | Opt-in stdout JSON on parse failures |

Related (Twin dialogue, not OpenAI SDK):

| Variable | File | Production |
|----------|------|------------|
| `WAIA_TWIN_DIALOGUE_CONTINUITY` | `lib/twin-dialogue/dialogue-continuity-config.ts` | `replay_v1` in `wrangler.jsonc` |
| `WAIA_READINESS_WRITER` | `lib/readiness/readiness-writer-config.ts` | Unset in production vars |

### 1.2 Legacy `OPENAI_API_KEY`

**Finding:** `OPENAI_API_KEY` is **not referenced anywhere in application TypeScript**. It appears only in:

- Documentation (`docs/cloudflare-env-vars.md`, `docs/supabase-auth-postgres.md`, migration runbooks)
- `.env.example` / `.dev.vars.example` (commented, marked deferred/legacy)
- Production Worker secret list (verified present during recovery — see [`WAIA-RECOVERY-2026.md`](WAIA-RECOVERY-2026.md))

**Conclusion:** Twin gateway code reads **`WAIA_AI_OPENAI_API_KEY` only**. `OPENAI_API_KEY` on the Worker is **orphaned from the current codebase** — retained per Architect charter (DEE-128 release notes: “do not remove without sign-off”), not because runtime reads it.

### 1.3 Production OpenAI requirements

For live Twin dialogue on production, **all** of the following must hold:

```
WAIA_AI_GATEWAY_FOUNDATION=1          # plain var — committed in wrangler.jsonc
WAIA_AI_PROVIDER=openai-compatible    # plain var — committed in wrangler.jsonc
WAIA_AI_OPENAI_API_KEY=<secret>       # wrangler secret — REQUIRED
```

Optional plain vars already set in `wrangler.jsonc`: `WAIA_AI_OPENAI_MODEL=gpt-5.5`, `WAIA_AI_OPENAI_TEMPERATURE=0`, `WAIA_AI_OPENAI_PARSE_DIAGNOSTICS=0`, `WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1`.

### 1.4 Local env vars for real Twin conversations

Add to **`.env.local`** (Node `pnpm dev`) — minimum block:

```bash
WAIA_AI_GATEWAY_FOUNDATION=1
WAIA_AI_PROVIDER=openai-compatible
WAIA_AI_OPENAI_API_KEY=<your-openai-key>
```

Recommended optional tuning (match production):

```bash
WAIA_AI_OPENAI_MODEL=gpt-5.5
WAIA_AI_OPENAI_TEMPERATURE=0
WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1
```

For **Workers preview** (`pnpm cloudflare:preview`), mirror the same keys in **`.dev.vars`** plus Postgres vars (section 3).

**Classification:**

| Finding | Severity |
|---------|----------|
| `WAIA_AI_OPENAI_API_KEY` is the sole runtime key for Twin AI | **CRITICAL** (for real dialogue) |
| `OPENAI_API_KEY` unused by code but present on Worker | **IMPORTANT** (documentation/ops confusion) |
| Local defaults use fake/stub — no secret required for basic dev | **OPTIONAL** (by design) |

---

## 2. Supabase Audit

### 2.1 Variables referenced in code

| Variable | Used? | Where | Purpose |
|----------|-------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | `lib/supabase/config.ts`, `server.ts`, `client.ts` | Gate + SSR/browser client origin |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | same | Supabase Auth SSR (anon/publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | — | **Zero TypeScript references** |
| `DATABASE_URL_POSTGRES` | **Yes** | `db/runtime-backend.ts`, `db/postgres-client.ts` | Postgres driver URI (Supabase-hosted DB, not Supabase JS client) |

Production commits Supabase **public** vars in `wrangler.jsonc`:

- `NEXT_PUBLIC_SUPABASE_URL=https://wdsnuvldxyrkqcjxvuxp.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…` (publishable key)

Worker secret `SUPABASE_SERVICE_ROLE_KEY` is listed on `waia-app` but **never read by the application**.

### 2.2 Supabase features — active vs inactive

| Supabase feature | Status | Evidence |
|------------------|--------|----------|
| **Auth (email/password)** | **Active in production** | `app/api/auth/sign-in/route.ts`, `sign-up/route.ts`, `sign-out/route.ts`; `lib/auth/session-user.ts` when `isSupabaseAuthConfigured()` |
| **Postgres (database)** | **Active in production** | Via `DATABASE_URL_POSTGRES` + Drizzle; not via `@supabase/supabase-js` PostgREST |
| **Storage** | **Not used** | No imports or API calls |
| **Realtime** | **Not used** | No imports or subscriptions |
| **Edge Functions** | **Not used** | No references |
| **RLS** | **Not enforced by app** | `docs/postgres-development.md`: “RLS / Supabase auth — gaps documented in schema.postgres.ts”; app uses service connection string, not user-scoped Supabase client for data |
| **Browser Supabase client** | **Prepared only** | `lib/supabase/client.ts` exports `createSupabaseBrowserClient()` — **no production caller** |

### 2.3 Auth path selection

`isSupabaseAuthConfigured()` returns true when **both** public Supabase vars are non-empty.

- **Production:** Supabase Auth path → `signInWithPassword` / `signUp` → Supabase session cookies → `getUser()` in `session-user.ts` → sync app `users` row in Postgres.
- **Local default (`.env.local` with Supabase vars commented):** SQLite path → bcrypt password in `users.password_hash` → `WAIA_SESSION_COOKIE` opaque session id.

This is a **material behavioral difference**, not just a storage backend difference.

### 2.4 Secrets required for full Supabase parity locally

| Tier | Variables | Notes |
|------|-----------|-------|
| **Auth parity** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public values match `wrangler.jsonc`; enable Supabase sign-in locally |
| **Data parity** | `WAIA_DB_BACKEND=postgres`, `DATABASE_URL_POSTGRES` | Supabase transaction pooler URI (port 6543); run `pnpm db:migrate:postgres` against project DB |
| **Service role** | `SUPABASE_SERVICE_ROLE_KEY` | **Not required by current code** — only documented for future admin/RLS-bypass tooling |

**Classification:**

| Finding | Severity |
|---------|----------|
| Supabase Auth is production auth (email/password) | **CRITICAL** (for prod understanding) |
| `SUPABASE_SERVICE_ROLE_KEY` on Worker but unused in code | **IMPORTANT** (secret hygiene / doc drift) |
| Local dev defaults skip Supabase → different auth mechanism | **IMPORTANT** (onboarding confusion) |
| Storage / Realtime / Edge Functions / RLS unused | **OPTIONAL** (informational) |

---

## 3. Database Architecture Audit

### 3.1 Three-store model

```
┌─────────────────────────────────────────────────────────────────┐
│                        WAIA runtime DB                           │
├─────────────────┬───────────────────────┬───────────────────────┤
│  Local SQLite   │  Supabase Postgres    │  Production Worker    │
│  (.data/waia.db)│  (hosted)             │  (waia-app)           │
├─────────────────┼───────────────────────┼───────────────────────┤
│  pnpm dev       │  DATABASE_URL_POSTGRES│  WAIA_DB_BACKEND=     │
│  default        │  when WAIA_DB_BACKEND │  postgres + secret    │
│                 │  =postgres            │  DATABASE_URL_POSTGRES│
└─────────────────┴───────────────────────┴───────────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
   getDb() /            postgres.js +           getWaiaRuntimeDb()
   getWaiaRuntimeDb()    Drizzle schema.postgres  → postgres branch
   → sqlite branch      (same schema family)     (per-request client)
```

**Resolver:** `getWaiaRuntimeDb()` in `db/waia-runtime-db.ts` reads `WAIA_DB_BACKEND` via `db/runtime-backend.ts`. Unset or `sqlite` → SQLite. `postgres` → requires non-empty `DATABASE_URL_POSTGRES`.

**Dashboard / Twin API routes** (readiness, dialogue, diary, engine, etc.) use `getWaiaRuntimeDb()` — **Postgres-aware**.

**Auth routes** (`sign-in`, `sign-up`, `sign-out`) still call `getDb()` on the SQLite fallback path. On production with Supabase Auth, sign-in/up bypass SQLite; **sign-out still invokes `getDb()`** if a legacy session cookie exists — a latent Workers/SQLite incompatibility (see risks).

### 3.2 Which database when

| Environment | Config | Database used for dashboard/Twin |
|-------------|--------|----------------------------------|
| `pnpm dev` (default) | `DATABASE_URL=file:./.data/waia.db`, no `WAIA_DB_BACKEND` | **SQLite** |
| `pnpm dev` + Postgres env | `WAIA_DB_BACKEND=postgres`, `DATABASE_URL_POSTGRES=…` | **Postgres** |
| `pnpm cloudflare:preview` | `.dev.vars` with postgres block | **Postgres** (recommended) |
| Production Worker | `wrangler.jsonc` + secrets | **Postgres** |

Auth data:

| Environment | Identity store | App `users` row |
|-------------|---------------|-----------------|
| Local SQLite auth | SQLite `users` + `sessions` | Same DB |
| Local/Prod Supabase auth | Supabase `auth.users` | Synced to SQLite or Postgres `public.users` via `syncAppUserRowFromSupabaseAuth*` |

### 3.3 Migration tracks and drift

| Track | Directory | Migrations | Dialect |
|-------|-----------|------------|---------|
| SQLite | `db/migrations/` | 7 (`0000`–`0006`) | SQLite |
| Postgres | `db/migrations_postgres/` | 3 (`0000`–`0002`) | PostgreSQL |

- **Separate schema sources:** `db/schema.ts` (SQLite) vs `db/schema.postgres.ts` (Postgres).
- **Postgres migrations** include `auth.users` FK alignment stub; bare Postgres requires `pnpm db:postgres:auth-prelude` before migrate.
- **Postgres `0002_useful_machine_man.sql`** adds `waia_postgres_tx_validation` — validation/CI table, not a SQLite counterpart.
- **Program status:** DEE-64 tracker documents staged migration; dashboard routes are Postgres-capable when env-gated; auth/OAuth routes remain SQLite-`getDb()` for legacy paths.

**Drift assessment:** Parallel migration histories are **expected** under DEE-64 — not accidental skew. Operators must run **both** `pnpm db:migrate` (SQLite local) and `DATABASE_URL_POSTGRES=… pnpm db:migrate:postgres` (Supabase/production) on their respective targets. There is **no single unified migration command**.

**Worker secret `DATABASE_URL`:** Listed on production Worker. Application SQLite path reads `DATABASE_URL` via `db/client.ts`, but production sets `WAIA_DB_BACKEND=postgres` for runtime routes. This secret is likely **legacy / unused at runtime** on the current production config (similar to `OPENAI_API_KEY`).

**Classification:**

| Finding | Severity |
|---------|----------|
| Production uses Postgres; local default uses SQLite | **IMPORTANT** (intentional; document clearly) |
| Dual migration tracks require separate apply commands | **IMPORTANT** |
| Auth routes still touch SQLite `getDb()` on some paths | **IMPORTANT** (Workers edge case) |
| `DATABASE_URL` Worker secret possibly obsolete | **OPTIONAL** |

---

## 4. Environment Parity Audit

Sources compared: `.env.example`, `.env.local`, `.dev.vars.example`, `.dev.vars`, `wrangler.jsonc`.

### 4.1 Matrix — production vs templates vs local restored files

| Variable | wrangler.jsonc | .env.example | .dev.vars.example | .env.local (restored) | .dev.vars (restored) |
|----------|---------------|--------------|-------------------|----------------------|---------------------|
| `NEXT_PUBLIC_SITE_URL` | `https://waia.life` | localhost | `127.0.0.1:3000` | localhost ✓ | `127.0.0.1:3000` ✓ |
| `OAUTH_PUBLIC_BASE_URL` | `https://waia.life` | localhost | `127.0.0.1:3000` | localhost ✓ | `127.0.0.1:3000` ✓ |
| `WAIA_DB_BACKEND` | `postgres` | commented | commented | commented | commented |
| `DATABASE_URL` | secret (legacy?) | SQLite path | SQLite path | SQLite path ✓ | SQLite path ✓ |
| `DATABASE_URL_POSTGRES` | secret | commented | commented | commented placeholder | commented placeholder |
| `NEXT_PUBLIC_SUPABASE_*` | **set (committed)** | commented | commented | commented | commented |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | commented | commented | commented placeholder | commented placeholder |
| `WAIA_AI_GATEWAY_FOUNDATION` | `1` | commented | **missing** | commented | commented |
| `WAIA_AI_PROVIDER` | `openai-compatible` | commented | **missing** | commented | commented |
| `WAIA_AI_OPENAI_MODEL` | `gpt-5.5` | commented | **missing** | commented (gpt-4o-mini) | **missing** |
| `WAIA_AI_OPENAI_TEMPERATURE` | `0` | commented | **missing** | commented | **missing** |
| `WAIA_AI_OPENAI_PARSE_DIAGNOSTICS` | `0` | commented | **missing** | **missing** | **missing** |
| `WAIA_TWIN_DIALOGUE_CONTINUITY` | `replay_v1` | in .env.example | **missing** | commented | **missing** |
| `WAIA_AI_OPENAI_API_KEY` | secret | commented | **missing** (only legacy OPENAI) | placeholder | placeholder |
| `OPENAI_API_KEY` | secret (legacy) | commented deferred | commented legacy | **missing** | **missing** |
| `AUTH_SESSION_MAX_AGE_SECONDS` | unset (default 30d) | documented | optional comment | set ✓ | **missing** |
| `NEXTJS_ENV` | n/a | n/a | `development` | n/a | **missing** |
| OAuth provider vars | unset | documented | n/a | commented placeholders | n/a |

### 4.2 Missing variables (should be documented)

| Gap | Recommendation |
|-----|----------------|
| `.dev.vars.example` lacks full `WAIA_AI_*` block present in `wrangler.jsonc` | Add mirror of production AI plain vars + secret placeholders |
| No “local parity profiles” doc (SQLite-only vs Postgres+Supabase+AI) | Single runbook section with three tiers |
| `NEXTJS_ENV` missing from restored `.dev.vars` | Add for OpenNext preview consistency |
| Supabase public vars in `wrangler.jsonc` but commented in local templates | Document that these are **safe to commit** (publishable) and required for auth parity |

### 4.3 Obsolete or misleading variables

| Variable | Issue |
|----------|-------|
| `OPENAI_API_KEY` | Documented and stored on Worker; **not read by Twin gateway code** |
| `SUPABASE_SERVICE_ROLE_KEY` | Documented as critical; **zero code references** |
| `DATABASE_URL` (Worker secret) | Likely unused when `WAIA_DB_BACKEND=postgres`; SQLite path not viable on Workers |
| `.env.example` line “production remains SQLite unless WAIA_DB_BACKEND” | **Stale** — production `wrangler.jsonc` sets `postgres` |

### 4.4 Variables needing clearer documentation

| Variable | Clarification needed |
|----------|---------------------|
| `WAIA_AI_OPENAI_API_KEY` vs `OPENAI_API_KEY` | Only the `WAIA_AI_*` namespaced key is active; legacy key is ops debt |
| `NEXT_PUBLIC_SUPABASE_*` | Enabling locally **switches auth mechanism**, not just database |
| `DATABASE_URL` vs `DATABASE_URL_POSTGRES` | First is SQLite file path; second is Postgres URI — never interchangeable |
| `WAIA_PG_INTEGRATION` | Opt-in for 38 integration tests; requires Docker Postgres |
| `pnpm dev` vs `pnpm cloudflare:preview` | Node dev ≠ Worker runtime; preview needs `.dev.vars` + Postgres |

---

## 5. Production Readiness Check — New Developer in One Hour

### 5.1 What works today (no secrets)

1. Clone repo, install Node 22 + pnpm 10.
2. `pnpm install --frozen-lockfile`
3. Copy `.env.example` → `.env.local` (defaults suffice).
4. `pnpm db:migrate` → `.data/waia.db`
5. `pnpm dev` → sign up with email/password (SQLite auth), use dashboard with **stub/fake Twin dialogue**.
6. `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` — validation canon green.

**Verdict:** **Basic productivity achievable in ~1 hour** for UI/feature work on SQLite.

### 5.2 What blocks full production parity in one hour

| Blocker | Why | Severity |
|---------|-----|----------|
| No consolidated onboarding runbook in README | Scattered across 82 docs files; README is a pointer hub only | **CRITICAL** |
| Secret values not in repo | OpenAI key, Postgres pooler URI, optional service role — require dashboard access | **CRITICAL** |
| Local auth ≠ production auth by default | Supabase vars commented locally; different session mechanism | **IMPORTANT** |
| `.dev.vars.example` incomplete vs `wrangler.jsonc` | Workers preview parity not copy-paste obvious | **IMPORTANT** |
| Dual DB migration paths | New dev may not know Postgres migrate is separate | **IMPORTANT** |
| GitHub Actions secrets empty | PR preview Workers deploy skipped | **IMPORTANT** |
| Legacy/unused Worker secrets | `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, possibly `DATABASE_URL` | **OPTIONAL** |
| Postgres integration tests opt-in | Docker + `WAIA_PG_INTEGRATION=1` | **OPTIONAL** |
| OAuth env vars documented but inactive | Noise for onboarding | **OPTIONAL** |

---

## Findings Summary (by severity)

### CRITICAL

1. **Twin AI production key is `WAIA_AI_OPENAI_API_KEY` only** — must be set for real dialogue; local default intentionally omits it.
2. **Production auth is Supabase email/password** when public Supabase vars are set; local default uses SQLite sessions — same UI, different backend.
3. **No single onboarding runbook** — new developers lack a ≤1-hour path documented in one place.
4. **Secrets are external** — full parity impossible without human-provided values from OpenAI + Supabase dashboards.

### IMPORTANT

5. **`OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exist on Worker but are unread by application code** — document as legacy/reserved or remove via chartered migration.
6. **`.dev.vars.example` missing `WAIA_AI_*` plain vars** that `wrangler.jsonc` commits — preview parity gap.
7. **`.env.example` stale claim** that production remains SQLite by default — contradicts `wrangler.jsonc`.
8. **Dual migration tracks** (7 SQLite / 3 Postgres) — operators must know which to run where.
9. **GitHub Actions Cloudflare secrets empty** — preview deploy path broken until restored.
10. **Auth/sign-out may call `getDb()` on Workers** when legacy cookie present — latent SQLite-on-Workers hazard.

### OPTIONAL

11. **Supabase Storage, Realtime, Edge Functions, RLS** — not used; Postgres accessed via Drizzle + connection string.
12. **`createSupabaseBrowserClient()`** — exported but unused; client-side auth flows not wired.
13. **OAuth provider env vars** — present in templates; inactive per operator verification.
14. **`DATABASE_URL` Worker secret** — likely redundant under Postgres backend.
15. **Postgres integration tests** — optional Docker workflow for backend contributors.

---

## Recovery Actions

Ordered by impact. **Documentation and ops only** — no code changes in this audit.

| # | Action | Owner | Unblocks |
|---|--------|-------|----------|
| 1 | **Create `docs/GETTING-STARTED.md`** (or extend README): clone → install → migrate → dev → optional parity tiers (AI / Postgres / Supabase Auth) | Human + doc PR | 1-hour onboarding |
| 2 | **Sync `.dev.vars.example`** with `wrangler.jsonc` plain vars (`WAIA_AI_*`, `WAIA_TWIN_DIALOGUE_CONTINUITY`, Supabase public vars) | Doc PR | Workers preview parity |
| 3 | **Fix `.env.example` stale Postgres note** — state production uses `WAIA_DB_BACKEND=postgres` | Doc PR | Confusion reduction |
| 4 | **Annotate `docs/cloudflare-env-vars.md`** — mark `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Worker) as “present on Worker / not read by app” until chartered removal | Doc PR | Secret hygiene |
| 5 | **Populate local `.env.local`** — uncomment Supabase public vars + AI block + user’s OpenAI key for real dialogue testing | Operator | Local AI parity |
| 6 | **Populate `DATABASE_URL_POSTGRES`** in `.env.local` or `.dev.vars`** — Supabase transaction pooler URI; run `pnpm db:migrate:postgres` | Operator | Local Postgres parity |
| 7 | **Restore GitHub Actions secrets** — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` if PR preview deploys needed | Operator | CI preview Workers |
| 8 | **Supabase dashboard** — confirm Site URL / redirect URLs include `https://waia.life` and local origins if testing auth locally | Operator | Auth redirects |
| 9 | **Charter review** — decide fate of unused Worker secrets (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) | Architect | Long-term ops clarity |
| 10 | **Link this audit** from `docs/waia-governance/README.md` and `WAIA-OPERATING-MEMORY.md` | Doc PR | Discoverability |

---

## Remaining Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Developer tests against SQLite while production runs Postgres | High | Medium — subtle persistence/UUID/FK differences | Document tier-2 Postgres local profile; run integration tests before backend merges |
| Local Supabase Auth enabled without Postgres sync | Medium | High — auth user id not in app DB | Enable both Supabase vars **and** `WAIA_DB_BACKEND=postgres` together for auth parity |
| Unused Worker secrets rotated incorrectly | Low | Low — no runtime effect today | Charter before removal; document non-use |
| `sign-out` → `getDb()` on Worker with legacy cookie | Low | Medium — runtime error | Track as backend issue; avoid setting legacy session cookie in Supabase-only prod |
| Migration drift between `schema.postgres.ts` and applied Supabase DB | Medium | High — deploy failures | Run `pnpm db:migrate:postgres` against staging before prod; DEE-64 tracker |
| OpenAI model `gpt-5.5` availability/cost | Medium | Medium — dialogue failures | Monitor `ai_gateway_provider_outcome` telemetry; runbook DEE-95g |
| GitHub preview deploy disabled | Certain | Low — manual preview only | Restore Actions secrets or use local `cloudflare:preview` |

---

## Recommended Next Step

**Single highest-leverage action:** Author **`docs/GETTING-STARTED.md`** with three explicit profiles:

| Profile | Purpose | Required secrets |
|---------|---------|------------------|
| **A — Default local** | Feature/UI work, fake Twin dialogue | None (current `.env.local` defaults) |
| **B — Real AI local** | Exercise OpenAI-compatible Twin dialogue | `WAIA_AI_OPENAI_API_KEY` + gateway vars |
| **C — Production parity** | Auth + DB + AI match `waia.life` | Profile B + Supabase public vars + `DATABASE_URL_POSTGRES` + `WAIA_DB_BACKEND=postgres` |

Link Profile C to `pnpm cloudflare:preview` + `.dev.vars` for Worker-runtime verification (`GET /api/health/database` → `{"backend":"postgres","ok":true}`).

**Second action:** Open a small documentation PR (no application code) to sync `.dev.vars.example`, fix `.env.example` stale wording, and link this audit from the governance index.

---

## Appendix A — Code reference map

| Concern | Primary files |
|---------|---------------|
| AI gateway | `lib/ai-gateway/config.ts`, `provider-selector.ts`, `openai-compatible-completion-provider.ts` |
| DB backend selection | `db/runtime-backend.ts`, `db/waia-runtime-db.ts`, `db/client.ts`, `db/postgres-client.ts` |
| Supabase Auth | `lib/supabase/config.ts`, `server.ts`, `lib/auth/session-user.ts`, `app/api/auth/sign-in/route.ts` |
| Production Worker config | `wrangler.jsonc` |
| Env templates | `.env.example`, `.dev.vars.example` |

## Appendix B — Production Worker secrets (names only, 2026-06-09)

Verified present on `waia-app`:

- `DATABASE_URL`
- `DATABASE_URL_POSTGRES`
- `OPENAI_API_KEY` *(legacy — not read by app)*
- `SUPABASE_SERVICE_ROLE_KEY` *(not read by app)*
- `WAIA_AI_OPENAI_API_KEY` *(active for Twin AI)*

## Appendix C — Audit method

- Static analysis: `process.env` / env var grep across `**/*.{ts,tsx}`
- Config comparison: `.env.example`, `.env.local`, `.dev.vars.example`, `.dev.vars`, `wrangler.jsonc`
- Architecture docs: DEE-64 tracker, `cloudflare-env-vars.md`, `postgres-development.md`, `WAIA-RECOVERY-2026.md`
- Operator-provided context: workstation recovery verification (GitHub, Wrangler, OpenAI, Supabase restored; OAuth inactive; email/password only)

**No live deploy, secret values, or production DB queries were performed during this audit.**
