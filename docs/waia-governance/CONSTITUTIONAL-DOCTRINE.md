# Constitutional doctrine — pointer

**Status:** Discoverability layer over the constitutional artifacts in [`constitutional-history/`](constitutional-history/README.md). **This file does not introduce new binding rules.** It points at the artifacts that do.

The operational canon ([`WAIA-DEV-OS.md`](WAIA-DEV-OS.md), [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md), [`AGENTS.md`](../../AGENTS.md), [`AGENT-ROLES.md`](AGENT-ROLES.md), [`NON-GOALS.md`](NON-GOALS.md), [`RISK-TIERS.md`](RISK-TIERS.md), [`LINEAR-GOVERNANCE.md`](LINEAR-GOVERNANCE.md), [`MIGRATION-GOVERNANCE.md`](MIGRATION-GOVERNANCE.md), [`HUMAN-OVERRIDE.md`](HUMAN-OVERRIDE.md)) remains the source of binding day-to-day governance. The constitutional artifacts explain **why** that canon is shaped the way it is and **how** it is permitted to evolve.

---

## 1. Status semantics

Three statuses apply to artifacts under [`constitutional-history/`](constitutional-history/README.md):

| Status | Meaning | Binding? |
|--------|---------|----------|
| **VISION** | Aspirational reference. Inspires; does not authorize engineering scope. | No |
| **ADVISORY** | Analytical record (e.g. constitutional review). Informs; does not bind. | No |
| **DOCTRINE** | Architect-accepted constitutional acceptance artifact. Binds within the limits its own articles declare. Does **not** silently override the operational canon (see §3). | Yes (within scope) |

Each artifact in `constitutional-history/` declares its own status header.

---

## 2. Doctrine stack (active)

Doctrine is **not** a single linear head. WAIA DEV OS carries a **doctrine stack**: two accepted DOCTRINE artifacts with **disjoint scopes**. Neither supersedes the other; each binds only within its own scope.

| Doctrine | Artifact | Scope | Status |
|----------|----------|-------|--------|
| **Acceptance v1.0** | [`constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md`](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md) | **Agent Governance Foundation** — agent doctrine, Gate A–D model, "Agents may comment. Humans decide." | DOCTRINE |
| **Acceptance v2.0** | [`constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md) | **Governance Integration Foundation** — WAIA Operations System v2.0 intake, Founders Council layer, Sources of Truth, English canon | DOCTRINE |

> **"v2.0" is not a successor index to "v1.0".** It denotes acceptance of *WAIA Operations System v2.0* as the Ecosystem Constitution / Strategic Vision above the executable Governance Core. The two acceptances **coexist**; v2.0 leaves every v1.0 agent constraint intact.

**Supporting artifacts (non-doctrine):**

| Slot | Artifact | Status |
|------|----------|--------|
| **Underlying review** | [`constitutional-history/2026-05-10-constitutional-review.md`](constitutional-history/2026-05-10-constitutional-review.md) | ADVISORY |
| **Source vision** | [`constitutional-history/2026-05-10-agent-society-roadmap.md`](constitutional-history/2026-05-10-agent-society-roadmap.md) | VISION |

**Read order for high-context sessions:** both doctrine artifacts → underlying review → source vision. For day-to-day execution, consult the operational canon directly. Authority reconciliation for the Founders Council / Sources of Truth layer lands in **PR2 (GI-05)**; until then the operational canon governs.

---

## 3. Hierarchy on conflict

When constitutional doctrine and operational canon disagree, the **operational canon wins** unless a deliberate PR updates both. This mirrors the [`AGENTS.md`](../../AGENTS.md) ↔ [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) supersession rule and is restated explicitly in Closing Clause C.2 of the active doctrine artifact.

In practice: a doctrine article that *describes* a future operational change does not, by its own existence, *make* that change. Operational changes still require their own scoped Linear issue, branch, and PR.

---

## 4. Carry-forward principles (advisory restatement)

These principles are **already binding via the active doctrine artifact**; they are restated here only for discoverability. The authoritative wording lives in `2026-05-10-constitutional-acceptance-v1.0.md` Article 3 and Article 6.

> **Agents may comment. Humans decide.**

- All agent activity is **event-triggered** — no persistent / always-on loops.
- Agents do not author or mutate governance documents.
- Agents do not open, approve, merge, or auto-merge PRs.
- Agents do not change Linear state beyond comments authorized by their charter.
- No multi-agent councils, voting, negotiation, or consensus formation.
- Agents do not act on user PII or AI-Twin product user data.
- Each agent identity has a documented kill-switch executable within one working session.
- Each agent identity is realized through a machine identity (OAuth app / API key), not a human seat.
- WAIA DEV OS exists to safely build the WAIA AI-Twin product. It is not the product. AI-Twin v1 remains the primary engineering priority.

---

## 5. Gate model (status snapshot)

| Gate | Name | Authorization status |
|------|------|----------------------|
| **A** | Doctrine — Agent Charter & roadmap demotion | Charter **authored** additively in PR1 ([`AGENT-CHARTER.md`](AGENT-CHARTER.md)); **binding from PR2**. No agent identity, runtime, or gate execution authorized. See [Article 4](constitutional-history/2026-05-10-constitutional-acceptance-v1.0.md#article-4--approved-next-bounded-milestone) of Acceptance v1.0. |
| **B** | Single Advisory Identity (read + comment only) | Not authorized. Awaits Gate A merge + Charter prerequisites (Article 5). |
| **C** | Telemetry baseline (observation only) | Not authorized. Awaits Gate B observable stability. |
| **D** | Selective enforcement / second advisory identity | Not authorized. Awaits Gates B and C. |

The Gate Model is **strictly sequential** per active-doctrine Article 1.1.

---

## 6. Mutation procedure

Constitutional doctrine evolves only through:

1. A new dated artifact under [`constitutional-history/`](constitutional-history/README.md) (append-only; prior artifacts are not edited).
2. A corresponding entry in [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md) recording supersession.
3. An ADR under [`../adr/`](../adr/README.md) when the precedent should outlive a single PR ([`ADR-POLICY.md`](ADR-POLICY.md) §"Semantic / product pivots").
4. Deliberate updates to any operational-canon documents the new doctrine touches, in the **same PR** that lands the new doctrine artifact.

Constitutional drafting is **human-only** (Architect). Agents may *cite* constitutional artifacts in PRs and Linear comments per active doctrine, but may not author or amend them.

---

## 7. What this file does not do

- It does **not** create new operational rules.
- It does **not** authorize Gate B, Gate C, or Gate D.
- It does **not** create agent identities, OAuth applications, telemetry, or runtime.
- It does **not** modify [`AGENTS.md`](../../AGENTS.md), [`AGENT-ROLES.md`](AGENT-ROLES.md), [`NON-GOALS.md`](NON-GOALS.md), or [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md). Those updates are scope of the Article 4 / Gate A milestone and require their own PR.

---

## Related

- [`constitutional-history/README.md`](constitutional-history/README.md) — folder index, lineage rules.
- [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md) — supersession log.
- [`ADR-POLICY.md`](ADR-POLICY.md) — when a precedent warrants an ADR.
- [`DOCUMENTATION-STANDARDS.md`](DOCUMENTATION-STANDARDS.md) — five-memory closeout & semantic continuity.
- [`README.md`](README.md) — governance docs index.
