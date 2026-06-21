# Sources of Truth

## Status

**Canonical Governance Artifact.**

- **Class:** Additive, documentation-only, **T0**, fully revertible.
- **Authoring vs binding:** Created in **PR1 (GI-04)**; binding through the **PR2 (GI-05)** authority reconciliation. Until PR2 merges, the existing operational canon governs and wins on conflict.
- **Scope:** Defines the canonical Sources of Truth for WAIA Governance Integration Phase 0 and Phase 1. Introduces no new authority structures and no second knowledge base.

---

## Purpose

Sources of Truth exist so that, for any class of information, there is exactly **one** authoritative system. This prevents duplication, drift, and ambiguity, and makes every decision and artifact traceable to a single canonical origin.

---

## Core Principle

**Single-source-of-truth discipline.** Each information class has one canonical source. Derived copies, mirrors, or exports are never authoritative.

**Contradictions trigger STOP.** When a canonical source contradicts another source (or a derived copy contradicts its canonical origin), work halts and the contradiction is escalated per [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md). Silent reconciliation is not permitted.

---

## Development Source of Truth

**Cursor / this repository.** Code, architecture, technical documentation, governance corpus, and development state are canonical here.

- **Owner:** Human Architect (delegate).
- **Change authority:** Architect via PR; reserved matters escalate to the Founders Council.

---

## Operations Source of Truth

**Linear** (team DEE, project WAIA). Projects, issues, cycles, initiatives, and execution status are canonical here.

- **Owner:** Human Architect (delegate).
- **Change authority:** Architect. Structural changes (new projects, initiatives, cadence models) are gated and not part of Phase 0.

---

## Knowledge Source of Truth

**Repository-first.** The repository is the Knowledge Base for Phase 0 and Phase 1. Long-term organizational memory lives in `docs/**`, ADRs, the governance corpus, and constitutional history.

- **No second knowledge base.** No external Knowledge Base platform is adopted during Phase 0–1.
- **Deferral triggers:** an external KB becomes a candidate only when (a) a non-technical audience requires routine read access that should not depend on repository literacy, or (b) knowledge volume/audience exceeds what Markdown-in-repo can serve. Adopting any external KB is a reserved decision requiring an ADR and Founders Council approval.
- **Read-only exports allowed but non-canonical.** A rendered read-only export of governance docs is permitted for accessibility; it is never authoritative and does not constitute a second source of truth.

---

## Community Source of Truth

**Future layer only.** Discord, Linear Customer Requests, and Voice of Humanity remain **deferred** until Phase 1 authorization. They are not canonical sources during Phase 0 and are not stood up by this artifact.

---

## Financial Source of Truth

**Future layer only.** Treasury ledger, token registry, budget tracker, and KPI dashboard remain **Founders-reserved** and deferred. They are not canonical sources during Phase 0 and are not stood up by this artifact.

---

## Narrative Source of Truth

Source Code of Consciousness, Brand Book, the WAIA Operations System, and official module documentation are the canonical narrative sources.

- **Authority:** **Founders Council reserved.** Changes are reserved decisions.

---

## Conflict Resolution

Precedence on contradiction:

1. **Operational canon wins until amended.** `AGENTS.md`, [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md), [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), and the governance corpus govern execution and prevail over plans, records, and derived copies.
2. **Reserved decisions escalate to the Founders Council.** Any contradiction touching a reserved matter (per [`FOUNDERS-COUNCIL.md`](FOUNDERS-COUNCIL.md)) is escalated, not resolved at execution level.
3. **STOP on unresolved contradiction** per [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) — one-sentence question, contradicted documents, proposed risk tier, optional ADR title.

Canonical sources always prevail over derived copies and exports.

---

## Change Authority

| Source | Canonical system | Owner | Change authority |
|---|---|---|---|
| Development | Cursor / repository | Architect (delegate) | Architect via PR; reserved items -> Council |
| Operations | Linear (DEE / WAIA) | Architect (delegate) | Architect; structural changes gated |
| Knowledge | Repository-native | Architect (delegate) | Architect via PR; external KB deferred (reserved) |
| Community (future) | Discord / Customer Requests / Voice of Humanity | Council / community lead | Activated only in Phase 1+ |
| Financial (future) | Treasury / token registry / budget / KPI | **Founders Council** | Council only (reserved) |
| Narrative | Source Code of Consciousness / Brand Book / Ops System / module docs | **Founders Council** | Council only (reserved) |

---

## Relationship To Other Governance Documents

- [`WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md`](WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md) — Phase 0 System of Record.
- [`FOUNDERS-COUNCIL.md`](FOUNDERS-COUNCIL.md) — apex authority and reserved decisions.
- [`FOUNDERS-COUNCIL-RATIFICATION-RECORD.md`](FOUNDERS-COUNCIL-RATIFICATION-RECORD.md) — GI-01/02/03 ratification record.
- [`AGENT-CHARTER.md`](AGENT-CHARTER.md) — Agent Charter doctrine / Gate A (PR1 deliverable).
- [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md) — DEV OS constitution.
- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) — gates & escalation.
- Repo-root [`AGENTS.md`](../../AGENTS.md) — execution contract baseline.

> **Status reminder:** Canonical Sources-of-Truth artifact; binding effect lands with PR2. On any conflict before then, the operational canon prevails.
