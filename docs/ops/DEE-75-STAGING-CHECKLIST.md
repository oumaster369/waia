# DEE-75 — Staging execution checklist (operator)

Safe staging rollout for **Cloudflare Workers + Postgres** + Supabase auth, aligned with DEE-74 runtime contract and optional DEE-79 AI Gateway smoke.

**Authority:** [cloudflare-deploy.md](../cloudflare-deploy.md), [cloudflare-env-vars.md](../cloudflare-env-vars.md), [postgres-development.md](../postgres-development.md), [wrangler.jsonc](../../wrangler.jsonc), [`.dev.vars.example`](../../.dev.vars.example), [DEE-79 AI Gateway runbook](../migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md).

**Rules:** Do **not** paste secrets into Linear/tickets. Document **environment name + git SHA** in sign-off blocks only.

---

## 1. Preflight — inventory (fill in, no secret values)

### A. Staging endpoints & projects

| Item | Operator value (staging only) |
|------|-------------------------------|
| **Cloudflare Worker public origin** | `https://____________` (no trailing slash) — becomes `NEXT_PUBLIC_SITE_URL` |
| **Supabase project** (name or ref) | `____________` |
| **OAUTH_PUBLIC_BASE_URL** | Should match staging Worker HTTPS origin if OAuth used |

### B. Public vs secret variables (DEE-74 + Supabase)

| Variable | Public / secret | Where to set | Notes |
|----------|-----------------|--------------|--------|
| `NEXT_PUBLIC_SITE_URL` | Public | Cloudflare plain env | Exact Worker HTTPS origin |
| `WAIA_DB_BACKEND` | Plain (non-client) | Cloudflare plain env | Literal `postgres` |
| `DATABASE_URL_POSTGRES` | **Secret** | `wrangler secret put` or dashboard | Supabase **Transaction pooler** URI (typical port **6543**) |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Cloudflare plain env | Supabase Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (publishable) | Cloudflare plain env | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Wrangler / dashboard | Optional until server routes need it |
| `OAUTH_PUBLIC_BASE_URL` | Public-facing | Cloudflare | Align with staging origin |

### C. AI Gateway (optional — core platform smoke can skip)

| Variable | Secret? | Notes |
|----------|---------|--------|
| `WAIA_AI_GATEWAY_FOUNDATION` | Plain | Truthy when testing gateway |
| `WAIA_AI_PROVIDER` | Plain | `openai-compatible` for network egress; else `fake` |
| `WAIA_AI_OPENAI_API_KEY` | **Yes** | Server-only |
| `WAIA_AI_OPENAI_BASE_URL`, `WAIA_AI_OPENAI_MODEL`, `WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS` | Optional | Defaults in `.env.example` |

**Supabase dashboard (not Cloudflare):** Site URL, Redirect URLs, email provider — match staging origin. See [supabase-auth-postgres.md](../supabase-auth-postgres.md) and [DEE-59 checklist](DEE-59-SUPABASE-DASHBOARD-CHECKLIST.md).

---

## 2. Postgres — migration sequence (staging)

**Never** use `drizzle-kit push` for canonical staging (see [postgres-development.md](../postgres-development.md)).

From `waia-app/`, with **`DATABASE_URL_POSTGRES`** set to the **same** pooler URI the Worker will use:

```bash
pnpm db:postgres:auth-prelude
DATABASE_URL_POSTGRES="postgresql://…" pnpm db:migrate:postgres
```

On an **empty** database, auth prelude runs once (stub `auth.users` for FKs). See [scripts/postgres-validation/prelude-auth-stub.sql](../../scripts/postgres-validation/prelude-auth-stub.sql) and `db/migrations_postgres/`.

**Local engineer verification (optional):** `pnpm db:postgres:bootstrap` uses docker-compose validate Postgres; confirms scripts succeed **before** operators apply the same sequence to staging.

For a local **write-path smoke** after migrations: `DATABASE_URL_POSTGRES="postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate" pnpm db:smoke:postgres` (port **54329** from `docker-compose.postgres-validate.yml`; only if the validate container is up).

---

## 3. Cloudflare — env & secrets (operator)

1. `wrangler login` (first time).
2. Worker name **`waia-app`** must match [wrangler.jsonc](../../wrangler.jsonc) and `WORKER_SELF_REFERENCE`.

**Plain env:** set in dashboard or `wrangler vars` per project docs.

**Secrets:**

```bash
cd waia-app
wrangler secret put DATABASE_URL_POSTGRES
# Optional:
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put WAIA_AI_OPENAI_API_KEY
```

---

## 4. Deploy & smoke

### Pre-deploy (same revision as staging)

```bash
cd waia-app
pnpm lint && pnpm typecheck && pnpm test --run && pnpm build
pnpm cloudflare:build
```

Optional: `pnpm cloudflare:preview` with gitignored `.dev.vars` mirroring staging (see [cloudflare-deploy.md](../cloudflare-deploy.md)).

### Deploy

```bash
pnpm cloudflare:deploy
```

### Health

```bash
curl -sS "${NEXT_PUBLIC_SITE_URL}/api/health/database"
```

Expect **HTTP 200** and JSON `backend: "postgres"`, `ok: true` when DB is reachable.

### App user row (DEE-75 / Postgres)

On **`WAIA_DB_BACKEND=postgres`**, the app **upserts `public.users`** (id = Supabase user id) during **email sign-in / sign-up** and **lazily on authenticated requests** when Supabase session is valid (`syncAppUserRowFromSupabaseAuth` + session resolution). That satisfies the FK chain to `twin_profiles` before dashboard/twin/diary writes. **No manual `public.users` SQL** is required for normal staging smoke after this slice.

### Browser smoke (minimum)

| # | Check | Success |
|---|--------|---------|
| 1 | DB health | 200, `backend: postgres`, `ok: true` |
| 2 | Auth | Sign-in/up → session; no legacy-only failure on Workers |
| 3 | Dashboard | `/dashboard` authenticated |
| 4 | One PG write | e.g. `POST /api/dashboard/twin-dialogue/turn` or `POST /api/dashboard/diary/entries` — 200 and persisted |

---

## 5. Optional — DEE-79 live inference

If testing **live** AI Gateway on staging: set `WAIA_AI_*` per [DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md](../migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md) §3–4; smoke `twin_dialogue_turn`; complete **§9 sign-off** (environment, SHA, outcome, kill-switch drill).

**DEE-109** (prompt envelope implementation) is **separate** from gateway activation smoke — see plan DEE-75 §6.

---

## 6. Rollback & kill-switch

- **Code:** Redeploy previous Worker version or prior git SHA ([cloudflare-deploy.md](../cloudflare-deploy.md) rollback).
- **Secrets:** Reverting code **does not** revert Cloudflare secrets — snapshot **which** vars were set (names only) and Worker version id.
- **AI kill-switch:** Per DEE-79 §5 — unset or change `WAIA_AI_PROVIDER`; optionally `WAIA_AI_GATEWAY_FOUNDATION`.

**Rollback record (fill after deploy):**

| Field | Value |
|-------|--------|
| Worker version / deployment id | |
| Git SHA deployed | |
| Gateway enabled on staging? (yes/no) | |
| Kill-switch drill performed? (yes/no) | |

---

## 7. DEE-75 sign-off (no secrets)

| Item | Status |
|------|--------|
| Staging Worker URL recorded | ☐ |
| Supabase redirects aligned | ☐ |
| Prelude + migrations applied to staging PG | ☐ |
| Cloudflare env + secrets set | ☐ |
| `GET /api/health/database` OK | ☐ |
| Auth + dashboard + one write OK | ☐ |
| Optional DEE-79 §9 (if inference tested) | ☐ |

**Operator:** ______________ **Date:** ______________
