# Architecture Decision Records (ADR)

Incremental reasoning log.**Authoritative trackers** (`DEE-64`, `DEE-95*`) retain operational migration sequencing—ADRs complement with concise WHY snapshots.

**Sparse and selective:** Few ADRs beat a thick archive. **Missing an ADR** does **not** imply “no architectural intent”—many decisions stay clear enough in **product specs**, **governance docs**, **PR bodies**, and **Linear** without a numbered record.

See policy: [`../waia-governance/ADR-POLICY.md`](../waia-governance/ADR-POLICY.md)

| ID | Title | Status | Related |
|----|-------|--------|---------|
| [0001](0001-linear-aligned-branch-names-dee-prefix.md) | Linear-aligned branch naming (`dee-<NN>-<slug>`) | Accepted | DEE tooling hygiene |
| [0002](0002-staged-postgres-runtime-rollout-discipline.md) | Staged Postgres / split-runtime discipline | Accepted | `DEE-64`, `DEE-72`, `DEE-95*` |
| [0003](0003-stdout-runtime-route-telemetry.md) | Stdout-first runtime route telemetry | Accepted | `DEE-95f`, `DEE-95g` |
| [0004](0004-additive-governance-evolution.md) | Additive DEV OS governance evolution | Accepted | Governance wave PR |

Add rows as new decisions land.**Superseded** decisions keep file for history — index notes replacement.
