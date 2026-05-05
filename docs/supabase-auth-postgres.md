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

## OpenAI direct API

Optional **SECRET** worker var:

- `OPENAI_API_KEY`

No **AI Gateway** or OpenNext-specific AI binding is documented in DEE-61; add rows to [cloudflare-env-vars.md](cloudflare-env-vars.md) when GA.

---

## Related files

- [.env.example](../.env.example)
- [.dev.vars.example](../.dev.vars.example)
- [cloudflare-env-vars.md](cloudflare-env-vars.md)
- [cloudflare-deploy.md](cloudflare-deploy.md)
