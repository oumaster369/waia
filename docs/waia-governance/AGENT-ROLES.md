# Agent roles (defaults)

Human operators may overlap roles; below keeps **mental separation** aligned with Cursor commands and [`AGENTS.md`](../../AGENTS.md) **execution labels** (`frontend` | `backend` | `ai` | `infra` | `product` | `design` | `security`).

## Authority hierarchy

| Layer | Role | Authority |
|-------|------|-----------|
| **Final** | Human **WAIA Architect** | Product/architecture merges, rollout, governance mutation, escalation resolution, override per [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md). |
| **Coordination** | **WAIA Orchestrator Agent** (see below) | **Lightweight coordination** (sequencing, handoffs, suggestions, continuity)—**not** a command-authority layer; **never** substitutes for Architect approval gates. |
| **Execution** | Planner, Executor, Reviewer, migration/docs specialists | Implements within issue scope and labels. |

## Model selection policy (Cursor)

**Canonical classes:** [`MODEL-COST-POLICY.md`](MODEL-COST-POLICY.md) — version-agnostic `fast` / `mid` / `reasoning` (not pinned product versions).

**Principle:** Use the **cheapest class that can safely complete** the slice. Cursor product names below are **runtime equivalents**; remap when the IDE renames tiers.

| Class | Cursor equivalent | Typical use | Examples |
|-------|-------------------|-------------|----------|
| **`fast`** | Composer 2 | Low‑blast‑radius work | T0/T1-ish docs (`docs/**`), governance touch-ups, lightweight refactors with clear specs, Linear hygiene text, uncomplicated UI copy. |
| **`mid`** | Sonnet | Implementation & debugging | Most feature/backend work (`/implement`, `/test-and-fix`), non-trivial debugging when context is pinned, PR preparation with full local gates. |
| **`reasoning`** | Opus | Architecture-heavy or ambiguous reasoning | `/plan-feature`‑class planning, migration/runtime tradeoffs touching [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md), high‑risk ambiguity ([`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) escalation ladder), peer review **before merge** when Architect wants strongest model pass |

Escalate class **upward** when: requirements unclear, trackers contradict code, rollback is costly. Do **not** build automated model routing scripts — judgment only.

### WAIA Orchestrator Agent

**What it is (and is not):** A **governance/abstraction naming a coordination pattern**—**no** standalone service, bot, runtime, or Linear label. **Binding authority stays with Human WAIA Architect and merge humans**; the pattern is **realized by whomever is Planner/Executor in-session** (often the same maintainer sequencing handoffs)—not by a hidden “orchestration layer.”

A **conceptual coordinating role**—**workflow glue, not management**: no command authority over Planner/Executor; surfaces gaps and options for humans. Often a **small/cheap model on low-risk continuity slices** (e.g. Composer 2 when that still matches [`AGENT-ROLES.md`](AGENT-ROLES.md) model policy).

**Responsibilities:**

- Pick next safe task aligned with Linear + `[AGENTS.md](../../AGENTS.md)` selection rules (`TASK-LIFECYCLE.md`).
- Sanity-check **risk tier** against diff reality; flag mislabels before PR (`RISK-TIERS.md`, `PR-PROTOCOL.md`).
- Recommend **model class** per [`MODEL-COST-POLICY.md`](MODEL-COST-POLICY.md) for the next delegate or sub-step.
- Keep **workflow continuity**: plan artifact → branch → validation → PR body fields → merge handoff cues.
- **Linear continuity**: ensure issue ↔ PR linkage and closeout template intent after merge instructions (`LINEAR-GOVERNANCE.md`).
- **Escalation routing**: package STOP payloads (question, contradictions, tier, suggested ADR) toward Architect (`EXECUTION-CONTRACT.md`).
- **Handoffs**: Planner (Opus) vs Executor (Sonnet) vs docs/migration slices — crisp scope handover notes.
- **Post-merge continuity**: reminders for `POST-MERGE-PROTOCOL.md`, five-memory abbreviated closeout, follow-up issue stubs (never creates roadmap chaos alone).
- **Governance enforcement (soft):** points out violations of branching/PR/trace rules; cannot “approve” exemptions.
- **Semantic continuity (light touch):** flags tension across **product specs**, **`docs/waia-governance/**`**, **migration language**, and **AI-Twin terminology**—for PR/human visibility, **not** a second approval lane.

**Authority limits:**

- Cannot **override** human approval gates, merges, production rollout decisions, or product semantics.
- Cannot **authorize** irreversible architectural decisions (new vendors, rollout doctrine breaches, milestone chaos).
- Cannot **bypass** production gates, migration discipline, or [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md) requirements.

Orchestrator is **not** an extra Legal label — it overlays **workflow discipline**. Same operator may combine Orchestrator hat with Planner or Executor in small teams.

**Orchestrator ≠ pseudo-manager:** it does **not** issue binding task orders, tier overrides, or merge decisions—only recommends and packages context for Architect-owned gates.

## Planner

| | |
|--|--|
| **Mode** | Plan Mode (`/plan-feature`; **`reasoning`** class per [`MODEL-COST-POLICY.md`](MODEL-COST-POLICY.md) unless task is trivial) |
| **Owns** | Goals, citations, risks, file list proposals, explicit open questions |
| **Does not own** | Commits on `dev`, merges, rewriting product specs without Architect approval |

## Executor

| | |
|--|--|
| **Mode** | Agent Mode (`/implement`, `/test-and-fix`, `/prepare-pr`; **`mid`** class default for substantive code) |
| **Owns** | Code/doc edits on `dee-<NN>-<slug>`, commits, pushes, CI green locally |
| **Does not own** | Merge to protected branches, backlog reorder, closing parent migrations |

## Reviewer

| | |
|--|--|
| **Who** | Human + CI (`pnpm lint/typecheck/test/build`) + Bugbot-style feedback |
| **Owns** | Risk tier realism, contradiction with product/migration trackers, checklist on PR |

## Migration-focused executor

Issues touching `getWaiaRuntimeDb`, route wiring, Postgres env gates: treat labels as **`backend`/`infra`** per issue; consumes [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md) + trackers only — **never** silently widens rollout.

## Documentation agent

Produces `docs/**/*` artifacts per issue scope; aligns with [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md).

## Authority summary

| Action | Planner | Executor | Orchestrator | Human |
|--------|---------|----------|---------------|-------|
| Propose governance change | ✓ doc PR | ✓ | Surfaces gap | Approves merge |
| Emergency bypass | escalate | escalate | Packages context | ✓ [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md) |
| Merge PR | ✗ | ✗ | ✗ | ✓ |

**Human** = WAIA Architect / maintainer with merge rights; **Orchestrator never merges.**

## Related

- [`MODEL-COST-POLICY.md`](MODEL-COST-POLICY.md)
- [`AUTONOMOUS-EXECUTION-LOOP.md`](AUTONOMOUS-EXECUTION-LOOP.md)
- [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md)
