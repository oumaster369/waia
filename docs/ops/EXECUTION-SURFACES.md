# WAIA execution surfaces

**Owner:** Architect · **Status:** Canonical · **Linear:** DEE-406 (D1), DEE-409 (D2 tooling)

Defines every environment where WAIA work may execute, who may act there, what evidence is produced, and which actions are **HUMAN-ONLY**. Canonical plan frontmatter uses the same surface ids in `executionSurfaces: [...]`.

**Related:**

- [`EXECUTION-SERVER-RUNBOOK.md`](EXECUTION-SERVER-RUNBOOK.md) — AI-TRADER execution plane operations
- [`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) — AUTO / CONFIRM / HUMAN-ONLY
- [`CURSOR-ENVIRONMENT.md`](CURSOR-ENVIRONMENT.md) — Cursor account restoration
- [`AGENTS.md`](../../AGENTS.md) — agent execution contract router
- [ADR-0023](../adr/0023-execution-server-ai-trader-only-execution-plane.md) — Execution Server scope

---

## Surface index

| Surface id | Primary actor | Mutates live infra? | Evidence |
|------------|---------------|---------------------|----------|
| `local` | Developer | No (local only) | Local logs (gitignored) + committed fixtures |
| `cursor-agent` | Operator / Composer | No (feature branch only) | `.cursor/agent-log.jsonl` (gitignored) |
| `github-actions` | Repository CI | No (ephemeral runners) | GitHub Actions run URL + artifacts |
| `cloudflare-preview` | Operator | No (isolated preview Worker) | Preview URL + deploy logs |
| `cloudflare-production` | Human | **Yes** (production Worker) | `release.yml` + Cloudflare deploy history |
| `supabase-postgres` | Infra / operator | **Yes** (schema + data) | Migrations + Supabase advisors/logs |
| `execution-server` | Human operator | **Yes** (off-Cloudflare host) | `replay-runs/**` + host logs + `deployed-revision.json` |

**No other execution surface exists.** If work requires a new surface, add it here and in the canonical plan schema before use.

---

## `local`

**Purpose:** Default developer workstation — implement, validate, and reproduce behavior before integration.

| Aspect | Rule |
|--------|------|
| **Who** | Any engineer with a clone |
| **Typical actions** | `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build`, local SQLite (`DATABASE_URL=file:./.data/waia.db`) |
| **Secrets** | `.env.local` / `.dev.vars` (gitignored) |
| **Agents** | AUTO — local tests and builds on feature branches |
| **Evidence** | Terminal output; optional committed test fixtures under `tests/` |

**Not for:** production deploy, live trading, Execution Server mutation, or canonical Postgres campaign state without explicit plan approval.

---

## `cursor-agent`

**Purpose:** Cursor Agent / Composer execution inside the WAIA repository contract.

| Aspect | Rule |
|--------|------|
| **Who** | Operator running Agent, Plan, or Background Agent modes |
| **Typical actions** | `/implement`, `/test-and-fix`, `/prepare-pr`, documentation edits, feature-branch commits |
| **Boundaries** | Hooks ([`.cursor/hooks/guard-shell.sh`](../../.cursor/hooks/guard-shell.sh)) block force-push and direct push to `main`; agents never merge |
| **MCP** | Linear (`plugin-linear-linear`), Supabase, Cloudflare, Playwright per [`CURSOR-ENVIRONMENT.md`](CURSOR-ENVIRONMENT.md) |
| **Agents** | AUTO on feature branch; CONFIRM for scope/plan promotion; HUMAN-ONLY for merge and host mutation |
| **Evidence** | `.cursor/agent-log.jsonl` (gitignored); PR body; canonical plan `state` in `docs/plans/` |

---

## `github-actions`

**Purpose:** Independent integration gate — validates every PR without relying on a developer machine.

| Aspect | Rule |
|--------|------|
| **Who** | GitHub Actions on `oumaster369/waia` |
| **Workflows** | `ci.yml` (lint, typecheck, test, build, tenant-isolation), `pr-governance.yml`, `cloudflare-preview.yml`, `linear-done.yml`, `release.yml` (on `main`) |
| **Secrets** | Repository secrets only (`LINEAR_API_KEY`, `CLOUDFLARE_*`, etc.) — never in git |
| **Agents** | AUTO — CI runs on push/PR; agents do not mutate workflow secrets |
| **Evidence** | Actions run URL; check status on PR |

**Required before merge:** blocking checks green per [`.github/rulesets/main-protection.json`](../../.github/rulesets/main-protection.json).

---

## `cloudflare-preview`

**Purpose:** Ephemeral OpenNext Worker deploy for PR review — runtime and public-behavior checks without touching production.

| Aspect | Rule |
|--------|------|
| **Who** | Operator reviewing a PR; workflow `cloudflare-preview.yml` |
| **Deploy target** | Isolated preview Worker (`waia-app-pr-<N>`) |
| **Limitations** | File SQLite / `better-sqlite3` may fail on Workers until persistence is Postgres-only — see [`cloudflare-preview-deploys.md`](../cloudflare-preview-deploys.md) |
| **Agents** | AUTO — bundle job; preview deploy when secrets configured; `/diagnose` read-only via Cloudflare MCP |
| **Evidence** | PR comment marker `<!-- waia-cloudflare-preview -->` + preview URL |

**Not for:** production data mutation or live trading.

---

## `cloudflare-production`

**Purpose:** Production WAIA app at `waia.life` — OpenNext on Cloudflare Workers from `main`.

| Aspect | Rule |
|--------|------|
| **Who** | Human only |
| **Deploy path** | **Before** merging single-trunk bootstrap PR `#456`, Human must complete READ-ONLY Cloudflare Workers Builds preflight for `waia-app` and Architect must select Contract A or B ([`SINGLE-TRUNK-CUTOVER.md`](./SINGLE-TRUNK-CUTOVER.md)). Then: Human squash-merges to `main`; optional explicit Human release tag of that SHA; `release.yml` / manual `pnpm cloudflare:deploy`. **Workers Builds Git integration is observed active for `waia-app`.** |
| **Worker** | `waia-app`; Secrets Store for `AI_TRADER_MASTER_KEY` per [DEE-220 runbook](./DEE-220-MASTER-KEY-RUNBOOK.md) |
| **Agents** | HUMAN-ONLY — production deploy; agents never mutate Cloudflare dashboard settings |
| **Evidence** | Cloudflare Workers versions & deployments; `release.yml` run; operator-local Cloudflare preflight record |

**Never a test surface.** Validation belongs on `local`, `github-actions`, or `cloudflare-preview`.

---

## `supabase-postgres`

**Purpose:** Canonical shared application and campaign state for AI-TRADER MVP (Postgres-only for new trader code per ADR-0017).

| Aspect | Rule |
|--------|------|
| **Who** | Infra operator; long-running CLI campaigns on session/direct pooler |
| **Connection modes** | Transaction pooler `:6543` for Workers; session pooler / direct `:5432` for multi-hour CLI (DEE-399) |
| **Typical actions** | Targeted SQL apply on `waia-prod`; migrations via approved batches; Supabase MCP advisors |
| **Agents** | CONFIRM for schema changes; HUMAN-ONLY for production data mutation |
| **Evidence** | `db/migrations/**`; Supabase migration history; advisor output |

See [`postgres-development.md`](../postgres-development.md) and `.env.example` `DATABASE_URL_POSTGRES*` section.

---

## `execution-server`

**Purpose:** Off-Cloudflare AI-TRADER **execution plane** — the bounded Historical Simulation V2 consumer today; live order paths remain separately Human-gated. **AI-TRADER only** (ADR-0023).

| Aspect | Rule |
|--------|------|
| **Host** | Isolated VPS (reference id: `waia-org0-exec` / `waia-org0-execution`) |
| **Service** | `services/ai-trader-execution-host/` — health + supervised one-shot durable Historical Simulation V2 consumer, exact-SHA bound |
| **Code pin** | Full monorepo checkout **only** when pinned to an explicit git SHA; campaigns refuse stale/unknown code |
| **Secrets** | Operator-injected constrained runner LOGIN URI — **separate KMS path**, not Cloudflare Secrets Store; no owner/live/exchange credential path |
| **Agents** | Read-only preflight only when plan lists it; **HUMAN-ONLY** for sync/build/deploy/rollback |
| **Evidence** | Committed `replay-runs/**`; host logs; `deployed-revision.json` on host |

Host filesystem state is **operational**, not canonical engineering memory — Git remains source of truth.

**Operator runbook:** [`EXECUTION-SERVER-RUNBOOK.md`](EXECUTION-SERVER-RUNBOOK.md)  
**Stale-code guard:** [`scripts/ops/execution-server-preflight.sh`](../../scripts/ops/execution-server-preflight.sh) (read-only)  
**Mutation tooling (HUMAN-ONLY, `--confirm` required):**

| Script | Purpose |
|--------|---------|
| [`execution-server-sync.sh`](../../scripts/ops/execution-server-sync.sh) | Pin checkout to approved SHA |
| [`execution-server-build.sh`](../../scripts/ops/execution-server-build.sh) | Build execution-host image + CLI deps |
| [`execution-server-deploy.sh`](../../scripts/ops/execution-server-deploy.sh) | Deploy container + write `deployed-revision.json` |
| [`execution-server-rollback.sh`](../../scripts/ops/execution-server-rollback.sh) | Roll back to prior known-good revision |

Without `--confirm`, each script is a no-op (prints planned actions, exit 0).

---

## Classifying work by surface

When grooming or planning an integration batch:

1. List every surface touched in canonical plan `executionSurfaces: [...]`.
2. If any surface is HUMAN-ONLY for the planned actions, document the human checkpoint in the plan and PR body.
3. Required validation on `execution-server` surfaces: run read-only preflight when applicable ([`INTEGRATION-BOUNDARY-POLICY.md`](../waia-governance/INTEGRATION-BOUNDARY-POLICY.md) §Integration-ready contract).

---

## Quick reference — agent permissions by surface

| Surface | Composer AUTO | Composer CONFIRM | HUMAN-ONLY |
|---------|---------------|------------------|------------|
| `local` | dev + validation | — | — |
| `cursor-agent` | implement, test, PR prep | scope/plan changes | merge |
| `github-actions` | (CI runs automatically) | workflow edits | — |
| `cloudflare-preview` | bundle; read-only diagnose | — | — |
| `cloudflare-production` | — | — | deploy |
| `supabase-postgres` | read-only MCP | schema approval | prod data ops |
| `execution-server` | read-only preflight | — | sync/build/deploy/rollback/live trading |

---

*Last updated: 2026-07-10 — vNext Slice D2.*
