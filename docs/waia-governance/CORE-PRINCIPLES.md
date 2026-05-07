# WAIA DEV OS — Core principles

**Status:** Operational ethos for autonomous and human-guided development.

## What WAIA is building (now)

Focus stays on **AI-Twin v1** and **backend/runtime stabilization** (split SQLite/Postgres, staged rollout per migration docs). Longer WAIA ecosystem layers (Business/3P, AI-Trader, AI-Marketplace) stay **named but not pursued** unless a product-issue explicitly expands scope — see [`NON-GOALS.md`](NON-GOALS.md).

## Principles

| Principle | Meaning |
|-----------|---------|
| **Reversible incrementalism** | Prefer small PRs whose rollback is obvious. |
| **Modular future** | Do not block future modules; do not implement them early. |
| **Trust and auditability** | Work leaves traces: PR, Linear, docs, ADRs when policy changes (see [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md)). |
| **Product canon wins** | If governance text disagrees with [`docs/product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md), fix governance or escalate — never silently override product flow. |
| **Migration doctrine is external to governance prose** | [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md) **links** [`../migrations/DEE-64-TRACKER.md`](../migrations/DEE-64-TRACKER.md) and `DEE-95*` docs; governance does not restate forbidden shortcuts as new rules. |
| **No autonomous merge** | Agents prepare PRs; humans authorize merge (see [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)). |
| **Governance minimalism** | Prefer **few durable rules** over wide predictive process. **Governance cuts ambiguity**, not imitation org complexity — inflation guard per [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) / [`ADR-POLICY.md`](ADR-POLICY.md). |

## Autonomy safety (summary)

Autonomy is appropriate when work is **incremental**, **reversible**, and **semantically stable**. Escalate when ambiguity is high, rollback is hard, or product/migration philosophy could shift — see [`RISK-TIERS.md`](RISK-TIERS.md) and [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md).

## Related

- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) — binding agent/human contract.
- [`NON-GOALS.md`](NON-GOALS.md) — scope boundaries.
- [`AGENT-ROLES.md`](AGENT-ROLES.md) — role defaults.
