# ADR-0012 — Governance Integration: Founders Council apex authority and English canon

Status: Accepted
Date: 2026-06-21

## Context

WAIA Operations System v2.0 was ratified as the ecosystem-level constitution above the in-repo WAIA DEV OS (the Development subsystem). Phase 0 Governance Integration introduces an apex authority layer and a small set of cross-cutting governance rules. These decisions are durable and cross-document, so they warrant a concise WHY record beyond the constitutional-history acceptance artifact. This ADR records decisions **already accepted**; it introduces and reinterprets nothing.

## Decision

1. **Founders Council is the apex authority layer** (Aleksey Kalinichenko, Nataly Guseva), holding reserved decisions per [`../waia-governance/FOUNDERS-COUNCIL.md`](../waia-governance/FOUNDERS-COUNCIL.md).
2. **The Human Architect acts under delegation** from the Council for the development domain; it executes, but cannot make reserved decisions.
3. **English is the canonical governance language** (translations informational; English prevails), with a carve-out for verbatim product/UI copy and illustrative user-utterance examples.
4. **Repository-First Knowledge Strategy** is adopted; no second knowledge base in Phase 0–1 (see [`../waia-governance/SOURCES-OF-TRUTH.md`](../waia-governance/SOURCES-OF-TRUTH.md)).
5. **Governance Integration follows Additive-First methodology**: additive landing in PR1; authority reconciliation isolated to PR2; one concern per PR; clean single-revert rollback.

Binding effect of the authority layer lands with PR2 (GI-05); this ADR records the rationale, not the operational rewire.

## Consequences

+ Durable, auditable WHY for apex authority and cross-cutting rules. + Reversible, low-risk integration (additive-first). − Temporary transition window where authority docs are reconciled in PR2. Neutral: requires the doctrine stack (Acceptance v1.0 + v2.0) to be maintained without supersession.

## Links

- [`../waia-governance/constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](../waia-governance/constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md)
- [`../waia-governance/FOUNDERS-COUNCIL.md`](../waia-governance/FOUNDERS-COUNCIL.md)
- [`../waia-governance/SOURCES-OF-TRUTH.md`](../waia-governance/SOURCES-OF-TRUTH.md)
- [`../waia-governance/AGENT-CHARTER.md`](../waia-governance/AGENT-CHARTER.md)
- [`../waia-governance/WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md`](../waia-governance/WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md)
- [`../waia-governance/GOVERNANCE-VERSIONING.md`](../waia-governance/GOVERNANCE-VERSIONING.md)
