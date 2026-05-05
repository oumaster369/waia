# Cloudflare / Workers environment variables (WAIA MVP)

Inventory for deploying `waia-app` on **Cloudflare Workers** via **OpenNext** (`@opennextjs/cloudflare`).  
**Never commit** real secrets or production `.dev.vars`. Use the Cloudflare dashboard or `wrangler secret put` for sensitive values.

See also: [cloudflare-deploy.md](cloudflare-deploy.md) (commands, limitations).

---

## Legend

| Symbol | Meaning |
|--------|---------|
| **Public** | Safe to expose to the browser (`NEXT_PUBLIC_*` or non-secret URLs). |
| **Secret** | Server-only; treat as **Wrangler secrets** or **encrypted env** in the dashboard. Never in git. |
| **Local** | Typical value for `pnpm dev` on your machine only. |

Wrangler local preview uses [`.dev.vars`](https://developers.cloudflare.com/workers/testing/local-development/) (gitignored). Copy from [`.dev.vars.example`](../.dev.vars.example) and fill in names only with fake values for local smoke tests.

---

## OpenNext / Next.js (Workers runtime)

| Variable | Required | Role | Local dev | Cloudflare |
|----------|----------|------|-----------|--------------|
| `NEXTJS_ENV` | Optional | Which Next `.env*` files are loaded in Workers preview (OpenNext). Often `development` locally. | `development` in `.dev.vars` | Usually omit (production) |
| `NODE_ENV` | Automatic | `production` in Workers when deployed. Affects cookie `Secure` (see [cookie-response.ts](../lib/auth/cookie-response.ts)). | `development` | Set by platform |

---

## Public URLs / OAuth redirect bases

| Variable | Required for OAuth | Role | Local dev | Cloudflare |
|----------|-------------------|------|-----------|------------|
| `NEXT_PUBLIC_SITE_URL` | Fallback | Public site origin (no trailing slash). Used when `OAUTH_PUBLIC_BASE_URL` unset ([public-url.ts](../lib/oauth/public-url.ts)). | `http://localhost:3000` | `https://your-worker-host` |
| `OAUTH_PUBLIC_BASE_URL` | Recommended in prod | Canonical HTTPS origin for OAuth callbacks and server redirects. Overrides `NEXT_PUBLIC_SITE_URL`. | Same as local server URL | **Must** match deployed Worker URL |

Misconfigured origins break OAuth `redirect_uri` and post-login redirects.

---

## Session (email auth)

| Variable | Required | Role | Local dev | Cloudflare |
|----------|----------|------|-----------|------------|
| `AUTH_SESSION_MAX_AGE_SECONDS` | No | Session cookie `maxAge` override ([constants.ts](../lib/auth/constants.ts)); default 30 days if unset. | Omit or set for testing | Optional secret or plain env |

There is **no separate signing secret** for the MVP session cookie: it stores an opaque `sessions.id` (see DEE-52 security note). Protect the **database** and **HTTPS** in production.

---

## OAuth providers (server secrets)

Set only for providers you enable in the UI.

### Google

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `GOOGLE_CLIENT_ID` | Yes | `wrangler secret put GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | Yes | `wrangler secret put GOOGLE_CLIENT_SECRET` |

### Apple

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `APPLE_TEAM_ID` | Yes | Secret |
| `APPLE_KEY_ID` | Yes | Secret |
| `APPLE_CLIENT_ID` | Yes | Secret |
| `APPLE_PRIVATE_KEY` | Yes | Secret (PEM; use multiline secret in dashboard) |

### Telegram

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Secret |

---

## Database (current implementation)

| Variable | Required locally | Role | Cloudflare Workers |
|----------|------------------|------|--------------------|
| `DATABASE_URL` | Yes for full app | SQLite path, e.g. `file:./.data/waia.db` ([client.ts](../db/client.ts)) | **Not supported** with `better-sqlite3` on Workers (native addon + no durable local file). |

**Production persistence is not solved in DEE-50.** You must choose a follow-up:

- **Cloudflare D1** + Drizzle adapter / HTTP API (schema migration work), or  
- **External Postgres** (Neon, Supabase, etc.) + Drizzle `postgres` driver.

Until then, treat Cloudflare deploy as **staging / app-shell** or expect **runtime failures** on any route that calls `getDb()`.

---

## Future: AI / LLM providers

No `OPENAI_*`, `ANTHROPIC_*`, or similar env vars are required by the current MVP `lib/` tree. When Twin dialogue uses a real model, add documented secrets here and in Cloudflare as **Wrangler secrets**.

---

## Files and git

| File | Committed? |
|------|------------|
| `.env`, `.env.local`, `.dev.vars` | **No** (gitignored) |
| `.dev.vars.example` | **Yes** (placeholders only) |
| `cloudflare-env.d.ts` (from `pnpm cf-typegen`) | Local only (**gitignored**); run after changing `wrangler.jsonc` bindings |
