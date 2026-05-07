# Linear — Architect handoff checklist

This repository cannot mutate your Linear workspace. Execute these **manually** in Linear when aligning board with WAIA DEV OS artifacts.

Reference plan §6 (“Linear recommendations”). Check items when completed.

---

## Milestones & grouping (Architect)

- [ ] Decide whether to add milestone **“WAIA DEV OS / Autonomous Execution Foundation”** narrowly scoped (docs+governance-only).
- [ ] If added, optionally create meta issue **WAIA DEV OS governance v1** listing links to [`docs/waia-governance/`](./README.md).

## Issues likely stale (`In Progress` → review)

Resolve per code+doc reality (**do not** bulk-close without skim):

| Issue id | Guidance |
|----------|----------|
| **DEE-7** | Product flow documented in [`../product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md) — verify status vs remaining delta. |
| **DEE-8** | Landing spec parity with [`../product/waia-landing.md`](../product/waia-landing.md) if scoped there. |
| **DEE-13** | Dashboard shell parity with [`../product/ai-twin-dashboard-shell.md`](../product/ai-twin-dashboard-shell.md). |

Recommended closeout convention: cite doc path(s) + merged PR URLs in finishing comment.

## Process alignment backlog

After workflow commands align (Batch that closes **DEE-57** pathway):

| Issue | Action |
|-------|--------|
| **DEE-57** | Close when branching/PR tooling matches [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md)+commands. |
| **DEE-56** | Close when governance hub references stable in AGENTS/overview. |

## Hygiene backlog (numbered roadmap issues)

Optional per-issue annotations (no reorder): supersession comments linking **DEE-72**, **DEE-95**, **Supabase rollout** realities.

## Todo vs `AGENTS.md`

Single decision logged in milestone comment or **`DEE-56`**: adopt `Todo` column **or** amend `AGENTS.md` backlog ordering language.

## Governance doc ↔ migration spine link

Pin comment on **DEE-92** pointing to [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md) & [`AUTONOMOUS-EXECUTION-LOOP.md`](AUTONOMOUS-EXECUTION-LOOP.md) for onboarding.
