# Founders Council

## Status

**Canonical Governance Artifact.**

- **Class:** Additive, documentation-only, **T0**, fully revertible.
- **Authoring vs binding:** This artifact is created additively in **PR1 (GI-04)** and formalizes an already-ratified authority model (see [`FOUNDERS-COUNCIL-RATIFICATION-RECORD.md`](FOUNDERS-COUNCIL-RATIFICATION-RECORD.md)). The operational-canon edits that make this layer **binding** (authority hierarchy in [`AGENT-ROLES.md`](AGENT-ROLES.md), [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md), [`AGENTS.md`](../../AGENTS.md)) are performed in **PR2 (GI-05)**. Until PR2 merges, the existing operational canon governs and wins on conflict.
- **Scope:** This document defines governance authority only. It introduces no new authority structures and no new reserved-decision categories beyond those already approved.

---

## Purpose

The Founders Council is the **apex authority** of the WAIA ecosystem.

- **Relationship to WAIA:** The Council holds ultimate authority over the mission, constitutional integrity, and reserved decisions of the WAIA ecosystem.
- **Relationship to WAIA DEV OS:** WAIA DEV OS is the Development subsystem operating under the Council's authority. The Council does not perform day-to-day execution; it owns the boundaries within which execution occurs.
- **Relationship to governance:** This document names the authority above the Human Architect. It coordinates with, and does not override, the operational canon; on conflict the operational canon wins until amended by a Council-ratified change.

---

## Council Composition

Named members:

- Aleksey Kalinichenko
- Nataly Guseva

No other members are authorized. Any change to Council composition is a reserved decision (see Reserved Decisions) and requires unanimous approval.

**Authority basis:** The Council's authority is constitutional. The Human Architect and all execution roles act under delegation from, or within boundaries set by, the Council.

---

## Constitutional Responsibilities

The Council's high-level duties:

- **Protection of mission** — safeguard the mission and philosophy of WAIA from drift.
- **Protection of constitutional integrity** — ensure governance evolves only through the approved mutation procedure and that no document silently overrides the canon.
- **Protection of governance continuity** — preserve a coherent, auditable chain of authority and decisions across time.
- **Protection of community trust** — uphold transparency and the integrity of commitments made to the community.

These responsibilities are exercised through reserved decisions and delegation, not through direct execution.

---

## Reserved Decisions

The following categories are **reserved to the Founders Council** (consolidating already-approved reserved categories; no new categories are introduced):

- Mission, philosophy, Source Code of Consciousness, and Brand Book.
- **Constitutional amendments** and changes to the **authority model** or **governance restructuring**.
- **Gate authorization** — opening any agent gate (A -> B -> C -> D).
- **Agent authorization** — authorizing any agent identity.
- Tokens, tokenomics, the community token pool, and **treasury doctrine / structure**.
- **Equity structure**, strategic investors, asset sales, and the annual budget.
- Roadmap priority and **capital/attention allocation across product tracks**.
- Product portfolio composition and creation of new modules.
- Ecosystem architecture changes; adoption of new vendor or public runtime surfaces.
- **Council composition changes** and **dissolution decisions**.

No agent, employee, investor, or community member may make or alter a reserved decision. Reserved decisions are not resolved by the Human Architect.

---

## Decision Rules

- **Unanimity:** Reserved decisions require the unanimous approval of both Council members.
- **Status quo rule:** If the Council does not reach unanimity, the status quo holds and no change is enacted.
- **Disagreement handling:** Disagreement defaults to no change; it does not delegate the decision downward and does not authorize a partial or provisional change.

---

## Delegation

- **Human Architect authority:** The Council delegates day-to-day governance execution to the Human Architect — scope approval, merges, production posture, and execution of governance changes — as recorded in the operational canon.
- **Scope:** Delegation covers execution within the boundaries the Council sets. It does not include reserved decisions.
- **Limits:** The Human Architect may not make reserved decisions, open gates, authorize agents, or alter the authority model.
- **Revocation:** Delegation is granted by the Council and may be modified or revoked by the Council. Revocation is itself a Council act.

---

## Continuity

- Council authority is continuous; reserved decisions persist across sessions and personnel changes within the named composition.
- **Succession is reserved.** Any future change to composition or succession arrangement is a reserved decision requiring unanimous approval.
- **No automatic expansion.** The Council does not expand by default; growth of the governance body occurs only by explicit reserved decision.

---

## Relationship To Other Governance Documents

- [`WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md`](WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md) — Phase 0 System of Record (non-binding execution plan).
- [`FOUNDERS-COUNCIL-RATIFICATION-RECORD.md`](FOUNDERS-COUNCIL-RATIFICATION-RECORD.md) — record of GI-01/02/03 ratification.
- [`SOURCES-OF-TRUTH.md`](SOURCES-OF-TRUTH.md) — Sources-of-Truth doctrine (PR1 deliverable).
- [`AGENT-CHARTER.md`](AGENT-CHARTER.md) — Agent Charter doctrine / Gate A (PR1 deliverable).
- [`constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md) — Constitutional Acceptance Artifact (PR1 deliverable).
- Operational canon: [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md), [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), [`AGENT-ROLES.md`](AGENT-ROLES.md), repo-root [`AGENTS.md`](../../AGENTS.md).

---

## Amendment Policy

Amendment of this document requires **unanimous Founders Council approval**, a deliberate governance PR per [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md), and corresponding updates to any operational-canon document the change touches in the same PR.

> **Status reminder:** Canonical authority artifact; binding effect lands with PR2. On any conflict before then, the operational canon prevails.
