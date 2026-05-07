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

## Compatibility expectation

PRs merged under **older** written rules remain judged against **documents at merge time** unless a retrospective ADR mandates reinterpretation — document that in Linear + ADR.

## Related

[`ADR-POLICY.md`](ADR-POLICY.md)
