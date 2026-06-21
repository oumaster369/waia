# Governance versioning (lightweight)

**Purpose:** Remember **what changed** in WAIA DEV OS protocols and **what superseded what**, without semver ceremony.

## Current convention snapshot

| Area | Documented intent (as of governance landing) |
|------|-----------------------------------------------|
| Branch naming (target) | `dee-<NN>-<slug>` per [`BRANCHING-STRATEGY.md`](BRANCHING-STRATEGY.md); legacy `feature/*` deprecated when tooling aligns. |
| Execution contract entry | [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) + repo root [`AGENTS.md`](../../AGENTS.md) — **`AGENTS.md` wins on conflict unless a single PR updates both.** |
| ADR index | [`../adr/README.md`](../adr/README.md) |

Append a row when materially changing the above.

## Supersession chain

Prefer **ADR** [`Supersedes`](ADR-POLICY.md) links for rationale that must survive churn. Governance edits that only reorganize wording need a short bullet here referencing the merge PR.

| Date | Change | Supersedes / links |
|------|--------|---------------------|
| 2026-05-07 | Initial WAIA DEV OS governance landing: canonical `docs/waia-governance/**`, execution contract pairing with [`AGENTS.md`](../../AGENTS.md), ADR index bootstrap—additive evolution per **ADR-0004**. | [ADR-0004](../adr/0004-additive-governance-evolution.md), [ADR-0001](../adr/0001-linear-aligned-branch-names-dee-prefix.md); merge commit in git history |
| 2026-05-10 | **Constitutional canonization** of Agent Society lineage: new [`constitutional-history/`](constitutional-history/README.md) (VISION roadmap + ADVISORY review + **DOCTRINE Acceptance v1.0**) and discoverability pointer [`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md). **Additive only** — no operational-canon changes; `AGENTS.md`, `AGENT-ROLES.md`, `NON-GOALS.md`, `EXECUTION-CONTRACT.md` deliberately untouched. Authorizes **Gate A** (Agent Charter Doctrine) as a future Architect-initiated milestone; does **not** authorize agent identities, runtime, telemetry, or any change outside `docs/`. ADR for Gate A deferred to that milestone's PR. | [`constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md), [ADR-0004](../adr/0004-additive-governance-evolution.md) |
| 2026-05-11 | **Safe auto-advance after green validation** (workflow refinement, DEE-108): [`AGENTS.md`](../../AGENTS.md) §"Required Workflow" gains a "Safe auto-advance" subsection enumerating preconditions, authorized actions, and never-allowed actions; [`.cursor/commands/test-and-fix.md`](../../.cursor/commands/test-and-fix.md) makes the in-scope commit step explicit before PR readiness; [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md) records `FP-008` (dirty tree after green validation). **Additive only** — `EXECUTION-CONTRACT.md`, `RISK-TIERS.md`, `HUMAN-OVERRIDE.md`, `PR-PROTOCOL.md`, `POST-MERGE-PROTOCOL.md`, and [`.cursor/commands/prepare-pr.md`](../../.cursor/commands/prepare-pr.md) deliberately untouched. **Authorizes** automatic commit → push → Linear `In Review` → PR readiness only when all preconditions hold; **does not** authorize auto-merge, direct push to `main`/`dev`, scope expansion, bypass of STOP/escalation, or T3/T4 promotion. Below ADR threshold per [`ADR-POLICY.md`](ADR-POLICY.md) "When to skip ADR". | DEE-108, merge PR (TBD) |
| 2026-06-21 | **Phase 0 — Governance Integration (PR1, GI-04), additive landing.** Canonizes WAIA Operations System v2.0 as **Ecosystem Constitution / Strategic Vision** above the executable Governance Core. New artifacts: [`constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md) (DOCTRINE — Acceptance v2.0, **doctrine stack** with v1.0, disjoint scope, no supersession), [`FOUNDERS-COUNCIL.md`](FOUNDERS-COUNCIL.md), [`FOUNDERS-COUNCIL-RATIFICATION-RECORD.md`](FOUNDERS-COUNCIL-RATIFICATION-RECORD.md), [`SOURCES-OF-TRUTH.md`](SOURCES-OF-TRUTH.md), [`AGENT-CHARTER.md`](AGENT-CHARTER.md) (Gate A milestone), [`FUTURE-GOVERNANCE-BACKLOG.md`](FUTURE-GOVERNANCE-BACKLOG.md), [`WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md`](WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md) (non-binding execution plan). English-canon rule added to [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md). **Additive only** — `AGENTS.md`, `AGENT-ROLES.md`, `EXECUTION-CONTRACT.md`, `NON-GOALS.md` deliberately untouched; **Founders Council / Sources of Truth authority reconciliation and English-canon binding effect deferred to PR2 (GI-05).** Does **not** authorize any gate, agent identity, runtime, telemetry, or Linear/operational change. Fully revertible (T0). | [ADR-0012](../adr/0012-governance-integration-founders-council-and-english-canon.md), [`constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md), [ADR-0004](../adr/0004-additive-governance-evolution.md); PR1 merge (TBD) |

## Compatibility expectation

PRs merged under **older** written rules remain judged against **documents at merge time** unless a retrospective ADR mandates reinterpretation — document that in Linear + ADR.

## Related

[`ADR-POLICY.md`](ADR-POLICY.md)
