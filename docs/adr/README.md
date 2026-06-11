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
| [0005](0005-saas-as-superset-strategy.md) | SaaS-as-Superset strategy (fund as first tenant) | Accepted | AI-TRADER Baseline v1.2 |
| [0006](0006-ai-trader-repository-strategy.md) | AI-TRADER repository strategy (single repo, minimum evolution) | Accepted | AI-TRADER Baseline v1.2 |
| [0007](0007-targeted-rls-strategy.md) | Targeted RLS strategy (app-enforced primary) | Accepted | AI-TRADER Baseline v1.2 |
| [0008](0008-manual-billing-gate.md) | Manual billing gate for performance fees | Accepted | AI-TRADER Baseline v1.2 |
| [0009](0009-regulatory-posture.md) | Regulatory posture for managed trading + performance fees | Accepted (Posture) — gates external live trading | AI-TRADER Baseline v1.2 |
| [0010](0010-strategy-validation-gate.md) | Strategy Validation Gate (paper → live) | Accepted | AI-TRADER Baseline v1.2 |
| [0011](0011-single-operator-governance-model.md) | Single Operator Governance Model (replaces dual-control) | Accepted | AI-TRADER Baseline v1.2 |

Add rows as new decisions land.**Superseded** decisions keep file for history — index notes replacement.
