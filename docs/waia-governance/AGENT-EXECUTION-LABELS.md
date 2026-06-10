# Agent execution labels and ownership

Canonical ownership matrix for WAIA Linear issues. Agents must stay within their execution label scope.

**Router:** [`AGENTS.md`](../../AGENTS.md) · **Lifecycle:** [`TASK-LIFECYCLE.md`](TASK-LIFECYCLE.md)

Exactly **one** execution label per issue: `frontend` | `backend` | `ai` | `infra` | `product` | `design` | `security`. Zero or multiple → STOP.

## frontend

**Owns:** Next.js pages, components, layout, responsiveness, UI states, visual rendering, user-visible flows, E2E for user-visible flows.

**Does not own:** DB schema, backend logic, AI prompts, infrastructure, product definition.

**Path hints:** [`app/AGENTS.md`](../../app/AGENTS.md), `components/**`

## backend

**Owns:** API routes, server actions, database schema, persistence, auth implementation, server-side contracts.

**Does not own:** visual UI, UX copy, prompt design.

**Path hints:** [`db/AGENTS.md`](../../db/AGENTS.md), `app/api/**`, `lib/**` server modules

## ai

**Owns:** AI-Twin logic, prompts, memory structure, readiness scoring, personality model contracts, extraction/inference rules.

**Does not own:** UI, deployment infra.

**Path hints:** `lib/ai/**`, prompt envelopes in `docs/architecture/**`

## infra

**Owns:** CI/CD, environments, deployment, GitHub Actions, hosting setup, runtime configuration.

**Does not own:** product UI, feature logic unrelated to infra.

**Path hints:** `.github/**`, `wrangler*.jsonc`, `scripts/**`

## product

**Owns:** user flow definitions, task decomposition, acceptance criteria, unlock logic, behavioral rules, system requirements, architecture boundaries at product level.

**Does not own:** production UI, DB migrations, prompt execution code.

**Path hints:** `docs/product/**`

## design

**Owns:** layout decisions, interaction design, visual states, UX copy, component behavior specs.

**Does not own:** backend, DB, prompt logic, production UI unless explicitly stated.

**Rule:** `design` defines the experience; `frontend` implements it.

**Path hints:** `docs/design/**`, [`docs/DESIGN_OS_V1.md`](../DESIGN_OS_V1.md)

## security

**Owns:** auth risk review, secret handling, privacy boundaries, data protection constraints, security validation requirements.

**Does not own:** unrelated feature implementation.

## Agent isolation

If a task requires mixed ownership, split into multiple issues. Agents must not work outside their label, edit unrelated files, or expand scope without a new Linear issue.
