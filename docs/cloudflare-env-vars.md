# Cloudflare / Workers environment variables (WAIA MVP)

Inventory for deploying `waia-app` on **Cloudflare Workers** via **OpenNext** (`@opennextjs/cloudflare`).  
**Never commit** real secrets or production `.dev.vars`. Use the Cloudflare dashboard or `wrangler secret put` for sensitive values.

See also: [cloudflare-deploy.md](cloudflare-deploy.md) (commands, limitations), [supabase-auth-postgres.md](supabase-auth-postgres.md) (Supabase + Postgres operator notes, DEE-61).

---

## Legend

| Symbol | Meaning |
|--------|---------|
| **Public** | Safe to expose to the browser when the variable is intended for client bundles (`NEXT_PUBLIC_*` or publishable keys). |
| **Secret** | Server-only; **Wrangler secrets** or **encrypted env** in the dashboard. **Never** prefix with `NEXT_PUBLIC_*`. |

**Critical (DEE-61)**

- **`SUPABASE_SERVICE_ROLE_KEY`** — Secret — **never** exposed to browser or client bundles; bypasses Row Level Security.
- **`OPENAI_API_KEY`** — Secret — **never** exposed to browser or client code.

Wrangler local preview uses [`.dev.vars`](https://developers.cloudflare.com/workers/testing/local-development/) (gitignored). Copy from [`.dev.vars.example`](../.dev.vars.example) using **placeholder names only**.

---

## OpenNext / Next.js (Workers runtime)

| Variable | Required | Role | Local dev | Cloudflare |
|----------|----------|------|-----------|------------|
| `NEXTJS_ENV` | Optional | Which Next `.env*` files load in Workers preview (OpenNext). Often `development` locally. | `development` in `.dev.vars` | Usually omit (production) |
| `NODE_ENV` | Automatic | `production` in Workers when deployed. Affects cookie `Secure` ([cookie-response.ts](../lib/auth/cookie-response.ts)). | `development` | Set by platform |

---

## Public site URL

| Variable | Required | Role | Local dev | Cloudflare |
|----------|----------|------|-----------|------------|
| `NEXT_PUBLIC_SITE_URL` | Yes | Public site origin (no trailing slash). | `http://127.0.0.1:3000` | `https://your-worker-host` |

---

## Supabase Auth (planned)

These variables document the **future** SSR / Workers integration. Until code reads them, omit or set placeholders only.

| Variable | Public / Secret | Role | Cloudflare |
|----------|-----------------|------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase REST origin (HTTPS project URL). | Plain env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anonymous / publishable key for browser-safe clients. | Plain env |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Admin privilege; **must not** ship to browser. | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` |

Redirect URLs and email confirmation belong in the **Supabase dashboard** ([supabase-auth-postgres.md](supabase-auth-postgres.md)).

---

## Database (SQLite today, Postgres tomorrow)

### Current local / Node behavior

| Variable | Required locally | Role | Cloudflare Workers |
|----------|------------------|------|--------------------|
| `DATABASE_URL` | Yes for full app today | SQLite path, e.g. `file:./.data/waia.db` ([client.ts](../db/client.ts)) | **`better-sqlite3` / file SQLite is not supported** — see limitations below |

### Postgres / Supabase (migration out of operational scope here)

Choosing how Workers reach Postgres is an **infra decision** documented for operators only:

| Option | Notes |
| ------ | ----- |
| **Supabase transaction pooler** | Connection string often uses host `aws-…pooler.supabase.com` / port **6543** — designed for IPv4 egress from many clouds (friendly to Workers). Treat URI as **Secret**. |
| **Direct DB connection** | Port **5432** on `db.PROJECT.supabase.co` — higher concurrent connection churn for short-lived Workers; may still work with careful pooling. **Secret**. |
| **Cloudflare Hyperdrive** | Pooling / caching in front of Postgres; Worker env references Hyperdrive binding or generated connection string. **Secret** path; pair with [Hyperdrive docs](https://developers.cloudflare.com/hyperdrive/). |

**DEE-61 does not migrate `db/client.ts` or schema.** Until Postgres is wired, expect **runtime failures** on any route that calls `getDb()` when Workers cannot use SQLite ([cloudflare-deploy.md](cloudflare-deploy.md)).

---

## OpenAI (direct API)

| Variable | Public / Secret | Role | Cloudflare |
|----------|-----------------|------|------------|
| `OPENAI_API_KEY` | **Secret** | Server-side calls to `api.openai.com` (or regional equivalent). **Never** in client bundles. | `wrangler secret put OPENAI_API_KEY` |

**Out of scope for DEE-61:** Cloudflare AI Gateway bindings, OpenNext AI routes, or managed gateway env indirection—add rows here when those features land.

---

## Session (email auth — current MVP)

| Variable | Required | Role | Local dev | Cloudflare |
|----------|----------|------|-----------|------------|
| `AUTH_SESSION_MAX_AGE_SECONDS` | No | Session cookie `maxAge` override ([constants.ts](../lib/auth/constants.ts)); default 30 days if unset. | Omit or set for testing | Optional |

There is **no separate signing secret** for the MVP session cookie: it stores an opaque `sessions.id` (see DEE-52 security note). Supabase Auth will replace this pattern when integrated.

---

## OAuth redirect base (legacy MVP)

**OAuth provider configuration is out of scope for DEE-61** beyond listing env names used by existing code.

| Variable | Required for OAuth | Role | Local dev | Cloudflare |
|----------|-------------------|------|-----------|------------|
| `OAUTH_PUBLIC_BASE_URL` | Recommended in prod | Canonical origin for OAuth callbacks and server redirects. Overrides `NEXT_PUBLIC_SITE_URL` when set ([public-url.ts](../lib/oauth/public-url.ts)). | Match preview URL | **Must** match deployed Worker URL |

Misconfigured origins break OAuth `redirect_uri` and post-login redirects.

### OAuth providers (server secrets)

Set only for providers you enable in the UI.

#### Google

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `GOOGLE_CLIENT_ID` | Yes | `wrangler secret put GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | Yes | `wrangler secret put GOOGLE_CLIENT_SECRET` |

#### Apple

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `APPLE_TEAM_ID` | Yes | Secret |
| `APPLE_KEY_ID` | Yes | Secret |
| `APPLE_CLIENT_ID` | Yes | Secret |
| `APPLE_PRIVATE_KEY` | Yes | Secret (PEM; use multiline secret in dashboard) |

#### Telegram

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Secret |

---

## Files and git

| File | Committed? |
|------|------------|
| `.env`, `.env.local`, `.dev.vars` | **No** (gitignored) |
| `.env.example`, `.dev.vars.example` | **Yes** (placeholders only) |
| `cloudflare-env.d.ts` (from `pnpm cf-typegen`) | Local only (**gitignored**); run after changing `wrangler.jsonc` bindings |
