# Constitutional history

**Purpose:** Preserve the lineage of constitutional artifacts that define how WAIA DEV OS evolves. This folder is the **canonical record** of governance-level deliberation that crosses normal docs/ADR boundaries — vision proposals, formal reviews, and binding acceptance artifacts.

**Status conventions** (each artifact in this folder declares its own header):

| Status | Meaning | Binding? |
|--------|---------|----------|
| **VISION** | Philosophical reference / aspirational direction. Inspires; does not authorize. | No |
| **ADVISORY** | Analytical record of a constitutional review. Informs; does not bind. | No |
| **DOCTRINE** | Architect-accepted constitutional acceptance artifact. Binds within the limits its own articles declare. | Yes (within scope) |

**Read order for new agent sessions** (high-context only — most sessions do not need this folder):

1. The most recent **DOCTRINE** artifact (binding).
2. The **ADVISORY** review that produced it (rationale).
3. The **VISION** artifact under review (source).

For day-to-day execution, the **operational canon** in [`../README.md`](../README.md) is sufficient; this folder is consulted only when an agent or human needs to understand *why* the operational canon is shaped the way it is.

---

## Index

| Date | Artifact | Status | Source |
|------|----------|--------|--------|
| 2026-05-10 | [`2026-05-10-agent-society-roadmap.md`](2026-05-10-agent-society-roadmap.md) | **VISION** | Authored in Obsidian (`WAIA GOV/waia_dev_os_agent_society_roadmap_en.md`) |
| 2026-05-10 | [`2026-05-10-constitutional-review.md`](2026-05-10-constitutional-review.md) | **ADVISORY** | Constitutional review of the roadmap (`WAIA GOV/waia_dev_os_constitutional_review.md`) |
| 2026-05-10 | [`2026-05-10-constitutional-acceptance-v1.0.md`](2026-05-10-constitutional-acceptance-v1.0.md) | **DOCTRINE** (Acceptance v1.0) | Architect-level acceptance (`WAIA GOV/waia_dev_os_constitutional_acceptance.md`) |

---

## Lineage rules

- **Append-only.** Constitutional artifacts are not edited in place after acceptance. Supersession is recorded by adding a new dated artifact and updating [`../GOVERNANCE-VERSIONING.md`](../GOVERNANCE-VERSIONING.md).
- **Status promotion is one-way.** A VISION artifact may inform a future DOCTRINE artifact, but the VISION file's status header is not retroactively rewritten — a new DOCTRINE artifact is added.
- **Doctrine supersedes itself, not the operational canon.** A new DOCTRINE artifact (e.g. Acceptance v1.1) supersedes the prior DOCTRINE artifact in this folder. It does not silently override `WAIA-DEV-OS.md`, `EXECUTION-CONTRACT.md`, `AGENTS.md`, or any other operational canon — those changes still require their own deliberate PRs per [`../DOCUMENTATION-STANDARDS.md`](../DOCUMENTATION-STANDARDS.md).
- **No agent may author or mutate files in this folder.** Constitutional drafting is human-only (Architect). Agents may *cite* artifacts here in PRs and Linear comments per the active doctrine.

---

## Relationship to the rest of governance

| Layer | Where it lives | Authority |
|-------|----------------|-----------|
| Constitutional artifacts | `docs/waia-governance/constitutional-history/**` | Architect-authored; folder is append-only. |
| Constitutional pointer / status semantics | [`../CONSTITUTIONAL-DOCTRINE.md`](../CONSTITUTIONAL-DOCTRINE.md) | Discoverability layer; introduces no new binding rules of its own. |
| Operational canon | `docs/waia-governance/*.md` (root level) | Binding day-to-day governance — `WAIA-DEV-OS.md`, `EXECUTION-CONTRACT.md`, etc. |
| Architectural WHY log | [`../../adr/`](../../adr/) | Sparse decision records; pair with constitutional artifacts when a precedent must outlive a single PR. |
| Repo-root execution contract | [`../../../AGENTS.md`](../../../AGENTS.md) | Wins on conflict unless a deliberate PR updates both. |

---

## Audit footer

This folder was created as part of the **Constitutional Canonization** governance milestone, per Article 7 of `2026-05-10-constitutional-acceptance-v1.0.md`. The acceptance artifact authorized canonization but did **not** authorize implementation expansion, agent identities, runtime, telemetry, or any change outside `docs/`.
