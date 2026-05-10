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

## Compatibility expectation

PRs merged under **older** written rules remain judged against **documents at merge time** unless a retrospective ADR mandates reinterpretation — document that in Linear + ADR.

## Related

[`ADR-POLICY.md`](ADR-POLICY.md)
