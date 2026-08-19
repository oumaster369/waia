# Execution contract (WAIA DEV OS)

**Binding layer:** This document refines how work should run. Repo root [`AGENTS.md`](../../AGENTS.md) remains the **baseline**; on conflict, **`AGENTS.md` wins** unless a deliberate PR updates **both** [`AGENTS.md`](../../AGENTS.md) and this file.

## Model selection (guidance — not automated)

See [`MODEL-COST-POLICY.md`](MODEL-COST-POLICY.md) and [`AGENT-ROLES.md`](AGENT-ROLES.md).

**Rule of thumb:** **`fast`** for cheapest safe path; **`mid`** for substantive implementation; **`reasoning`** for architecture, migration ambiguity, and high‑stakes planning/review. Tie selection to [`RISK-TIERS.md`](RISK-TIERS.md) class hints.

No requirement to log model name in every PR — only when helpful for audit (e.g., high tier).

## Coordinating role: WAIA Orchestrator Agent

**Naming only—no runnable authority:** Describes a human-led coordination **pattern** in [`AGENT-ROLES.md`](AGENT-ROLES.md): **may** organize task choice, handoffs, escalation packaging, continuity—**never** waived gates or Architect-owned decisions. **No** detached agent/service implied.

If sequencing output conflicts with Architect direction, **Architect wins**; update docs or ADR if the precedent should persist.

## Human approval gates (summary)

Agents **propose** changes; **Architect/operator** retains final say on:

| Gate | Examples |
|------|----------|
| **Product semantics** | MVP scope, unlock/readiness meaning, privacy guarantees, user journey — see product docs. |
| **Architecture / infra** | New vendors, DB/topology, rollout/staging policy, telemetry semantics, migration doctrine deviation. |
| **Roadmap autonomy** | Bulk reorder, delete parents, speculative future modules detached from MVP — see [`NON-GOALS.md`](NON-GOALS.md). |
| **Merge** | Human by default. The acting AI-TRADER Program Controller has only the post-DEE-653, exact-head, fail-closed Step 0–22 implementation exception defined in [`AI-TRADER-BOUNDED-MERGE-AUTHORITY.md`](AI-TRADER-BOUNDED-MERGE-AUTHORITY.md); semantic, holdout, capital/live, security, production, Execution Server, T4, and unapproved T3 changes remain Human-only. |
| **Governance mutation** | Rewriting this contract, branch policy, PR policy, Linear semantics. |
| **Production rollout** | Broad Postgres enablement, env mass changes, rollback policy — see [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md). |

## Escalation (`STOP` conditions)

If coherence is unclear—not only **architecture/infra** but **semantic ambiguity**, **product-intent contradiction**, fuzzy **AI-Twin behavioral** expectations, **autonomy-/Society-boundary** uncertainty, or mixed signals among readiness model, user flow, trackers, or execution labels—STOP and surface:

1. Question in one sentence  
2. Contradicted docs + links  
3. Proposed **risk tier** (see [`RISK-TIERS.md`](RISK-TIERS.md))  
4. Suggested ADR title if policy clarifies long-term behavior  

Typical material tension: [`../product/ai-twin-user-flow.md`](../product/ai-twin-user-flow.md) vs [`../product/ai-twin-readiness-model.md`](../product/ai-twin-readiness-model.md) vs code—extend the same STOP pattern when **meaning** diverges across [`WAIA-V1-MVP-SPEC`](../product/WAIA-V1-MVP-SPEC.md) / [`GLOSSARY.md`](GLOSSARY.md) / implementation.

## Emergency bypass

See [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md).

## Supporting docs

- [`AGENT-ROLES.md`](AGENT-ROLES.md)
- [`FAILURE-PATTERNS.md`](FAILURE-PATTERNS.md)
- [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md)

## Autonomy heuristic

| Usually safe | Escalate early |
|--------------|----------------|
| T0/T1 isolated changes, tests green | T3/T4 or migration route uncertainty |
| Links + docs align with existing trackers | Product threshold debate |
| Rollback = single revert | Mixed execution labels in one issue |
