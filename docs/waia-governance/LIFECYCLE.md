# WAIA DEV OS — canonical lifecycle

**Owner:** Architect · **Status:** Canonical · **Supersedes:** fragmented 4/8/12-step descriptions as the single lifecycle reference.

This document is the **one lifecycle** for WAIA work. Other docs (`AGENTS.md`, [`AUTONOMOUS-EXECUTION-LOOP.md`](AUTONOMOUS-EXECUTION-LOOP.md), [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md) §4) **point here** for the end-to-end flow.

---

## Core invariant

**One integration Linear issue = one canonical plan = one primary branch = one PR = one merge event.**

`linear-done.yml` closes only the explicit `**Linear:**` id on merge. Child issues listed under `**Includes:**` are never auto-closed.

---

## Phases (Cursor commands)

| Phase | Command | Mode | Purpose |
|-------|---------|------|---------|
| Groom *(optional)* | `/groom` | Plan / Ask | Validate task contract |
| Decompose *(optional)* | `/decompose` | Plan | Work-packages / child issues |
| Plan | `/plan-feature` | Plan | Draft → promote canonical plan |
| Implement | `/implement` | Agent | Code on `dee-<NN>-<slug>` |
| Test & Fix | `/test-and-fix` | Agent | Green gates + integration-ready |
| PR *(retry)* | `/prepare-pr` | Agent | Push + PR body + preflight |
| Background | `/bg-test-and-fix`, `/fix-ci` | Background | Unattended green loop / CI triage |
| Diagnose | `/diagnose` | Agent | Workers deploy investigation |
| Parallel | `/parallel-implement` | Agent | Independent issues in worktrees |

**Default completion:** green `/test-and-fix` → PR readiness → agent completion report → **stop before merge**. Humans review and merge; agents wait for explicit confirmation before the next integration batch.

See [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) for when a PR opens (integration-ready contract) and [`AGENT-AUTO-ADVANCE.md`](AGENT-AUTO-ADVANCE.md) for safe auto-advance preconditions.

---

## Linear status flow

`Backlog` → `Todo` → `In Progress` → `In Review` → `Done`

| Event | Linear status |
|-------|---------------|
| Plan approved / work starts | `In Progress` |
| Integration-ready PR opened | `In Review` |
| Human merge to `dev` | `Done` (via `linear-done.yml` when configured) |

---

## Integration batch lifecycle (fewer PRs)

1. **Scope approval** — human approves integration issue, plan, risk tier, execution surfaces, acceptance criteria.
2. **Implementation loop** — many work packages, local commits, branch pushes — **no PR yet**.
3. **Validation loop** — repeat `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` (+ e2e when UI) until green.
4. **Synchronize** — merge `origin/dev` into feature branch per [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) §Branch sync (never force-push a published branch).
5. **Integration-ready** — all acceptance criteria met; PR body prepared; `preflight-pr-governance.sh` passes.
6. **One PR** — agent opens exactly one PR; sets Linear `In Review`; **stops**.
7. **Human merge** — effective `merged` state is **derived** (PR merged + Linear `Done`); no status-only follow-up commit required ([`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) §Post-merge reconciliation).

---

## Bootstrap (before canonical plans exist)

Until `docs/plans/` is established (vNext Slice C), Slices A and B use the master Build program + Linear issue + branch + commits + PR as resumption sources — not a per-slice canonical plan file.

After Slice C: each integration batch uses `docs/plans/dee-<NN>-<slug>.md` with `state.status` as the resumption primitive.

---

## Intake (product-spec → gap → roadmap → plan)

Before opening a new integration batch, trace intent through the layered canon:

1. **Completion spec** — measurable *done* for the module ([`PRODUCT-COMPLETION-SPEC-STANDARD.md`](PRODUCT-COMPLETION-SPEC-STANDARD.md)).
2. **Gap registry** — record what is missing vs the spec ([`../gaps/GAP-REGISTRY-STANDARD.md`](../gaps/GAP-REGISTRY-STANDARD.md)).
3. **Roadmap** — sequence integration batches with `batchId` → `DEE-NNN` ([`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md)).
4. **Canonical plan** — mutable execution state for the approved batch ([`../plans/README.md`](../plans/README.md)).

Bootstrap batches may skip layers 1–3 when explicitly Architect-approved; document `n/a` in the PR **Plan:** field with rationale.

---

## Pointers (non-duplicative)

| Topic | Canonical doc |
|-------|-----------------|
| Branching / merge method | [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md) |
| PR body / governance | [`PR-PROTOCOL.md`](PR-PROTOCOL.md), [`.github/pull_request_template.md`](../../.github/pull_request_template.md) |
| Post-merge hygiene | [`POST-MERGE-PROTOCOL.md`](POST-MERGE-PROTOCOL.md) |
| 12-step detail map | [`AUTONOMOUS-EXECUTION-LOOP.md`](AUTONOMOUS-EXECUTION-LOOP.md) |
| Action classification | [`INTEGRATION-BOUNDARY-POLICY.md`](INTEGRATION-BOUNDARY-POLICY.md) |
| Product completion specs | [`PRODUCT-COMPLETION-SPEC-STANDARD.md`](PRODUCT-COMPLETION-SPEC-STANDARD.md), [`../product-specs/`](../product-specs/) |
| Gap registries | [`../gaps/GAP-REGISTRY-STANDARD.md`](../gaps/GAP-REGISTRY-STANDARD.md) |
| Roadmaps (integration batches) | [`../roadmaps/ROADMAP-STANDARD.md`](../roadmaps/ROADMAP-STANDARD.md) |
