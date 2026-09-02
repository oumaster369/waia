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
- **`WAIA_AI_OPENAI_API_KEY`** — Secret — **Twin / OpenAI-compatible** path reads this ([`openai-compatible-completion-provider.ts`](../lib/ai-gateway/openai-compatible-completion-provider.ts)); **never** in client bundles.
- **`OPENAI_API_KEY`** — Secret — legacy name in some docs/deployments; **do not** rely on it alone for the current gateway path. Production may keep both until a chartered migration removes legacy usage.

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
| `NEXT_PUBLIC_SITE_URL` | Yes | Primary WAIA origin (no trailing slash). | `http://127.0.0.1:3000` | `https://waia.life` |

---

## Module host routing (AT-E1 S2)

Single Worker serves **both** `waia.life` (primary) and `trader.waia.life` (trader module portal). Host logic is config-driven via [`lib/hosts/`](../lib/hosts/).

| Variable | Required | Role | Local dev | Cloudflare |
|----------|----------|------|-----------|------------|
| `NEXT_PUBLIC_TRADER_URL` | Yes (prod) | Trader portal public origin. | `http://trader.localhost:3000` | `https://trader.waia.life` |
| `WAIA_PRIMARY_HOST` | Optional | Server-side primary hostname match. | `localhost` | `waia.life` |
| `WAIA_TRADER_HOST` | Optional | Server-side trader hostname match. | `trader.localhost` | `trader.waia.life` |
| `WAIA_TRADER_HOST_ROUTING` | Optional | Kill-switch for trader-host topology redirects (`0`/`false`/`off` disables). | omit (default on) | omit unless rolling back |
| `WAIA_COOKIE_DOMAIN` | **Optional** | Production-only reversible UX enhancement for `*.waia.life` session sharing. **Not required for M2. Not the WAIA SSO strategy.** Partner-domain SSO is a future redirect/token design. | **Leave unset** | Set to `.waia.life` only if intentionally enabling seamless subdomain sessions |

**Operator (production, human gate — not automated in app PR):**

1. Attach `trader.waia.life` as a **custom domain** on the existing `waia-app` Worker (same deployment as `waia.life`).
2. Add `https://trader.waia.life/**` to Supabase **Redirect URLs**; keep Site URL `https://waia.life`.
3. Set Worker env: `NEXT_PUBLIC_TRADER_URL`, `WAIA_TRADER_HOST` (and `WAIA_COOKIE_DOMAIN` only if enabling the optional cookie enhancement).

See [cloudflare-deploy.md § Trader subdomain](cloudflare-deploy.md#trader-subdomain-at-e1-s2).

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

### Workers runtime: Postgres via `getWaiaRuntimeDb` (DEE-74)

These variables are read by [`runtime-backend.ts`](../db/runtime-backend.ts) and [`postgres-client.ts`](../db/postgres-client.ts). When configured, [`getWaiaRuntimeDb()`](../db/waia-runtime-db.ts) returns **`{ kind: "postgres" }`** and **does not** call `getDb()` / SQLite on that path.

| Variable | When | Role | Cloudflare |
|----------|------|------|------------|
| `WAIA_DB_BACKEND` | Set to `postgres` | Selects Postgres runtime for `getWaiaRuntimeDb()` instead of default SQLite. | Plain env (e.g. `postgres` in dashboard or `.dev.vars`) |
| `DATABASE_URL_POSTGRES` | Required when `WAIA_DB_BACKEND=postgres` | **Secret** — Postgres connection URI for Drizzle + `postgres` driver. | `wrangler secret put DATABASE_URL_POSTGRES` or encrypted dashboard env |
| `DATABASE_URL_POSTGRES_SESSION` | Required for DEE-918 trusted four-surface ScientificAdmission | **Secret** — direct or session-mode Postgres URI on port 5432. Session advisory-lock workflows fail closed if it is absent or identifies transaction pooling; there is no `DATABASE_URL_POSTGRES` fallback. | `wrangler secret put DATABASE_URL_POSTGRES_SESSION` or encrypted dashboard env |
| `WAIA_POSTGRES_PER_REQUEST_CLIENT` | Optional (DEE-110) | Default **on** (`true` / `1` / `yes` / `on` / unset): one `postgres.js` client per request (recommended on Workers). Set **`false`**, **`0`**, **`no`**, or **`off`** to roll back to the legacy global singleton (emergency only). | Plain env |

**First supported path (DEE-74 slice):** **Supabase transaction pooler** — use the **Transaction pooler** connection string from the Supabase dashboard (often host `…pooler.supabase.com`, port **6543**, IPv4-friendly for Workers). Paste the full URI into **`DATABASE_URL_POSTGRES`**.

**DEE-918 exception:** the trusted four-surface ScientificAdmission flow holds a session advisory
lock from authenticated DEVELOPMENT loading through admission persistence. Configure
`DATABASE_URL_POSTGRES_SESSION` with Supabase's session pooler or direct URI on port **5432**.
Port **6543** and an explicit `pool_mode=transaction` are rejected; the general transaction URL is
never used as fallback for this flow.

**Optional later hardening:** **Cloudflare Hyperdrive** in front of Postgres — **not** required for DEE-74; may reduce connection churn in production. Same logical contract: a **secret** connection string the Worker can use as **`DATABASE_URL_POSTGRES`** (or a binding-mapped equivalent when implemented). See [Hyperdrive docs](https://developers.cloudflare.com/hyperdrive/).

**Other Postgres entry styles (operator choice):**

| Option | Notes |
| ------ | ----- |
| **Direct DB connection** | Port **5432** on `db.PROJECT.supabase.co` — may work but higher churn for short-lived Workers. **Secret**. |

Document **preview/staging** values in [`.dev.vars.example`](../.dev.vars.example) (copy to gitignored `.dev.vars`); never commit real URIs.

If `WAIA_DB_BACKEND` is unset or `sqlite`, Workers still hit **`getDb()`** for dashboard routes — expect **runtime failures** on Workers ([cloudflare-deploy.md](cloudflare-deploy.md)).

---

## OpenAI (direct API)

| Variable | Public / Secret | Role | Cloudflare |
|----------|-----------------|------|------------|
| `WAIA_AI_OPENAI_API_KEY` | **Secret** | **Required** for Twin dialogue when **`WAIA_AI_PROVIDER=openai-compatible`**. **Never** in client bundles. | `wrangler secret put WAIA_AI_OPENAI_API_KEY` |
| `OPENAI_API_KEY` | **Secret** | Legacy / alternate naming; some environments still set it. **Twin gateway code does not read this key.** | Optional; do not remove in a given deploy without Architect sign-off |

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
| `TELEGRAM_BOT_TOKEN` | Yes | Secret — OAuth Login Widget only |
| `TELEGRAM_ALERTS_BOT_TOKEN` | Yes | Secret — dedicated BP-9 Alerts Bot (`sendMessage`) |
| `TELEGRAM_ALERTS_CHAT_ID` | Yes | Secret — forum supergroup for critical alerts |
| `TELEGRAM_ALERTS_THREAD_ID` | Yes | Secret — **Alerts** forum topic thread id |

See [DEE-223 BP-9 runbook](./ops/DEE-223-BP9-TELEGRAM-ALERTING-RUNBOOK.md) for provisioning (names only — never commit values).

---

## AI-TRADER — Market Intelligence (MI gateway)

Binding spec: [`docs/ai-trader/AI-TRADER-DATA-PROVIDERS.md`](./ai-trader/AI-TRADER-DATA-PROVIDERS.md)  
**Canonical provisioning:** [`docs/ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md`](./ai-trader/AI-TRADER-MARKET-DATA-PROVIDER-PROVISIONING-GUIDE.md)  
Phase records: [`docs/ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md`](./ops/DEE-392-DATA-PROVIDER-READINESS-RUNBOOK.md) · [`docs/ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md`](./ops/DEE-393-FULL-MARKET-DATA-INTEGRATION-RUNBOOK.md)

**HTX trade credentials are never Worker env vars** — connect via Trader UI; encrypted with master key.

| Variable | Secret? | Cloudflare | Notes |
|----------|---------|------------|-------|
| `MARKET_BRAIN_ENABLED` | No | Plain `wrangler.jsonc` var | Cron ingest toggle |
| `MARKET_BRAIN_ORGANIZATION_ID` | No | Plain var | Target org UUID |
| `HTX_REST_HOST` | No | Plain var or secret | Optional REST host override |
| `COINGECKO_API_KEY` | Yes | `wrangler secret put COINGECKO_API_KEY` | Optional; fail-soft without |
| `FRED_API_KEY` | Yes | `wrangler secret put FRED_API_KEY` | Optional macro series; fail-soft without |
| `AI_TRADER_INFURA_PROJECT_ID` | Yes | `wrangler secret put AI_TRADER_INFURA_PROJECT_ID` | Infura project id (not bare `INFURA_PROJECT_ID`) |
| `AI_TRADER_INFURA_API_SECRET` | Yes | `wrangler secret put AI_TRADER_INFURA_API_SECRET` | Infura API secret (not bare `INFURA_API_KEY`) |
| `AI_TRADER_TRONGRID_API_KEY` | Yes | `wrangler secret put AI_TRADER_TRONGRID_API_KEY` | MI blockchain intelligence — **not** payment watcher |
| `AI_TRADER_GITHUB_TOKEN` | Yes | `wrangler secret put AI_TRADER_GITHUB_TOKEN` | Optional protocol release rate limits |
| `AI_TRADER_SEC_EDGAR_USER_AGENT` | Yes | `wrangler secret put AI_TRADER_SEC_EDGAR_USER_AGENT` | SEC EDGAR policy-bound User-Agent |
| `AI_TRADER_CME_FEDWATCH_ENABLED` | No | Plain var (`1` / `true` to enable) | Opt-in CME FedWatch adapter |
| `PAPER_LOOP_ENABLED` | No | Plain var | Paper cron toggle |
| `PAPER_LOOP_ORGANIZATION_ID` | No | Plain var | Paper org |
| `PAPER_LOOP_ACCOUNT_KEY` | No | Plain var | Paper account key |
| `PAPER_LOOP_DEFAULT_QUANTITY` | No | Plain var | Optional |
| `PAPER_LOOP_CYCLE_ID_PREFIX` | No | Plain var | Optional |
| `AI_TRADER_MASTER_KEY_DEV` | Yes | **Never in production** | Local `.env.local` only |
| `AI_TRADER_MASTER_KEY` | Yes | Secrets Store binding | See [DEE-220 runbook](./ops/DEE-220-MASTER-KEY-RUNBOOK.md) |

Local dev: copy placeholders from `.env.example` → `.env.local`. Workers preview: `.dev.vars.example` → `.dev.vars`.

Validation: `pnpm validate:provider-readiness` · `pnpm validate:market-data-integration`

---

## AI-TRADER — Payment watcher (settlement; not MI gateway)

| Variable | Secret? | Cloudflare |
|----------|---------|------------|
| `TRONGRID_API_KEY` | Yes | `wrangler secret put TRONGRID_API_KEY` |
| `TRON_RPC_PRIMARY_URL` | No | Plain var (default TronGrid) |
| `TRON_RPC_SECONDARY_URL` | No | Plain var |
| `TRON_RPC_SECONDARY_API_KEY` | Yes | Secret |
| `WATCHER_ENABLED` | No | Plain var |
| `WATCHER_*` | No | Plain vars (see `.env.example`) |

**Do not reuse** `TRONGRID_API_KEY` for AI-TRADER blockchain intelligence — use `AI_TRADER_TRONGRID_API_KEY` instead.

---

## Treasury evidence storage

| Binding | Secret? | Cloudflare | Notes |
|---------|---------|------------|-------|
| `TREASURY_EVIDENCE_R2` | No | Private R2 binding in `wrangler.jsonc` | Production bucket: `waia-treasury-evidence-prod`; no public URL, S3 credentials, or `r2.dev` access |

Run `pnpm cf-typegen` after changing Worker bindings. Local development and tests use
Wrangler's local R2 simulation or the in-memory adapter; they do not write to the
production bucket.

---

## Files and git

| File | Committed? |
|------|------------|
| `.env`, `.env.local`, `.dev.vars` | **No** (gitignored) |
| `.env.example`, `.dev.vars.example` | **Yes** (placeholders only) |
| `cloudflare-env.d.ts` (from `pnpm cf-typegen`) | Local only (**gitignored**); run after changing `wrangler.jsonc` bindings |
