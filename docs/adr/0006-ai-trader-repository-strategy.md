# ADR-0006 — AI-TRADER repository strategy (single repo, minimum evolution)

Status: Accepted
Date: 2026-06-11

## Context

The AI-TRADER master spec proposed a standalone `ai-trader/` monorepo with `apps/`, `services/`, and `packages/`. The reality is a single, live Next.js application at the repo root (Drizzle, Supabase Auth, Cloudflare Workers via OpenNext). Large-scale repository restructuring is explicitly **not** an approved assumption, and the live AI-TWIN app must not be destabilized.

## Decision

Keep **one repository** and apply the **minimum evolution** required:

1. AI-TRADER UI is an `app/(trader)` route group inside the existing app; `trader.waia.life` is served via host-based rewrite. No separate frontend application in MVP.
2. Trader connector/intelligence/risk logic begins **inside** the existing app (`lib/trader/**`, `db/` schema additions) where it can run as route handlers / scheduled work.
3. **Turborepo is not adopted** now (and is not a hard requirement going forward). Lightweight **pnpm workspaces** are introduced **only** when the first long-running service is extracted (Roadmap Phase 6+), and only to share `db`/`shared-types` with Dockerized services.
4. A `services/` directory for off-Cloudflare Docker services is created only when a persistent execution loop / WebSocket session is unavoidable.

## Consequences

+ The live app stays stable; no premature complexity.
+ Satisfies the "one repo, no big restructuring" constraint.
+ Preserves a clean path to extract services later without rework.
− Some shared code temporarily lives in the Next app before extraction.
Neutral: deployment topology (Workers + off-Cloudflare services) is unchanged by repo layout.

## Links

- [AI-TRADER Master Spec v2](../ai-trader/AI-TRADER-MASTER-SPEC-v2.md)
- [AI-TRADER Roadmap v2](../ai-trader/AI-TRADER-ROADMAP-v2.md)
