# ADR-0023: Execution Server as AI-TRADER-only execution plane

**Status:** Accepted  
**Date:** 2026-07-10  
**Linear:** DEE-406 (vNext Slice D1)

## Context

WAIA runs primarily on Cloudflare Workers (OpenNext) with Supabase Postgres as canonical shared state. AI-TRADER live order execution, persistent exchange sessions, and long-running `pnpm trader:live:*` CLIs require an **off-Cloudflare** host (`services/ai-trader-execution-host/`, BP-6/BP-7).

The vNext DEV OS audit asked whether the Execution Server is a general WAIA runtime or a specialized module plane. Repository evidence shows every `execution-host` reference lives under AI-TRADER paths only:

- `lib/trader/**`
- `services/ai-trader-execution-host/`
- `scripts/trader/live-cli.ts`
- `tests/unit/trader-bp6-execution-host-boundaries.test.ts`
- `.env.example` AI-TRADER execution host section
- `docs/ops/DEE-339-*`, `DEE-212-*` trader runbooks

No non-trader WAIA module (AI-Twin, Core auth, etc.) depends on the Execution Server today.

Stale code on the host is an operational risk: campaigns and live dispatch must refuse to start when checkout `HEAD` does not match an approved git SHA.

## Decision

**AD-1 — Plane separation**

1. **Cloudflare production Worker** (`waia-app` / `waia.life`) is the WAIA **control plane** and primary app runtime.
2. **Execution Server** is the AI-TRADER **execution plane only** — live orders, exchange sessions, host-resident trader CLIs.
3. **Supabase Postgres** is canonical shared **state** for app and trader data.
4. **Committed `replay-runs/**`** plus host `deployed-revision.json` are **evidence** — not canonical source code.

**AD-2 — Dependency rule**

No non-AI-TRADER module may depend on the Execution Server without a new ADR and Architect approval. Twin, Core, and general WAIA features stay on Worker + Postgres paths.

**AD-3 — Code pin**

Execution Server monorepo checkouts must be pinned to an explicit full git SHA before build, deploy, or campaigns. Read-only preflight (`scripts/ops/execution-server-preflight.sh`) enforces `HEAD == EXECUTION_SERVER_TARGET_SHA`.

**AD-4 — Human-only mutation**

Sync, build, deploy, rollback, SSH recovery, and live trading on the Execution Server are **HUMAN-ONLY**. Agents may run read-only preflight and health checks only when an approved plan lists `execution-server` validation.

**AD-5 — Secret residency**

Execution host secrets use operator-injected runtime config (separate KMS path). They must **not** use Cloudflare Secrets Store or appear in git, Docker image layers, or `wrangler.jsonc`.

## Consequences

**Positive**

- Clear separation of control plane (Worker) vs execution plane (host)
- Prevents scope creep of off-Cloudflare hosting into non-trader modules
- Stale-code guard becomes a enforceable contract before live operations

**Negative**

- AI-TRADER operators must maintain a second runtime (host + container) alongside Workers
- Future non-trader long-running jobs cannot reuse the Execution Server without ADR amendment

## Links

- [`../ops/EXECUTION-SURFACES.md`](../ops/EXECUTION-SURFACES.md) — surface `execution-server`
- [`../ops/EXECUTION-SERVER-RUNBOOK.md`](../ops/EXECUTION-SERVER-RUNBOOK.md) — operator procedures
- [`../ops/DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md`](../ops/DEE-339-BP6-EXECUTION-HOST-RUNBOOK.md)
- [ADR-0006 Repository strategy](0006-ai-trader-repository-strategy.md)
- [ADR-0017 Postgres-only trader MVP](0017-postgres-only-trader-mvp.md)
- [`../../services/ai-trader-execution-host/server.mjs`](../../services/ai-trader-execution-host/server.mjs)
