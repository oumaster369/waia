# Linear governance — WAIA (DEE)

## Project + team anchoring

- **Team:** DeepSense (`DEE`)  
- **Project:** WAIA (`slug` per [`AGENTS.md`](../../AGENTS.md))  

Only WAIA-listed execution issues should funnel autonomous coders unless Architect delegates.

## Labels

Exactly **one** execution label assigns ownership (`frontend`, `backend`, `ai`, `infra`, `product`, `design`, `security`). Auxiliary labels (`qa`, `architect`, …) do **not** replace execution assignment.

Multiple or zero execution labels → STOP per [`AGENTS.md`](../../AGENTS.md).

## Status semantics

Ideally Backlog → Todo → In Progress → In Review → Done. Boards lacking `Todo` should document actual flow in issue comment pinned by Architect — reconcile with [`AGENTS.md`](../../AGENTS.md) via future doc PR if mismatched prolonged.

Terminal: `Canceled`, `Duplicate`.

## Dependencies

Honor explicit dependency graph — empty Dependencies means unblocked for planning only (still obey label ownership).

## Agent-created issues

Allowed for narrowly scoped follow-ups: must include identical task contract scaffolding as [`AGENTS.md`](../../AGENTS.md). Parent under **DEE-92** (migration spine), **DEE-72** (persistence), or existing product/feature root — forbid orphan speculative epics.

**Semantic root:** Follow-up issues must **not** silently redefine **AI-Twin semantics**, **readiness progression**, **autonomy boundaries**, or **Society interaction rules**. If scope implies that, record **Architect visibility** (**comment / assign**) **or** link a merged PR, spec, or governance discussion—or split scope so the Linear card stays mechanical-only (see [`TASK-LIFECYCLE.md`](TASK-LIFECYCLE.md)).

## Anti-chaos

- Agents do **not** bulk reprioritize portfolio.  
- Migration waves named “DEE-95 phase …” cite strategy docs in description.

## Done closeout (five-memory abbreviated)

Paste short checklist referencing PR merge link:

```
Impl: merged PR #
Arch: ADR ____ / none (why)
Ops: runbook/env note / none
Mig: DEE-64/TRACKERS touched sentence / untouched
Gov: EXECUTION_CONTRACT touched y/n
```

Detailed matrix in [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md).

## Related operational checklist (human)

Architect actions that must happen **in Linear app** live in [`LINEAR-ARCHITECT-NEXT-STEPS.md`](LINEAR-ARCHITECT-NEXT-STEPS.md) (handoff checklist).
