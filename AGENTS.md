# AGENTS.md

Repository-specific execution contract for AI coding agents. **Router only** — detailed canon lives in **`docs/waia-governance/**`**, **`docs/product/**`**, ADRs, and **`.cursor/rules/*`**.

---

## Governance hub

| Resource | Location |
|---------|----------|
| WAIA DEV OS constitution | [`docs/waia-governance/WAIA-DEV-OS.md`](docs/waia-governance/WAIA-DEV-OS.md) |
| WAIA DEV OS architecture specification (primary DEV OS organization canon; T0 documentation; does not own product meaning or module runtime architecture) | [`docs/waia-governance/WAIA-DEV-OS-ARCHITECTURE-SPECIFICATION.md`](docs/waia-governance/WAIA-DEV-OS-ARCHITECTURE-SPECIFICATION.md) |
| North Star | [`docs/waia-governance/WAIA-NORTH-STAR.md`](docs/waia-governance/WAIA-NORTH-STAR.md) |
| Operating memory | [`docs/waia-governance/WAIA-OPERATING-MEMORY.md`](docs/waia-governance/WAIA-OPERATING-MEMORY.md) |
| MVP index | [`docs/product/WAIA-V1-MVP-SPEC.md`](docs/product/WAIA-V1-MVP-SPEC.md) |
| Execution contract + risk | [`docs/waia-governance/EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md), [`RISK-TIERS.md`](docs/waia-governance/RISK-TIERS.md) |
| Linear + task lifecycle | [`docs/waia-governance/LINEAR-GOVERNANCE.md`](docs/waia-governance/LINEAR-GOVERNANCE.md), [`TASK-LIFECYCLE.md`](docs/waia-governance/TASK-LIFECYCLE.md), [`LIFECYCLE.md`](docs/waia-governance/LIFECYCLE.md) |
| Integration boundaries | [`docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md`](docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md) |
| Execution label ownership | [`docs/waia-governance/AGENT-EXECUTION-LABELS.md`](docs/waia-governance/AGENT-EXECUTION-LABELS.md) |
| Auto-advance preconditions | [`docs/waia-governance/AGENT-AUTO-ADVANCE.md`](docs/waia-governance/AGENT-AUTO-ADVANCE.md) |
| AI-TRADER bounded merge authority | [`docs/waia-governance/AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](docs/waia-governance/AI-TRADER-BOUNDED-MERGE-AUTHORITY.md) |
| Agent automation topology | [`docs/AGENT_AUTOMATION.md`](docs/AGENT_AUTOMATION.md) |
| Governance index | [`docs/waia-governance/README.md`](docs/waia-governance/README.md) |
| Canonical integration plans | [`docs/plans/README.md`](docs/plans/README.md) |
| DEE-518 implementation plan (approved 2026-08-10) | [`docs/plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md`](docs/plans/dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md) |
| Product completion specs | [`docs/waia-governance/PRODUCT-COMPLETION-SPEC-STANDARD.md`](docs/waia-governance/PRODUCT-COMPLETION-SPEC-STANDARD.md), [`docs/product-specs/`](docs/product-specs/) |
| Gap registries | [`docs/gaps/GAP-REGISTRY-STANDARD.md`](docs/gaps/GAP-REGISTRY-STANDARD.md) |
| Roadmaps (integration batches) | [`docs/roadmaps/ROADMAP-STANDARD.md`](docs/roadmaps/ROADMAP-STANDARD.md) |
| Roadmap autopilot (prep) | [`docs/waia-governance/ROADMAP-AUTOPILOT.md`](docs/waia-governance/ROADMAP-AUTOPILOT.md) |
| Execution surfaces | [`docs/ops/EXECUTION-SURFACES.md`](docs/ops/EXECUTION-SURFACES.md) |
| ADRs | [`docs/adr/README.md`](docs/adr/README.md) |

---

## Architecture corpus

Module/platform architecture (the "how it's built" canon, distinct from governance):

| Resource | Location |
|---------|----------|
| WAIA Core Architecture (shared platform — identity, tenancy, entitlements, payments, audit; wins on conflict) | [`docs/waia-core/WAIA-CORE-ARCHITECTURE.md`](docs/waia-core/WAIA-CORE-ARCHITECTURE.md) |
| AI-TRADER corpus (index → vision, master spec, scope, roadmap, program, security, billing, integration, journey) | [`docs/ai-trader/README.md`](docs/ai-trader/README.md) |
| AI-TRADER Product Constitution (product-level canon — what the finished module is) | [`docs/AI-TRADER-PRODUCT-CONSTITUTION.md`](docs/AI-TRADER-PRODUCT-CONSTITUTION.md) |
| AI-TRADER Master Spec v2 (governing technical spec) | [`docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md`](docs/ai-trader/AI-TRADER-MASTER-SPEC-v2.md) |
| AI-TRADER Target Runtime Architecture (completed-system runtime topology and end-to-end algorithm; subordinate to Product Constitution and Master Spec; documentation target only, not implementation scope) | [`docs/ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md`](docs/ai-trader/AI-TRADER-TARGET-ARCHITECTURE.md) |
| AI-TRADER Implementation Program v1.2 (execution blueprint → Linear) | [`docs/ai-trader/AI-TRADER-IMPLEMENTATION-PROGRAM.md`](docs/ai-trader/AI-TRADER-IMPLEMENTATION-PROGRAM.md) |
| ADR corpus (AI-TRADER decisions = ADR-0005 … ADR-0023) | [`docs/adr/README.md`](docs/adr/README.md) |

---

## When guidance conflicts

Recovery order — then escalate per [`EXECUTION-CONTRACT.md`](docs/waia-governance/EXECUTION-CONTRACT.md):

1. Product specs (`docs/product/**`)
2. Governance + ADRs (`docs/waia-governance/**`, `docs/adr/**`)
3. Migration trackers (`docs/migrations/**`)
4. Active Linear issue
5. Code/comments (may lag)

---

## TL;DR

1. Never push directly to `main` (frozen `dev` is not an active base — do not push there either).
2. Work on **`dee-<NN>-<slug>`** branched from **`main`**, linked to Linear; open **one PR to `main`**.
3. Never commit secrets.
4. Follow the lifecycle in [`LIFECYCLE.md`](docs/waia-governance/LIFECYCLE.md) without skipping steps; **PR = integration boundary** ([`INTEGRATION-BOUNDARY-POLICY.md`](docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md)). Multiple coherent work packages / `**Includes:**` children may land in one integration batch.
5. Linear project **WAIA** is the source of executable work.
6. Only atomic issues with exactly one execution label.
7. Missing detail blocks execution → STOP and ask.

---

## WAIA context

Delivery focus: **AI-Twin v1** + backend/runtime stabilization. Other ecosystem layers deferred — [`NON-GOALS.md`](docs/waia-governance/NON-GOALS.md).

AI-Twin builds a structured digital personality via dialogue, diary, and behavioral reflection. Core outputs: readiness (0–100%), personality structure, memory state, socialization readiness. Treat every feature as part of this system.

**Subsystem context:** [`app/AGENTS.md`](app/AGENTS.md) · [`db/AGENTS.md`](db/AGENTS.md) · [`lib/AGENTS.md`](lib/AGENTS.md)

---

## Branching and PR

- **Single trunk:** **`main`** — protected (local hook + GitHub rulesets). `dev` is frozen/retired (not deleted in-repo yet); not an active PR base.
- Branch from `origin/main`: `dee-<NN>-<slug>` · Commit: `DEE-NN type(scope): subject`
- Reference `DEE-NN` in branch, commits, PR title/body.
- Merge: Human by default. After DEE-653 is Human-merged, the acting AI-TRADER Program Controller may **squash-merge only eligible Step 0–22 implementation PRs** under the exact fail-closed admission contract in [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](docs/waia-governance/AI-TRADER-BOUNDED-MERGE-AUTHORITY.md). Governance, semantic, live/capital, holdout, security, production, T4, and other reserved actions remain Human-only.
- **Official release** = explicit Human tag/release of an exact `main` SHA — **not** `dev`→`main` promotion or `main`→`dev` back-sync (those are retired).
- Details: [`BRANCHING-STRATEGY.md`](docs/waia-governance/BRANCHING-STRATEGY.md), [`PR-PROTOCOL.md`](docs/waia-governance/PR-PROTOCOL.md), [`POST-MERGE-PROTOCOL.md`](docs/waia-governance/POST-MERGE-PROTOCOL.md)

---

## Required workflow

Canonical lifecycle: [`LIFECYCLE.md`](docs/waia-governance/LIFECYCLE.md) · Integration boundaries: [`INTEGRATION-BOUNDARY-POLICY.md`](docs/waia-governance/INTEGRATION-BOUNDARY-POLICY.md).

| Phase | Command | Mode | Model |
|-------|---------|------|-------|
| Groom *(optional)* | `/groom` | Plan / Ask | Opus |
| Decompose *(optional)* | `/decompose` | Plan | Opus |
| Plan | `/plan-feature` | Plan | Opus |
| Implement | `/implement` | Agent | Sonnet |
| Test & Fix | `/test-and-fix` | Agent | Sonnet |
| PR *(retry)* | `/prepare-pr` | Agent | Sonnet |
| Background green loop | `/bg-test-and-fix` | Background Agent | Sonnet |
| CI triage | `/fix-ci` | Background Agent | Sonnet |
| Diagnose deploy | `/diagnose` | Agent | Sonnet |
| Parallel fan-out | `/parallel-implement` | Agent | Sonnet |

**Default completion:** green `/test-and-fix` → PR readiness per [`.cursor/commands/prepare-pr.md`](.cursor/commands/prepare-pr.md) → close with the **agent completion protocol** report ([`POST-MERGE-PROTOCOL.md`](docs/waia-governance/POST-MERGE-PROTOCOL.md): Linear, branch, PR URL to `main`, CI, governance, merge disposition, post-merge sync of `origin/main`, optional recommendation for an explicit Human release tag, next task) → stop. Humans review/merge by default; only an admitted DEE-653 AI-TRADER implementation PR follows the bounded controller merge path.

**Auto-advance:** when all preconditions in [`AGENT-AUTO-ADVANCE.md`](docs/waia-governance/AGENT-AUTO-ADVANCE.md) hold, commit → push → Linear `In Review` → PR package without waiting.

Phases: Plan → Implement → Test & Fix (incl. PR readiness). Do not skip.

---

## Linear integration

- **Project:** WAIA · **Team:** DEE · **Workspace:** DeepSense
- Exactly **one** execution label — see [`AGENT-EXECUTION-LABELS.md`](docs/waia-governance/AGENT-EXECUTION-LABELS.md)
- Status flow: `Backlog` → `Todo` → `In Progress` → `In Review` → `Done`
- `In Review` at PR readiness; `Done` on merge (automated via [`.github/workflows/linear-done.yml`](.github/workflows/linear-done.yml) when `LINEAR_API_KEY` secret is set)
- Work selection: [`TASK-LIFECYCLE.md`](docs/waia-governance/TASK-LIFECYCLE.md)
- Task contract fields: Context, Goal, Scope, Do NOT, Acceptance Criteria, Files, Dependencies, Validation commands — use `/groom` to validate

---

## Validation

**During work packages:** targeted local validation (lint/typecheck/build + path-scoped or issue-scoped tests as appropriate).

**Local PR readiness** (before handoff):

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Plus **targeted tests** for changed surfaces, and `pnpm test:e2e` when UI/user-visible behavior changes.

**Authoritative full unit suite** (`pnpm test --run` / CI `unit tests`) runs on **GitHub PR CI** against PR HEAD. Do not require a redundant full local unit suite solely to duplicate that gate. After merge, sync `origin/main` — do not re-run the full suite on push/merge to `main` solely because the PR already passed CI.

Before PR readiness, run PR governance preflight on the rendered body: `./scripts/linear/preflight-pr-governance.sh` (see [`.cursor/commands/prepare-pr.md`](.cursor/commands/prepare-pr.md)). Regression tests: `pnpm validate:pr-governance`.
