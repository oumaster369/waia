# AGENTS.md

This file defines the repository-specific execution contract for all AI coding agents working on this codebase.

Read this file first before planning or implementing any change. **Operational routing hub** — detailed canon lives in **`docs/waia-governance/**`**, **`docs/product/**`**, and ADRs; extend rules there when policies change materially, then keep this file succinctly aligned.

---

# WAIA DEV OS — governance hub

| Resource | Location |
|---------|----------|
| **WAIA DEV OS constitution** | [`docs/waia-governance/WAIA-DEV-OS.md`](docs/waia-governance/WAIA-DEV-OS.md) |
| Product MVP onboarding (index) | [`docs/product/WAIA-V1-MVP-SPEC.md`](docs/product/WAIA-V1-MVP-SPEC.md) |
| Execution contract + tiers | [`docs/waia-governance/EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md), [`docs/waia-governance/RISK-TIERS.md`](docs/waia-governance/RISK-TIERS.md) |
| Roles & emergency override | [`docs/waia-governance/AGENT-ROLES.md`](docs/waia-governance/AGENT-ROLES.md), [`docs/waia-governance/HUMAN-OVERRIDE.md`](docs/waia-governance/HUMAN-OVERRIDE.md) |
| Governance docs index | [`docs/waia-governance/README.md`](docs/waia-governance/README.md) |
| Architecture decisions (ADR) | [`docs/adr/README.md`](docs/adr/README.md) |
| Principles & coherence | [`docs/waia-governance/CORE-PRINCIPLES.md`](docs/waia-governance/CORE-PRINCIPLES.md), [`docs/waia-governance/SYSTEM-MAP.md`](docs/waia-governance/SYSTEM-MAP.md) |

---

## When guidance conflicts (heuristic)

Use this **recovery order**, then escalate—see [`docs/waia-governance/EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md):

1. **Product specs** (`docs/product/**`) for user-visible meaning.
2. **Governance** (`docs/waia-governance/**`, ADRs) for process and boundary rules.
3. **Migration doctrine / trackers** for rollout truth ([`docs/waia-governance/MIGRATION-GOVERNANCE.md`](docs/waia-governance/MIGRATION-GOVERNANCE.md), `DEE-*` strategy docs).
4. **Linear issue** — executed scope on this task.
5. **Existing code/comments** — may lag; never override 1–3 silently.

**This file (`AGENTS.md`) vs execution contract:** per [`EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md), **this baseline wins unless a deliberate PR updates both**—the list above prioritizes interpretation, not a separate legal ladder.

---

# TL;DR

1. Never push directly to `main` or `dev`.
2. Always work from a **`dee-<NN>-<slug>`** branch linked to Linear and open a PR (see branching section).
3. Never commit secrets or environment values.
4. Follow the 4-phase workflow without skipping steps.
5. Linear project WAIA is the single source of truth for executable work.
6. Only work on issues that are atomic, unambiguous, and correctly labeled.
7. If the smallest missing detail blocks execution, stop and ask.

---

# WAIA Context (CRITICAL)

This repository is part of the WAIA ecosystem.

WAIA is not a standard application.

WAIA comprises **several named future ecosystem layers** (Business / 3P, AI-Trader, AI-Marketplace, AI-Twin)—**delivery focus here is deliberately narrow.**

**Delivered now:** AI-Twin **v1** plus **backend/runtime stabilization** aligned with MVP. Other named layers remain **explicitly deferred** unless a scoped product-issue expands scope—[`NON-GOALS.md`](docs/waia-governance/NON-GOALS.md).

## AI-Twin v1

AI-Twin is a system that builds a structured digital personality model of the user through:

- dialogue
- diary input
- behavioral reflection and pattern continuity anchored in readiness/product semantics (distinct from profiling-as-product inference as a standalone goal)


Core outputs:

- readiness model (0–100%)
- personality structure
- memory state
- socialization readiness

Agents must treat every feature as part of this system.

---

# Branching and PR Rules

- Never push directly to `main`
- Never push directly to `dev`
- Always create a **Linear-linked** branch (`dee-<NN>-<slug>`)
- Always open a PR
- Always reference the Linear issue ID in:
  - branch name
  - commit messages
  - PR title or PR body

Branch example:

`dee-37-implement-readiness-service`

Commit example:

`DEE-37 implement readiness calculation service`

---

# Required Workflow

Do not skip phases.


| Phase           | Command       | Mode       | Model  |
| --------------- | ------------- | ---------- | ------ |
| Plan            | /plan-feature | Plan Mode  | Opus   |
| Implement       | /implement    | Agent Mode | Sonnet |
| Test & Fix      | /test-and-fix | Agent Mode | Sonnet |
| PR *(optional)* | /prepare-pr   | Agent Mode | Sonnet |

**Default completion:** when `/test-and-fix` finishes successfully, the agent **immediately** executes **PR readiness** per [`.cursor/commands/prepare-pr.md`](.cursor/commands/prepare-pr.md): confirm clean tree, push the current **`dee-*`** branch to `origin` (set upstream if missing), provide compare URL **`dev…branch`**, PR creation URL (same compare flow), paste-ready title/body, report validation — then **stop**. Humans open/review the PR and merge; agents **never** merge. Invoke `/prepare-pr` only as a standalone retry without re-running tests.

Rules:

- Complete Plan before Implement
- Complete Implement before Test & Fix
- Complete Test & Fix (including default PR readiness) before considering the implementation task done
- If a phase fails, fix it before continuing

## Safe auto-advance after green validation

This subsection codifies the **default completion** semantics above. It does **not** waive any STOP, escalation, risk tier, merge, or governance gate; it only closes the gap between green validation and PR readiness when **all** preconditions hold.

When **every** precondition is satisfied, the agent continues automatically into **commit → push → Linear `In Review` → PR readiness** without waiting for a follow-up prompt.

### Preconditions (all required)

- Implementation finished and `/test-and-fix` gates green: `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, `pnpm build` — plus Playwright e2e when the change touches `app/**`, `components/**`, or user-visible behavior per [`.cursor/rules/30-testing.mdc`](.cursor/rules/30-testing.mdc).
- Diff contains **only in-scope files** for the active Linear issue. `git status` shows no unrelated dirty files.
- Branch name matches `dee-<NN>-<slug>` and the Linear ID `DEE-NN` resolves in the WAIA project.
- Risk tier per [`docs/waia-governance/RISK-TIERS.md`](docs/waia-governance/RISK-TIERS.md) does **not** require additional Architect approval (T0/T1 baseline; T2 only when the issue text does not call for an Architect hold; **never** T3/T4).
- No open STOP condition and no governance escalation in flight ([`docs/waia-governance/EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md)).
- No unresolved TODO/blocker comment in the diff or PR body.

### Authorized auto-advance (only when all preconditions hold)

- Commit in-scope changes with a Conventional Commits message including `DEE-NN` per [`docs/waia-governance/BRANCHING-STRATEGY.md`](docs/waia-governance/BRANCHING-STRATEGY.md) (use `git add` on **named** in-scope paths, not blanket `git add -A`, unless every dirty file is in scope).
- `git push -u origin <branch>` to set upstream on first push for the `dee-*` branch.
- Move the Linear issue to **`In Review`** (existing DEE status) and add a PR-ready comment linking the compare URL.
- Print the GitHub compare URL (`dev…<branch>`), PR create URL, paste-ready PR title (with `DEE-NN`), PR body, and validation summary per [`.cursor/commands/prepare-pr.md`](.cursor/commands/prepare-pr.md) and [`docs/waia-governance/PR-PROTOCOL.md`](docs/waia-governance/PR-PROTOCOL.md).
- **Stop.** Wait for a human to open / review / merge the PR.

### Never allowed under this rule

- `gh pr merge`, any auto-merge flow, or treating merge as the agent's call ([`docs/waia-governance/PR-PROTOCOL.md`](docs/waia-governance/PR-PROTOCOL.md), [`docs/waia-governance/RISK-TIERS.md`](docs/waia-governance/RISK-TIERS.md)).
- Direct push to `main` or `dev` ([`.cursor/rules/10-git-workflow.mdc`](.cursor/rules/10-git-workflow.mdc), [`docs/waia-governance/BRANCHING-STRATEGY.md`](docs/waia-governance/BRANCHING-STRATEGY.md)).
- Creating or using fabricated Linear IDs (`DEE-NN` must resolve in Linear; see [`docs/waia-governance/FAILURE-PATTERNS.md`](docs/waia-governance/FAILURE-PATTERNS.md) `FP-005`).
- Committing files outside the active issue's scope — open a new Linear issue instead.
- Proceeding when any required validation failed or was skipped ([`docs/waia-governance/FAILURE-PATTERNS.md`](docs/waia-governance/FAILURE-PATTERNS.md) `FP-002`).
- Bypassing human approval gates ([`docs/waia-governance/EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md)).
- Broadening scope after validation. Scope expansion requires a new Linear issue.
- Starting the next Linear issue automatically. Work selection remains a human-initiated step.
- Bypassing this rule's preconditions when any STOP condition is open or the constitutional doctrine (e.g. [`docs/waia-governance/constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](docs/waia-governance/constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md)) calls for an Architect hold.

If any precondition is **not** satisfied, do not auto-advance: surface the blocker, follow the `STOP` payload format in [`docs/waia-governance/EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md), and wait for the human.

---

# Linear Integration (CRITICAL)

Linear project WAIA is the only source of executable work.

Project reference:

- Workspace: DeepSense
- Team: DEE
- Project: WAIA
- Slug: `waia-ec7442967ce7`

Rules:

1. Only execute work from project WAIA
2. Every executable issue must have exactly one execution label from this set:
  - `frontend`
  - `backend`
  - `ai`
  - `infra`
  - `product`
  - `design`
  - `security`
3. No other label may define execution ownership
4. Non-execution labels (`qa`, `architect`, etc.) may exist, but must not define task ownership
5. If no execution label is present, stop and ask
6. If more than one execution label is present, stop and ask
7. Follow issue dependencies strictly
8. If `Dependencies` is empty, treat the issue as unblocked
9. Update issue status using the real DEE workflow:
  - `Backlog` → `Todo` → `In Progress` → `In Review` → `Done`
  - `In Review` is the existing DEE status entered when PR readiness completes (see [Safe auto-advance after green validation](#safe-auto-advance-after-green-validation)); `Done` is set after merge per [`docs/waia-governance/POST-MERGE-PROTOCOL.md`](docs/waia-governance/POST-MERGE-PROTOCOL.md).
10. `Canceled` and `Duplicate` are terminal states
11. Do not invent missing statuses (e.g. a `Ready` status that does not exist in Linear). DEE statuses currently include `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`.

---

# Work Selection Rules

When choosing what to work on inside WAIA, prefer this order:

1. `Todo`
2. `In Progress` only if explicitly continuing owned work
3. `Backlog` only when asked to define, decompose, or prepare work
4. Never pull from `Done`, `Canceled`, or `Duplicate` for implementation

Priority order inside the same status:

- Higher priority first
- Then explicit dependencies
- Then oldest unblocked issue

---

# Task Contract (MANDATORY)

Each executable Linear issue must contain:

- exactly one execution label
- Context
- Goal
- Scope
- Do NOT
- Acceptance Criteria
- Files
- Dependencies
- Validation commands

If one of these is missing and the issue is not safely executable, stop and ask for the smallest missing detail.

---

# Task Decomposition Rules

Each issue must describe exactly one verifiable outcome.

## Bad

- Build AI-Twin
- Implement onboarding system
- Finish dashboard

## Good

- Create dashboard sidebar layout
- Render readiness indicator cards
- Implement readiness calculation service
- Add Diary unlock threshold check
- Save diary entry to persistence layer

Rules:

- One issue = one result
- One issue = one owner
- One issue = one validation target
- Prefer the smallest shippable step
- Prefer decomposition over mixed-responsibility work

---

# Agent Isolation

Agents must stay within the scope of their execution label.

If a task requires mixed ownership, split it into multiple issues.

Agents must not:

- work outside their execution label
- edit unrelated files
- mix UI, backend, AI, and infra work in one task
- expand scope without an issue that explicitly allows it

---

# Execution Labels and Ownership

## frontend

Owns:

- Next.js pages
- components
- layout
- responsiveness
- UI states
- visual rendering
- implementation of user-visible flows
- E2E coverage for user-visible flows

Does not own:

- DB schema
- backend logic
- AI prompts
- infrastructure
- product definition

## backend

Owns:

- API routes
- server actions
- database schema
- persistence
- auth implementation
- server-side contracts

Does not own:

- visual UI
- UX copy
- prompt design

## ai

Owns:

- AI-Twin logic
- prompts
- memory structure
- readiness scoring logic
- personality model contracts
- extraction and inference rules

Does not own:

- UI
- deployment infra

## infra

Owns:

- CI/CD
- environments
- deployment
- GitHub Actions
- hosting setup
- runtime configuration

## product

Owns:

- user flow definitions
- task decomposition
- acceptance criteria
- unlock logic definition
- behavioral rules
- system requirements
- architecture boundaries at product-system level

Does not own:

- production UI implementation
- DB migrations
- prompt execution code

## design

Owns:

- layout decisions
- interaction design
- visual states
- UX copy
- component behavior specs

Does not own:

- backend implementation
- DB
- prompt logic
- production UI implementation unless explicitly stated

Rule:

- `design` defines the experience
- `frontend` implements the experience

## security

Owns:

- auth risk review
- secret handling rules
- privacy boundaries
- data protection constraints
- security validation requirements

Does not own:

- unrelated feature implementation

---

# Validation Rules

Before opening a PR, run full validation:

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

