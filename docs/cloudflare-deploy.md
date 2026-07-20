# Cloudflare Workers deployment (WAIA MVP)

This app is **not** suited for static-only Cloudflare Pages export: it uses the **Next.js App Router**, **server components**, and **`/api/*` routes**.

**Target:** [Cloudflare Workers](https://developers.cloudflare.com/workers/) with [**OpenNext Cloudflare adapter**](https://opennext.js.org/cloudflare/get-started) (`@opennextjs/cloudflare`) and **Wrangler** (v3.99+; this repo uses Wrangler 4.x).

We do **not** use the legacy `@cloudflare/next-on-pages` flow.

---

## Prerequisites

- Cloudflare account; ability to create a **Worker** (rename in [`wrangler.jsonc`](../wrangler.jsonc) `name` / `services[].service` if needed — they must match).
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed (already a **devDependency**).
- `pnpm install` at the repository root.
- `wrangler login` before first deploy.

---

## Configuration in this repo

| File | Purpose |
|------|---------|
| [`wrangler.jsonc`](../wrangler.jsonc) | Worker name, `main`, static `assets`, `nodejs_compat`, `WORKER_SELF_REFERENCE` |
| [`open-next.config.ts`](../open-next.config.ts) | OpenNext Cloudflare config (R2 cache optional later) |
| [`next.config.ts`](../next.config.ts) | Standard Next config + `initOpenNextCloudflareForDev()` for local dev parity |
| [`public/_headers`](../public/_headers) | Long-cache headers for `/_next/static/*` (OpenNext recommendation) |

---

## Commands

From the repository root:

| Script | What it does |
|--------|----------------|
| `pnpm cloudflare:build` | Runs `opennextjs-cloudflare build` (internally runs `next build`, then emits `.open-next/`) |
| `pnpm cloudflare:preview` | Build + local **workerd** preview (mirrors production runtime more closely than `next dev`) |
| `pnpm cloudflare:deploy` | Build + deploy to Cloudflare |
| `pnpm cf-typegen` | Generates `cloudflare-env.d.ts` locally after Wrangler binding changes (**gitignored**; ~500 KB upstream template) |

**Local product development** remains `pnpm dev` (Node.js). Use `cloudflare:preview` when verifying Workers-specific behavior.

---

## Environment variables and secrets

See **[cloudflare-env-vars.md](cloudflare-env-vars.md)** for the full inventory.

Summary:

- Set **public** vars (`NEXT_PUBLIC_SITE_URL`, `OAUTH_PUBLIC_BASE_URL`) to the **real HTTPS origin** of the Worker in production.
- Set OAuth and DB-related values as **Wrangler secrets** or encrypted dashboard env — **never commit** (see [`.dev.vars.example`](../.dev.vars.example)).

---

## Known limitations (DEE-50)

### Database / SQLite

The app uses **`better-sqlite3`** and a **local SQLite file** ([`db/client.ts`](../db/client.ts)). That stack is **not production-viable on Cloudflare Workers**:

- Native bindings are not available in the same way as Node on a VPS.
- There is no durable POSIX filesystem for a sqlite file on Workers.

**DEE-50 does not migrate the database.** Until a follow-up implements **D1**, **Postgres** (Neon / Supabase / etc.), or another supported store:

- Treat any Worker deploy as **staging / smoke / app-shell**, or  
- Expect **runtime errors** on sign-in, dashboard data, and any route that calls `getDb()`.

The **OpenNext production bundle build** for this repo **does succeed** (see “Build validation” below); the limitation is **persistence and native SQLite at runtime**, not necessarily the Next compile step.

### Postgres on Workers (DEE-74)

To run **dashboard/API persistence** on Workers without SQLite, set **`WAIA_DB_BACKEND=postgres`** and a non-empty **`DATABASE_URL_POSTGRES`** (see [cloudflare-env-vars.md](cloudflare-env-vars.md)). **Supabase transaction pooler** is the first supported URI style. Local verification: **`pnpm cloudflare:preview`** with `.dev.vars` copied from [`.dev.vars.example`](../.dev.vars.example), then **`GET /api/health/database`** — expect **`{"backend":"postgres","ok":true}`** when Postgres is reachable.

### Cloudflare Images

[`wrangler.jsonc`](../wrangler.jsonc) omits the optional `images` binding. If you enable Next image optimization features that require Cloudflare Images, add the binding per [OpenNext image docs](https://opennext.js.org/cloudflare/howtos/image).

### Edge runtime

This project does **not** set `export const runtime = "edge"`. OpenNext Cloudflare uses the Workers **Node.js compatibility** layer (`nodejs_compat`), not the Edge runtime flag.

---

## Rollback

- Use Cloudflare **Workers versions & deployments** to roll back to a previous upload, or redeploy an older git revision with `pnpm cloudflare:deploy`.
- Keep production secrets scoped per environment; rolling back code does not revert secret values.

---

## Build validation (DEE-50)

Recorded on implementation:

- `pnpm cloudflare:build` completed successfully with Next **16.2.4** and `@opennextjs/cloudflare` **1.19.6** (outputs `.open-next/worker.js` and assets).

Standard app checks (run before merge):

```bash
pnpm exec vitest run
pnpm lint
pnpm typecheck
pnpm build
```

---

## Trader subdomain (AT-E1 S2)

The AI-TRADER module portal is served at **`trader.waia.life`** on the **same** `waia-app` Worker as `waia.life` ([ADR-0006](../adr/0006-ai-trader-repository-strategy.md)). No second deployment or Pages project.

### Topology

- `waia.life` — primary origin (AI-TWIN dashboard, Society **mode**, main app).
- `trader.waia.life` — trader module portal (`/trader` workspace; host-aware landing at `/`).
- Host-conditioned redirects in `next.config.ts` perform **topology-only** isolation (trader host `/dashboard` and `/api/dashboard/*` → primary origin). Middleware classifies the module host only (`x-waia-module`). Auth and entitlement remain in server layouts.

### Operator checklist (production — human gate)

**The implementation PR does not perform these steps.** Complete before relying on the trader subdomain in production:

1. **DNS:** `trader.waia.life` CNAME (or equivalent) → same Worker route as `waia.life`.
2. **Cloudflare Workers:** Attach `trader.waia.life` as a custom domain on `waia-app` (Dashboard → Workers → `waia-app` → Custom Domains).
3. **Worker env vars:** set `NEXT_PUBLIC_TRADER_URL=https://trader.waia.life`, `WAIA_TRADER_HOST=trader.waia.life` alongside existing `NEXT_PUBLIC_SITE_URL=https://waia.life`.
4. **Supabase dashboard:** add `https://trader.waia.life/**` to **Redirect URLs**; keep **Site URL** `https://waia.life` ([DEE-59 checklist](ops/DEE-59-SUPABASE-DASHBOARD-CHECKLIST.md)).
5. **Optional:** `WAIA_COOKIE_DOMAIN=.waia.life` only if intentionally enabling seamless `*.waia.life` session sharing (not required for M2; revert by unsetting).
6. **Smoke:** sign in on each host → entitled user sees trader workspace at `https://trader.waia.life/trader`.

### Rollback

- Remove the `trader.waia.life` custom domain attachment.
- Set `WAIA_TRADER_HOST_ROUTING=0` on the Worker to disable topology middleware without redeploying routes.
- Unset `WAIA_COOKIE_DOMAIN` to revert the optional cookie enhancement.

### Local dev

```bash
# /etc/hosts
127.0.0.1 trader.localhost

# .env.local
WAIA_TRADER_HOST=trader.localhost
NEXT_PUBLIC_TRADER_URL=http://trader.localhost:3000
```

Do **not** set `WAIA_COOKIE_DOMAIN` locally. Verify middleware under `pnpm cloudflare:preview` when changing host routing.

---

## Related docs

- [cloudflare-preview-deploys.md](cloudflare-preview-deploys.md) — **PR preview** GitHub Actions + optional Workers deploy (DEE-51).
- [cloudflare-env-vars.md](cloudflare-env-vars.md) — variable inventory and secrets policy
- [security-dee52-auth-review.md](security-dee52-auth-review.md) — session and OAuth URL hardening
