# WAIA operator runbook — Supabase Auth + Postgres placeholders (templates only)

**Audience:** Humans configuring WAIA deployments while Supabase Auth and Postgres migrations are phased in.

**Issue:** Prepared during DEE-61 (environment templates). This document **does not** imply that production code currently reads every variable listed below.

---

## Goals

1. Separate **browser-safe** (`NEXT_PUBLIC_*`) keys from **server-only** secrets.
2. Align Cloudflare Workers secrets with `.dev.vars.example` ([`.dev.vars.example`](../.dev.vars.example)).
3. Highlight **dangerous keys** (`SUPABASE_SERVICE_ROLE_KEY`) that must stay off the client.

---

## Legend

| Label | Meaning |
| ----- | ------- |
| **PUBLIC** | May appear in browser bundles via `NEXT_PUBLIC_*`. Still avoid leaking staging URLs publicly if they map to sensitive data. |
| **SECRET** | Server-side only (`wrangler secret put`, Cloudflare encrypted env). Never prefix with `NEXT_PUBLIC_*`. |

**Hard rules**

- **`SUPABASE_SERVICE_ROLE_KEY`** — SECRET — **never** expose to browser or SPA bundles; bypasses Row Level Security.
- **`OPENAI_API_KEY`** — SECRET — **never** expose to browser/client code; reserve for server routes or Worker-only calls.

---

## Supabase Auth (dashboard checklist)

1. Create a Supabase project; copy **Project URL** and **anon** / **service_role** keys only into your private env store.
2. **Site URL** — set to production origin (e.g. `https://your-worker.example`).
3. **Redirect URLs** — include every environment that performs auth redirects (local dev, staging, production). Exact paths depend on future Next/Supabase SSR wiring.
4. Decide **email confirmation** behavior (on vs off) before production launch; not encoded in this repo’s templates.

PUBLIC keys typically used with browser Supabase clients (when implemented):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only:

- `SUPABASE_SERVICE_ROLE_KEY`

---

## Postgres connection from Cloudflare Workers

**Not decided in DEE-61** — pick one operational path and document it here when engineering lands the migration:

| Option | Summary |
| ------ | ------- |
| **Supabase pooler (transaction mode)** | `DATABASE_URL`-style URI (often port **6543**) friendly to many serverless egress paths. Still a **SECRET**. |
| **Cloudflare Hyperdrive** | Pooling in front of Postgres; Worker reads a binding or env produced by Hyperdrive. Reduces connection churn. |

Until Postgres is wired into [`db/client.ts`](../db/client.ts), `DATABASE_URL` in Workers **may not** satisfy runtime needs; see [cloudflare-deploy.md](cloudflare-deploy.md).

---

## Local Postgres migration validation (DEE-65)

Use an **empty** Postgres instance — **never** `waia-prod`, staging Supabase, or any production-like `DATABASE_URL`. This path only verifies that Drizzle Postgres migrations apply cleanly against a disposable database.

### 1. Start empty Postgres (Docker)

Either run your own Postgres 16 container, or use the optional compose helper at the repo root:

```bash
docker compose -f docker-compose.postgres-validate.yml up -d postgres-validate
```

Wait until the container is healthy (`pg_isready`).

Example connection (matches the compose defaults):

```bash
export DATABASE_URL_POSTGRES="postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate"
```

### 2. Apply the auth prelude (stub)

Bare Postgres has no Supabase **`auth`** schema. Our migration `0001_auth_users_fk.sql` references `auth.users(id)`. Apply the minimal stub **before** Drizzle migrate:

```bash
psql "$DATABASE_URL_POSTGRES" -v ON_ERROR_STOP=1 \
  -f scripts/postgres-validation/prelude-auth-stub.sql
```

### 3. Run Postgres migrations

Uses [`drizzle.postgres.config.ts`](../drizzle.postgres.config.ts) and `DATABASE_URL_POSTGRES`:

```bash
pnpm db:migrate:postgres
```

### 4. Optional quick assertions (`psql`)

```sql
\d public.users
\d auth.users
```

Confirm `users_id_fk_auth_users` exists on `public.users` (FK to `auth.users`).

### 5. Teardown

```bash
docker compose -f docker-compose.postgres-validate.yml down -v
```

Unset `DATABASE_URL_POSTGRES` in your shell if you no longer need it.

---

## OpenAI direct API

Optional **SECRET** worker var:

- `OPENAI_API_KEY`

No **AI Gateway** or OpenNext-specific AI binding is documented in DEE-61; add rows to [cloudflare-env-vars.md](cloudflare-env-vars.md) when GA.

---

## Related files

- [docker-compose.postgres-validate.yml](../docker-compose.postgres-validate.yml) (optional local validator)
- [scripts/postgres-validation/prelude-auth-stub.sql](../scripts/postgres-validation/prelude-auth-stub.sql)
- [.env.example](../.env.example)
- [.dev.vars.example](../.dev.vars.example)
- [cloudflare-env-vars.md](cloudflare-env-vars.md)
- [cloudflare-deploy.md](cloudflare-deploy.md)
