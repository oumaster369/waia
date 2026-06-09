# WAIA recovery report — 2026

**Status:** Factual snapshot after workstation loss and local environment restoration.  
**Date recorded:** 2026-06-09  
**Scope:** Reconstruct current WAIA state from repository, tooling, Linear, GitHub, and Cloudflare — not a product roadmap.

**Context:** The WAIA repository was restored from GitHub (`oumaster369/waia`). Local secrets, environment files, toolchain, and Cursor session memory were lost with the previous workstation. Environment recovery was executed on 2026-06-09; this document captures the resulting state.

---

## 1. Current repository status

| Item | State |
|------|--------|
| **Remote** | `https://github.com/oumaster369/waia.git` |
| **Default branch (GitHub)** | `dev` (`origin/HEAD` → `origin/dev`) |
| **Local branch** | `dev`, tracking `origin/dev` |
| **Local tip** | `f2eaa0f` — `docs(governance): record Git and Cloudflare hygiene cleanup (#160)` |
| **`origin/main` tip** | `536a288` — `release: promote dev to main after PR156 landing stabilization (#157)` |
| **Branch relationship** | `origin/main` **is an ancestor of** `origin/dev` (`main` 0 commits ahead, `dev` 221 commits ahead) |
| **Long-lived remotes** | `dev`, `main` only (per [`WAIA-OPERATING-MEMORY.md`](WAIA-OPERATING-MEMORY.md) §15) |
| **Working tree** | One modified tracked file: `next-env.d.ts` (likely from local `pnpm build`; not committed) |
| **Untracked gitignored artifacts** | `.env.local`, `.dev.vars`, `.data/waia.db`, `node_modules/`, `.next/` (when built) |

### Toolchain (restored 2026-06-09)

| Tool | Version |
|------|---------|
| Node.js | v22.22.3 (Homebrew `node@22`; PATH in `~/.zshrc`) |
| pnpm | 10.34.1 (corepack) |
| Package manager config | `.npmrc`: `node-linker=hoisted` |
| Lockfile | `pnpm-lock.yaml` lockfileVersion **9.0** |

### Validation canon (last verified 2026-06-09)

| Command | Result |
|---------|--------|
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test --run` | Pass — **496** unit tests; **38** Postgres integration tests skipped (no `WAIA_PG_INTEGRATION=1`) |
| `pnpm build` | Pass — Next.js 16.2.4; all App Router + API routes compile |

### Application stack (from `package.json`)

- **Framework:** Next.js 16.2.4, React 19.2.4, TypeScript 5
- **Deploy target:** Cloudflare Workers via OpenNext (`@opennextjs/cloudflare` 1.19.6)
- **DB:** Drizzle ORM — SQLite local default; Postgres env-gated for Workers/production
- **Tests:** Vitest 2.1.x (unit), Playwright 1.59.x (e2e, Chromium)

---

## 2. Current Linear status

| Field | Value |
|-------|--------|
| **Workspace** | DeepSense |
| **Team** | DEE (DeepSense) |
| **Project** | WAIA (`waia-ec7442967ce7`) |
| **MCP server id (Cursor)** | `plugin-linear-linear` |
| **MCP connectivity** | Working (authenticated as `oumaster369@gmail.com`) |

### Milestones (project WAIA)

| Milestone | Progress | Notes |
|-----------|----------|-------|
| **WAIA MVP 1.0** | 100% | Complete |
| **Production Readiness v1: Auth + Postgres + AI Gateway** | 77.14% | Postgres + gateway rollout track |
| **WAIA v1 First Human Experience** | 78.57% | Partner-preview / first-encounter coherence |
| **WAIA Design System & Atmospheric UX v1** | 6.25% | Design OS / atmospheric UX |

### Active issues (snapshot 2026-06-09)

| Status | ID | Title | Priority | Labels |
|--------|-----|-------|----------|--------|
| **Todo** | [DEE-129](https://linear.app/deepsense/issue/DEE-129/partner-preview-hardening-and-runtime-performance-stabilization) | Partner Preview Hardening & Runtime Performance Stabilization | High | `product`, `backend` |
| **In Progress** | [DEE-92](https://linear.app/deepsense/issue/DEE-92/waia-architectural-migration-log) | WAIA Architectural Migration Log | No priority | `product` |

**Governance note:** DEE-129 carries **two execution labels** (`product` + `backend`). [`AGENTS.md`](../../AGENTS.md) requires exactly one execution label per executable issue — agents must STOP or split/relabel before implementation.

**DEE-129 identifier note (from issue text):** Earlier PR history used “DEE-129” for **production AI runtime alignment** (`wrangler.jsonc`, merged to `main`). That work is **complete**. The open Linear issue is **post-release** hardening: latency attribution, branch sync verification, optional Your Name signup, streaming documentation.

### Related issues (DEE-129)

- **DEE-128** — Partner preview release readiness (predecessor; production live)
- **DEE-127** — Human cadence calibration (exploration only; out of scope for DEE-129)
- **DEE-130** — Adaptive Twin Formation Dialogue Architecture (related planning; out of scope)

---

## 3. Current Cloudflare status

| Item | State |
|------|--------|
| **Platform** | Cloudflare Workers (not Cloudflare Pages-only export) |
| **Production Worker** | `waia-app` |
| **Production domain** | `https://waia.life` |
| **Walkthrough Worker** | `waia-app-dee114-walkthrough` (kept intentionally; see [`wrangler.dee114-walkthrough.jsonc`](../../wrangler.dee114-walkthrough.jsonc)) |
| **Account** | Oumaster369 |
| **Account ID** | `47b767650f53b4bcf0d6c89fc1a56c30` |
| **Wrangler CLI** | 4.87.0 (project devDep); update available 4.98.0 |
| **Local wrangler auth** | Authenticated (OAuth, `oumaster369@gmail.com`) |

### Production Worker config ([`wrangler.jsonc`](../../wrangler.jsonc))

- **Entry:** `.open-next/worker.js`
- **Compatibility:** `nodejs_compat`, `global_fetch_strictly_public`
- **Bindings:** `ASSETS` (static), `WORKER_SELF_REFERENCE` (service self-ref)
- **Plain vars (committed):** `NEXT_PUBLIC_SITE_URL`, `OAUTH_PUBLIC_BASE_URL` → `https://waia.life`; `WAIA_DB_BACKEND=postgres`; AI gateway foundation + `openai-compatible` + model `gpt-5.5`; Supabase public URL + anon key; `WAIA_TWIN_DIALOGUE_CONTINUITY=replay_v1`

### Worker secrets (server-side; names only — values not in repo)

Verified present on `waia-app` via `wrangler secret list`:

- `DATABASE_URL`
- `DATABASE_URL_POSTGRES`
- `OPENAI_API_KEY` (legacy; Twin gateway uses `WAIA_AI_OPENAI_*`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `WAIA_AI_OPENAI_API_KEY`

### Deployments

- Latest listed deployment for `waia-app` (wrangler): version `989ad89e-5b5a-44df-9898-a7e1474b18c0`, created 2026-05-12
- DEE-129 issue text references an earlier production deploy (`403074cc`, commit `daed6bb`) — **may differ** from current dashboard state; verify in Cloudflare before ops decisions

### Not configured (repo)

- D1, KV, R2, Hyperdrive bindings
- Cloudflare Images binding
- In-app external log aggregation (telemetry is stdout JSON only)

---

## 4. Current GitHub status

| Item | State |
|------|--------|
| **Repository** | `oumaster369/waia` (public) |
| **Default branch** | `dev` |
| **CODEOWNERS** | `@oumaster369` (all paths) |
| **`gh` CLI auth** | Logged in as `oumaster369` (keyring token) |
| **Git HTTPS operations** | Working (`git ls-remote origin` succeeds) |

### GitHub Actions workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR/push to `dev`, `main` | lint, typecheck, unit tests, build, Playwright e2e |
| `cloudflare-preview.yml` | PR to `dev`, `main` | OpenNext bundle; optional preview Worker deploy |
| `postgres-integration.yml` | `workflow_dispatch` only | Postgres migrate + integration guard |

### GitHub Actions secrets

`gh secret list -R oumaster369/waia` returned **no secrets** (2026-06-09). Effect: `cloudflare-preview.yml` **skips** preview Worker deploy with a notice; OpenNext bundle job still runs. If preview deploys are desired, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in repository secrets.

---

## 5. Active branches and release flow

### Branch roles

| Branch | Role | Direct push |
|--------|------|-------------|
| **`dev`** | Integration / development | **Forbidden** (human PR only) |
| **`main`** | Production source | **Forbidden** (human PR only) |
| **`dee-<NN>-<slug>`** | Feature/work branches linked to Linear `DEE-NN` | Allowed → PR to `dev` |

Legacy `feature/*` naming exists in history but is **deprecated** for new work.

### Release flow (documented)

```
Linear issue (DEE-NN)
  → branch dee-<NN>-<slug>
  → implement + validation canon
  → PR to dev (human review + merge)
  → (periodic) PR dev → main (human)
  → production deploy: pnpm cloudflare:build && pnpm cloudflare:deploy (or Cloudflare dashboard)
  → waia-app Worker → waia.life
```

After `dev` → `main` promotion, **`main` should be merged back into `dev`** with a merge commit (not squash/rebase) so `main` remains an ancestor of `dev` ([`WAIA-OPERATING-MEMORY.md`](WAIA-OPERATING-MEMORY.md) §15). Current state satisfies ancestry (PR #159 lineage).

---

## 6. Existing documentation inventory

**Total:** 82 files under `docs/` (30 under `docs/waia-governance/`).

### Entry points

| Document | Purpose |
|----------|---------|
| [`README.md`](../../README.md) | Repo hub |
| [`AGENTS.md`](../../AGENTS.md) | Agent execution contract |
| [`CLAUDE.md`](../../CLAUDE.md) | Redirect to AGENTS + governance |
| [`docs/waia-governance/README.md`](README.md) | Governance index |
| [`docs/product/WAIA-V1-MVP-SPEC.md`](../product/WAIA-V1-MVP-SPEC.md) | MVP product hub |
| [`docs/waia-governance/WAIA-OPERATING-MEMORY.md`](WAIA-OPERATING-MEMORY.md) | Layer 2 operational snapshot |

### By corpus

| Corpus | Count (approx.) | Examples |
|--------|-----------------|----------|
| **Governance** | 30 | DEV OS, execution contract, branching, Linear, risk tiers, constitutional history |
| **Product** | 5 | User flow, readiness model, dashboard shell, landing |
| **Architecture** | 12 | DEE-76 AI Gateway, DEE-116–127 Twin dialogue doctrine, transactions |
| **Migrations / ops** | 18 | DEE-64 tracker, DEE-95* runtime/telemetry, DEE-128 release notes |
| **ADR** | 5 | Branch naming, Postgres discipline, telemetry, governance evolution |
| **Design** | 3 | Design OS, foundation, DEE-131 migration |
| **Infra / deploy** | 5 | Cloudflare deploy, env vars, preview deploys, Supabase/postgres, security review |
| **Adjunct** | 4 | Development workflow, agent automation, dialogue modes |

Authoritative conflict order: product specs → governance → migration trackers → Linear issue → code ([`AGENTS.md`](../../AGENTS.md)).

---

## 7. Existing agent system inventory

### Canonical contract

- **[`AGENTS.md`](../../AGENTS.md)** — branching, Linear integration, 4-phase workflow, validation canon, execution labels, auto-advance preconditions
- **[`docs/waia-governance/WAIA-DEV-OS.md`](WAIA-DEV-OS.md)** — DEV OS constitution (roles, lifecycle, gates)
- **[`docs/waia-governance/EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)** — human approval gates, STOP format, risk alignment

### Phased workflow (Cursor commands)

| Phase | Command | File |
|-------|---------|------|
| Plan | `/plan-feature` | [`.cursor/commands/plan-feature.md`](../../.cursor/commands/plan-feature.md) |
| Implement | `/implement` | [`.cursor/commands/implement.md`](../../.cursor/commands/implement.md) |
| Test & Fix | `/test-and-fix` | [`.cursor/commands/test-and-fix.md`](../../.cursor/commands/test-and-fix.md) |
| PR readiness | `/prepare-pr` | [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md) |

### Cursor rules (`.cursor/rules/`)

| Rule | Topic |
|------|-------|
| `00-overview.mdc` | Project overview, MCP server id |
| `10-git-workflow.mdc` | Branching, no direct push to `main`/`dev` |
| `20-code-style.mdc` | TypeScript, React, Tailwind conventions |
| `30-testing.mdc` | Vitest, Playwright, validation expectations |
| `40-secrets.mdc` | Never commit secrets |
| `50-waia-design-os.mdc` | Design OS / token discipline |

### Cursor hooks ([`.cursor/hooks.json`](../../.cursor/hooks.json))

| Hook | Script | Behavior |
|------|--------|----------|
| `beforeShellExecution` | `guard-shell.sh` | Fail-closed shell guard |
| `afterFileEdit` (Write) | `format-edit.sh` | Post-edit formatting |
| `stop` / `subagentStop` | `log-event.sh` | Event logging to `.cursor/agent-log.jsonl` (gitignored) |

### Agent roles and gates

- **[`docs/waia-governance/AGENT-ROLES.md`](AGENT-ROLES.md)** — planner/executor vocabulary, model hints
- **[`docs/waia-governance/RISK-TIERS.md`](RISK-TIERS.md)** — T0–T4 autonomy envelopes
- **[`docs/waia-governance/CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md)** — Gate A–D model; Gates B–D **not authorized**
- **Prime clause:** Agents may comment; humans decide; AI-Twin v1 remains primary product priority

---

## 8. Existing MCP inventory

### Committed in repository ([`.cursor/mcp.json`](../../.cursor/mcp.json))

| Server | Transport | Purpose |
|--------|-----------|---------|
| **playwright** | `npx @playwright/mcp@latest` | Browser automation / e2e assistance |

### Cursor runtime (workspace plugins — not all in repo)

| Server id | Purpose | Status (2026-06-09) |
|-----------|---------|---------------------|
| **plugin-linear-linear** | Linear issues, milestones, comments | Working |
| **plugin-cloudflare-cloudflare-docs** | Cloudflare documentation retrieval | Available |
| **plugin-cloudflare-cloudflare-bindings** | Bindings / wrangler context | Available |
| **plugin-cloudflare-cloudflare-builds** | Workers Builds CI | Available |
| **plugin-cloudflare-cloudflare-observability** | Worker logs / metrics | Available |
| **cursor-ide-browser** | In-IDE browser automation | Available |
| **project-0-waia-playwright** | Project-scoped Playwright MCP | Available |

**Rule:** Always read MCP tool schemas before calling. Linear must use server id **`plugin-linear-linear`** ([`AGENTS.md`](../../AGENTS.md), `.cursor/rules/00-overview.mdc`).

---

## 9. Existing environment variables inventory

Source of truth templates: [`.env.example`](../../.env.example) (Node/`pnpm dev`), [`.dev.vars.example`](../../.dev.vars.example) (Workers preview), [`docs/cloudflare-env-vars.md`](../cloudflare-env-vars.md) (production inventory).

### Local restoration state (2026-06-09)

| File | Present | Contents |
|------|---------|----------|
| `.env.local` | Yes (gitignored) | SQLite `DATABASE_URL`, localhost URLs; AI/Postgres/OAuth secrets commented with `<<< PROVIDE MANUALLY >>>` |
| `.dev.vars` | Yes (gitignored) | Preview defaults; Postgres/AI secrets commented |
| `.data/waia.db` | Yes (gitignored) | SQLite migrated (12 tables) |

### Variable catalog

| Variable | Required (local dev) | Public/Secret | Purpose |
|----------|---------------------|---------------|---------|
| `NEXT_PUBLIC_SITE_URL` | Yes | Public | Site origin |
| `OAUTH_PUBLIC_BASE_URL` | Recommended | Public | OAuth redirect base |
| `DATABASE_URL` | Yes (SQLite path) | Config | Local SQLite (`file:./.data/waia.db`) |
| `AUTH_SESSION_MAX_AGE_SECONDS` | No | Config | Session cookie TTL (default 30d) |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Public | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod / Supabase path | **Secret** | Admin Supabase access |
| `DATABASE_URL_POSTGRES` | When `WAIA_DB_BACKEND=postgres` | **Secret** | Postgres pooler/direct URI |
| `WAIA_DB_BACKEND` | Prod Workers | Config | `postgres` selects Postgres runtime |
| `WAIA_POSTGRES_PER_REQUEST_CLIENT` | No | Config | Workers per-request client (DEE-110) |
| `WAIA_POSTGRES_PREPARE_STATEMENTS` | No | Config | postgres.js prepared statements |
| `WAIA_PG_INTEGRATION` | No | Config | Enable integration tests locally/CI |
| `WAIA_AI_GATEWAY_FOUNDATION` | No | Config | Enable AI gateway path |
| `WAIA_AI_PROVIDER` | No | Config | `fake` or `openai-compatible` |
| `WAIA_AI_OPENAI_API_KEY` | Live Twin dialogue | **Secret** | OpenAI-compatible provider key |
| `WAIA_AI_OPENAI_BASE_URL` | No | Config | API base URL |
| `WAIA_AI_OPENAI_MODEL` | No | Config | Model id (prod: `gpt-5.5`) |
| `WAIA_AI_OPENAI_TEMPERATURE` | No | Config | Sampling (omitted for reasoning models) |
| `WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS` | No | Config | Provider timeout |
| `WAIA_AI_OPENAI_REASONING_MIN_COMPLETION_TOKENS` | No | Config | Reasoning model token floor |
| `WAIA_AI_OPENAI_PARSE_DIAGNOSTICS` | No | Config | Parse diagnostics logging |
| `WAIA_TWIN_DIALOGUE_CONTINUITY` | No | Config | Bounded replay mode |
| `WAIA_READINESS_WRITER` | No | Config | Demo readiness writer |
| `OPENAI_API_KEY` | Legacy | **Secret** | Not read by Twin gateway |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth optional | **Secret** | Google sign-in |
| `APPLE_*` | OAuth optional | **Secret** | Apple sign-in |
| `TELEGRAM_BOT_TOKEN` | OAuth optional | **Secret** | Telegram login |
| `NEXTJS_ENV` | Workers preview | Config | OpenNext env file selection |
| `PLAYWRIGHT_PORT` / `PLAYWRIGHT_BASE_URL` / `PLAYWRIGHT_REUSE_SERVER` | E2E only | Config | Playwright test harness |

### GitHub Actions env (CI)

- `DATABASE_URL=file:./.data/ci-*.sqlite` (per job)
- `NEXT_TELEMETRY_DISABLED=1`
- Postgres integration workflow: `DATABASE_URL_POSTGRES`, `WAIA_PG_INTEGRATION=1`

---

## 10. Missing knowledge that existed outside the repository

The following were **lost with the workstation** or live **only outside git** — not reconstructable from the repo alone:

| Category | What was lost / external | Recovery status (2026-06-09) |
|----------|--------------------------|--------------------------------|
| **Secret values** | `.env.local`, `.dev.vars` actual keys (OpenAI, Postgres pooler, Supabase service role, OAuth) | Templates restored; **values must be re-entered** from Supabase/OpenAI/provider dashboards |
| **Cursor memory** | Prior chat context, agent transcripts, unstaged plans (`.cursor/plans/` gitignored) | Not recoverable; use this doc + [`WAIA-OPERATING-MEMORY.md`](WAIA-OPERATING-MEMORY.md) |
| **Obsidian / vault originals** | Agent Society roadmap and constitutional drafts (provenance in [`constitutional-history/`](constitutional-history/)) | Canon exists in-repo; vault copies not required for execution |
| **GitHub Actions secrets** | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (if ever set) | `gh secret list` empty — **re-create if preview deploys needed** |
| **Production ops notebook** | Informal partner walkthrough notes, latency baselines, rollback decisions beyond docs | Partially in DEE-128/DEE-129 issue text; **verify live** in Cloudflare dashboard |
| **Supabase dashboard state** | Email auth settings, redirect URLs, RLS policies, pooler password rotation history | Checklist: [`docs/ops/DEE-59-SUPABASE-DASHBOARD-CHECKLIST.md`](../ops/DEE-59-SUPABASE-DASHBOARD-CHECKLIST.md) |
| **Local Docker Postgres** | Ephemeral validation DB (optional) | Docker **not installed** on recovery machine; optional for integration tests |
| **Partner / stakeholder context** | Who is “partner preview” audience, acceptance of ~10s latency observations | Referenced in DEE-129; not in repo |

**Not lost:** Application source, governance corpus, Linear project structure, Cloudflare Worker secrets (server-side), production deployment at `waia.life`.

---

## 11. Recommended next development milestone

**Milestone alignment:** Continue **post-partner-release hardening** under the spirit of **“WAIA v1 First Human Experience”** (78.57%) and close **Production Readiness v1** (77.14%) operational gaps — without expanding into DEE-130 adaptive dialogue or deferred modules ([`NON-GOALS.md`](NON-GOALS.md)).

**Recommended milestone focus (engineering):**

1. **DEE-129 delivery** — production latency attribution (read-only evidence + doc), branch topology verification, streaming behavior documented, Your Name verified or explicitly closed
2. **Migration spine continuity (DEE-92 / DEE-64)** — remaining `getDb()` route waves toward `getWaiaRuntimeDb()` where tracker directs; broad Postgres production sign-off remains deferred pending ops checklist

This keeps product stable on `waia.life` while finishing **measurement and honesty** work before performance optimization or dialogue architecture (DEE-130).

---

## 12. Recommended next Linear issue

**Primary candidate:** **[DEE-129](https://linear.app/deepsense/issue/DEE-129/partner-preview-hardening-and-runtime-performance-stabilization)** — highest-priority `Todo` in project WAIA.

**Preconditions before agent execution:**

1. **Resolve dual labels** (`product` + `backend`) — relabel or split per [`AGENTS.md`](../../AGENTS.md)
2. **Complete Task Contract gaps** — add explicit Files, Dependencies, Validation commands to the issue (or child issues)
3. **Confirm governance:** no prompt/model/walkthrough config changes in scope PRs

**Alternative if DEE-129 is blocked on Architect relabel:**

- Continue **[DEE-92](https://linear.app/deepsense/issue/DEE-92/waia-architectural-migration-log)** (In Progress) — documentation-only migration log updates reflecting current `dev`/`main` and DEE-95* status; lower product visibility but unblocks migration truth

**Not recommended as next agent pick without charter:**

- **DEE-130** (adaptive dialogue architecture) — explicitly out of DEE-129 scope; higher semantic risk
- New issues for deferred modules (Business, AI-Trader, Marketplace, agent society) — forbidden by [`NON-GOALS.md`](NON-GOALS.md)

---

## Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-06-09 | Initial recovery snapshot after workstation loss and local env restoration |

**Maintenance:** Update when material drift occurs (production deploy, branch policy change, Linear milestone closure). Do not duplicate migration forbidden shortcuts — link [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) instead.
