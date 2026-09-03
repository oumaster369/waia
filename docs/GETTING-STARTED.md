# Getting started with WAIA

**Goal:** Reach a working local environment in **under one hour** (production parity in **10–15 minutes** if secrets are already available).

This guide is the **primary onboarding entrypoint**. Implementation rules live in [`AGENTS.md`](../AGENTS.md). Doc drift and template fixes are tracked in [`documentation-audit-2026.md`](documentation-audit-2026.md).

**Related:** [`waia-governance/WAIA-INFRASTRUCTURE-PARITY-AUDIT-2026.md`](waia-governance/WAIA-INFRASTRUCTURE-PARITY-AUDIT-2026.md) · [`cloudflare-env-vars.md`](cloudflare-env-vars.md) · [`postgres-development.md`](postgres-development.md)

---

## Production at a glance

| Layer | Production (`waia.life`) |
|-------|--------------------------|
| **Auth** | Supabase Auth (email/password) |
| **Database** | Supabase Postgres (`WAIA_DB_BACKEND=postgres`) |
| **AI** | OpenAI-compatible gateway (`WAIA_AI_PROVIDER=openai-compatible`) |
| **Runtime** | Cloudflare Workers (`waia-app`) |
| **Branches** | `dee-*` from `main` · PR to `main` (single trunk) |

Plain vars: [`wrangler.jsonc`](../wrangler.jsonc). Secrets: Worker dashboard or `wrangler secret put`.

**Local note:** Keep `DATABASE_URL=file:./.data/waia.db` in `.env.local` for legacy auth/session fallback paths only. Dashboard and Twin persistence use **Postgres** when `WAIA_DB_BACKEND=postgres`.

---

## Development modes

| | **Mode A — Sandbox** | **Mode B — Twin + SQLite** | **Mode C — Production parity** |
|---|---------------------|---------------------------|----------------------------------|
| **Database** | SQLite | SQLite | Supabase Postgres |
| **Auth** | SQLite email/password | SQLite email/password | Supabase Auth |
| **Twin AI** | Stub (no network) | OpenAI-compatible | OpenAI-compatible |
| **Command** | `pnpm dev` | `pnpm dev` | **`pnpm dev`** |
| **Secrets** | None | `WAIA_AI_OPENAI_API_KEY` | See [Required secrets](#required-secrets) |

**Recommended for most WAIA work:** **Mode C** via **`pnpm dev`** — matches production auth, database, and AI. Use **`pnpm cloudflare:preview`** only for optional Workers runtime smoke (see [Optional Workers preview](#optional-workers-preview)).

---

## Development Philosophy

WAIA development follows **SENSE CODING** (Meaning → Structure → Tasks → Code → System → Evolution). See **`ROADMAP_SENSE_CODING.md`** for the full roadmap; implementation and governance rules are in [`AGENTS.md`](../AGENTS.md).

---

## Required secrets

For **Mode C** / production parity (`pnpm dev`):

| Variable | Kind | Purpose |
|----------|------|---------|
| `DATABASE_URL_POSTGRES` | Secret | Supabase transaction pooler URI (port **6543**) |
| `DATABASE_URL_POSTGRES_SESSION` | Secret when running DEE-918 | Supabase session pooler or direct URI (port **5432**); required for the session-locked ScientificAdmission flow, with no transaction-pooler fallback |
| `WAIA_AI_OPENAI_API_KEY` | Secret | Twin dialogue provider |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase publishable / anon key |

Also set `WAIA_DB_BACKEND=postgres` and the `WAIA_AI_*` gateway vars (see [Mode C `.env.local`](#mode-c--envlocal-production-parity)).

Legacy or unused env names: [`documentation-audit-2026.md`](documentation-audit-2026.md#legacy-env-names-canonical-truth).

---

## Recovery and parity check

Use after a new machine, credential rotation, or env change. **Expected time: 10–15 minutes** (excluding fetching secrets).

### Setup

- [ ] Node **22** + pnpm **10** (`corepack enable`)
- [ ] `git checkout main && git pull` · `pnpm install --frozen-lockfile`
- [ ] Restore **Mode C** `.env.local` (or copy from `.env.local.backup`)
- [ ] If schema may be behind: `pnpm db:migrate:postgres` (reads `.env.local`)
- [ ] `pnpm dev` → [http://localhost:3000](http://localhost:3000)

### Verify

- [ ] **Login** — email/password via Supabase; reach `/dashboard`
- [ ] **Dashboard** — readiness indicators and Twin dialogue visible
- [ ] **Postgres health** — `curl -sS http://localhost:3000/api/health/database` → `{"backend":"postgres","ok":true}`
- [ ] **Live Twin** — dialogue returns contextual AI text (not the static stub)
- [ ] **PR validation** — full chain in [`AGENTS.md`](../AGENTS.md) (Validation Rules)

**Probes (server running):**

```bash
curl -sS http://localhost:3000/api/health/database

curl -sS -X POST http://localhost:3000/api/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"wrong"}'
# expect 401 INVALID_CREDENTIALS, not 500
```

**Operators:** [`waia-governance/WAIA-RECOVERY-2026.md`](waia-governance/WAIA-RECOVERY-2026.md)

---

## 1. Prerequisites

| Tool | Version |
|------|---------|
| **Node.js** | 22.x |
| **pnpm** | 10.x (`corepack enable`) |
| **Git** | Access to `oumaster369/waia` |

**Mode C:** Supabase project access, OpenAI API key ([platform.openai.com](https://platform.openai.com)).

**Optional:** Docker (local Postgres integration tests), Wrangler (preview/deploy).

WAIA uses **`node-linker=hoisted`** ([`.npmrc`](../.npmrc)) — required for Tailwind v4 + shadcn.

---

## 2. Installation

```bash
git clone https://github.com/oumaster369/waia.git
cd waia
git checkout main && git pull origin main
corepack enable
pnpm install --frozen-lockfile
```

---

## 3. Environment variables

```bash
cp .env.example .env.local    # pnpm dev (required)
cp .dev.vars.example .dev.vars  # only for cloudflare:preview
```

Never commit filled secrets.

### Mode C — `.env.local` (production parity)

Use **both** Supabase Auth **and** Postgres — enabling only one causes partial parity.

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
OAUTH_PUBLIC_BASE_URL=http://localhost:3000
AUTH_SESSION_MAX_AGE_SECONDS=2592000

# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>

# Postgres runtime
WAIA_DB_BACKEND=postgres
DATABASE_URL_POSTGRES=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_URL_POSTGRES_SESSION=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

# Twin AI (match wrangler.jsonc)
WAIA_AI_GATEWAY_FOUNDATION=1
WAIA_AI_PROVIDER=openai-compatible
WAIA_AI_OPENAI_API_KEY=<your-key>
WAIA_AI_OPENAI_MODEL=gpt-5.5
WAIA_AI_OPENAI_TEMPERATURE=0
WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1

# Legacy fallback paths only
DATABASE_URL=file:./.data/waia.db
```

**Supabase dashboard:** add `http://localhost:3000` to Site URL / Redirect URLs; copy **Transaction pooler** URI into `DATABASE_URL_POSTGRES`.

### Mode A — `.env.local` (sandbox, no secrets)

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
OAUTH_PUBLIC_BASE_URL=http://localhost:3000
DATABASE_URL=file:./.data/waia.db
AUTH_SESSION_MAX_AGE_SECONDS=2592000
```

Leave Supabase and `WAIA_AI_*` unset. Twin uses stub text.

### Mode B — add OpenAI to Mode A

```bash
WAIA_AI_GATEWAY_FOUNDATION=1
WAIA_AI_PROVIDER=openai-compatible
WAIA_AI_OPENAI_API_KEY=<your-key>
```

---

## 4. Database setup

### Mode C — Supabase (recommended)

```bash
pnpm db:migrate:postgres
```

Reads `DATABASE_URL_POSTGRES` from `.env.local`. Shell export overrides for one-off targets.

Apply to **dev/staging** Supabase unless you are intentionally migrating production.

### Mode A / B — SQLite

```bash
pnpm db:migrate
```

Creates `.data/waia.db`. Optional: `pnpm db:studio`.

### Local Docker Postgres (integration tests only)

Point at Docker **before** bootstrap — do not rely on a Supabase URI in `.env.local`:

```bash
export DATABASE_URL_POSTGRES='postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate'
pnpm db:postgres:up
pnpm db:postgres:auth-prelude
pnpm db:migrate:postgres
```

See [`postgres-development.md`](postgres-development.md).

| Track | Command | Target |
|-------|---------|--------|
| SQLite | `pnpm db:migrate` | `.data/waia.db` |
| Postgres | `pnpm db:migrate:postgres` | Supabase or Docker |

---

## 5. Running locally

### Mode C — `pnpm dev` (primary)

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) → Supabase sign-in → dashboard → Twin dialogue (live OpenAI when gateway vars are set).

This is the **default production-parity path**. No Workers preview required for day-to-day work.

### Mode A / B — `pnpm dev`

Same command; SQLite auth and stub (A) or OpenAI (B) per env above.

### Optional: Workers preview

Pre-deploy smoke for **Cloudflare runtime** (per-request Postgres client, no SQLite on Workers):

```bash
# Populate .dev.vars — mirror wrangler.jsonc + secrets (see .dev.vars.example)
pnpm cloudflare:preview
```

Verify: `GET …/api/health/database` → `{"backend":"postgres","ok":true}` on the URL Wrangler prints.

Deploy flow: [`cloudflare-deploy.md`](cloudflare-deploy.md) · [`cloudflare-env-vars.md`](cloudflare-env-vars.md)

---

## 6. Testing

Run the validation canon from [`AGENTS.md`](../AGENTS.md) before every PR. Default `pnpm test --run` uses SQLite (no secrets). E2E (`pnpm test:e2e`) when changing `app/**` or `components/**`. Optional Postgres integration: [`postgres-development.md`](postgres-development.md).

---

## 7. Common problems

| Symptom | Fix |
|---------|-----|
| Twin always stub text | Enable `WAIA_AI_GATEWAY_FOUNDATION=1`, `WAIA_AI_PROVIDER=openai-compatible`, `WAIA_AI_OPENAI_API_KEY`; restart `pnpm dev` |
| `WAIA_DB_BACKEND=postgres requires DATABASE_URL_POSTGRES` | Set non-empty pooler URI in `.env.local` |
| Sign-in OK but empty dashboard (Mode C) | Enable **both** Supabase vars **and** `WAIA_DB_BACKEND=postgres` |
| Health shows `sqlite` | `WAIA_DB_BACKEND` unset or not `postgres` |
| `cloudflare:preview` DB errors | Populate `.dev.vars` Postgres block; Workers cannot use SQLite |
| Migrations fail on Docker Postgres | Run `pnpm db:postgres:auth-prelude` first |
| OAuth buttons hidden | Expected unless Google/Apple/Telegram env is configured |

---

## Quick start — Mode A (15 minutes, no secrets)

```bash
git clone https://github.com/oumaster369/waia.git && cd waia
git checkout main && git pull origin main
corepack enable && pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:migrate && pnpm dev
```

Sign up at [http://localhost:3000](http://localhost:3000) — stub Twin dialogue, no API keys.

---

## Where to go next

| Topic | Document |
|-------|----------|
| Git, branches, PRs, validation | [`AGENTS.md`](../AGENTS.md) |
| Linear task contract | [`waia-governance/LINEAR-GOVERNANCE.md`](waia-governance/LINEAR-GOVERNANCE.md) |
| Post-merge + release tag | [`waia-governance/POST-MERGE-PROTOCOL.md`](waia-governance/POST-MERGE-PROTOCOL.md) |
| Cloudflare deploy | [`cloudflare-deploy.md`](cloudflare-deploy.md) |
| Product scope (AI-Twin v1) | [`product/WAIA-V1-MVP-SPEC.md`](product/WAIA-V1-MVP-SPEC.md) |
| Infra parity audit | [`waia-governance/WAIA-INFRASTRUCTURE-PARITY-AUDIT-2026.md`](waia-governance/WAIA-INFRASTRUCTURE-PARITY-AUDIT-2026.md) |
| Doc template drift | [`documentation-audit-2026.md`](documentation-audit-2026.md) |
| Postgres program | [`migrations/DEE-64-TRACKER.md`](migrations/DEE-64-TRACKER.md) |
| Design tokens | [`DESIGN_OS_V1.md`](DESIGN_OS_V1.md) |
