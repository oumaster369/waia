# WAIA Governance Integration Master Plan v1.0
### Single Source of Truth for Phase 0 Governance Integration

---

## Document status (read first)

- **Status:** **Phase 0 System of Record** — **Non-Binding Execution Plan.**
- **This document is NOT constitutional doctrine.** It is **NOT** part of the constitutional doctrine stack in [`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) and does not appear in [`constitutional-history/`](constitutional-history/README.md). It records and sequences already-approved decisions; it does not create, amend, or interpret governance.
- **Version / Date:** 1.0 — 2026-06-21.
- **Canonical language:** English (authoritative; translations informational).
- **PR class:** Suitable for **PR1 — Additive Constitutional Layer**. This file introduces **no authority rewiring, no doctrine change, no operational behavior change, no gate activation, and no agent authorization.** Those are out of scope for this artifact.
- **Authority basis:** Consolidates WAIA Operations System v2.0, the Governance Integration Plan, Review v2, the Safe Implementation Assessment, the Execution Backlog, and the Foundation Transition Readiness Review.

### Canonical-Wins Clause

This is a planning and record artifact. The following remain **authoritative** and **prevail on any conflict** with this document:

- the Constitutional Acceptance Artifact ([`constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md`](constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md), created in PR1)
- [`FOUNDERS-COUNCIL.md`](FOUNDERS-COUNCIL.md) (created in PR1; binding from PR2)
- [`SOURCES-OF-TRUTH.md`](SOURCES-OF-TRUTH.md) (created in PR1)
- [`AGENT-CHARTER.md`](AGENT-CHARTER.md) (created in PR1)
- [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md)
- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md)
- the operational canon and repo-root [`AGENTS.md`](../../AGENTS.md)

If this Master Plan and any canonical governance document disagree, **the canonical governance document wins** and this Master Plan is corrected to match. This document never silently overrides the canon.

> Note on cross-references: several canonical docs above are themselves **PR1 deliverables** authored alongside this file (GI-04). Until PR1 lands them, links to those files are forward references to planned artifacts, not assertions of current repository state.

---

## 1. Executive Summary

### 1.1 Purpose of Phase 0
Phase 0 — Governance Integration installs **WAIA Operations System v2.0 as the ecosystem-level constitution** above the existing in-repo **WAIA DEV OS (the Development subsystem)**, without destabilizing current operations. It is **documentation-only (T0)**: it establishes Founders Council authority, the Sources-of-Truth doctrine, the Agent Charter (Gate A), the v2.0 Acceptance Artifact, and the consolidated principle and risk layers — and nothing operational.

### 1.2 Success definition
Phase 0 succeeds when the constitution is canonized, the authority hierarchy is unambiguous, all v2.0 claims are tier-classified, the English Canon and Repository-First strategies are in force, Gate A is merged with Gate B closed, **zero agent identities exist**, and the Council has recorded Phase 0 complete — with everything fully revertible.

### 1.3 Reconciliation of prior artifacts (chosen interpretations)

| Tension across prior docs | Chosen canonical interpretation |
|---|---|
| "Revenue First" (v2.0 §5) vs AI-Twin-primary canon | **Financial Sustainability First**: AI-Twin v1 is the default primary product track; AI-Trader is the sustainability engine; **activating AI-Trader engineering is a reserved allocation decision** (parallel tracks, not a priority swap). |
| 9-agent architecture + daily loops (v2.0 §7/§10) vs constitutional acceptance | **VISION only.** Realized, if ever, as a sequence of single chartered identities; **Product Auditor is first-and-only candidate** (Gate B). No persistent loops, no councils. |
| Knowledge Base GitBook/Notion (v2.0 §3) vs lean repo | **Repository-First**; external KB deferred behind explicit triggers. |
| PR count (3-PR vs 2-PR) | **Two primary PRs** (PR1 additive, PR2 authority + Gate A cross-refs); PR3 is contingency only. |
| Single "head of doctrine" vs new acceptance | **Doctrine stack**: two DOCTRINE artifacts with disjoint scopes (2026-05-10 = agent doctrine; 2026-06-21 = ecosystem integration). Neither supersedes the other; operational canon still wins on conflict. |
| v2.0 launch begins at "Foundation" | **Phase 0 precedes Foundation**; Phase 1 requires a separate authorization. |
| Linear 4 cadences (v2.0 §9) vs team-scoped cycles | Deferred to Phase 1 as an open decision (Option 1 recommended); **not a Phase 0 concern**. |

---

## 2. Governance Objectives

### 2.1 Phase 0 achieves
- Founders Council established in-repo as apex authority; Architect re-cast as its delegate.
- WAIA Operations System v2.0 canonized; every claim classified via the Constitutional Intake Procedure.
- Sources-of-Truth doctrine (Repository-First) recorded.
- Agent Charter Doctrine (Gate A) merged as a constraint document.
- English Canon Rule (with product-copy carve-out), Financial Sustainability First, Additive-First, and the Reserved-Decisions doctrine consolidated.
- Governance Risk Register adopted with owners.

### 2.2 Phase 0 explicitly does NOT attempt
- No agent identities, activation, or Gate B (Product Auditor stays deferred).
- No Linear restructuring (no new projects/initiatives/cycles).
- No Discord, Voice of Humanity, Knowledge Base platform, Treasury, tokens, or WAIA Breathing.
- No code, runtime, schema, or product change.
- No resolution of reserved decisions (roadmap allocation, tokenomics, portfolio) — only their explicit reservation.

---

## 3. Constitutional Architecture

### 3.1 Consolidated model
Ecosystem constitution (Ops v2.0) → Founders Council (apex) → WAIA DEV OS (Development subsystem) → Human Architect (delegate) → Cursor agents (advisory, gated). Operational canon governs execution mechanics and wins on conflict until amended.

### 3.2 Authority hierarchy

| Layer | Holder | Authority |
|---|---|---|
| **Apex** | **Founders Council** (Aleksey Kalinichenko, Nataly Guseva) | Reserved decisions (§3.4); unanimity required; documented tie-break (status quo holds); continuity clause. |
| **Delegate** | **Human Architect / operator** | Scope approval, merges, production posture, governance execution — **as delegate**, cannot make reserved decisions. |
| **Coordination** | Orchestrator **pattern** (not a chartered agent) | Sequencing/handoffs only; no authority. |
| **Execution** | Planner / Executor / Reviewer + (future) chartered advisory agent | Within issue scope and labels; agents are advisory, comment-only. |

> This Master Plan records the agreed target hierarchy; the operational-canon edits that make it binding are performed in **PR2 (GI-05)**, not by this file.

### 3.3 Decision hierarchy (conflict recovery)
Product specs → operational canon + ADRs → migration trackers → active Linear issue → code. Constitutional doctrine explains *why* the canon is shaped as it is; it does not override it.

### 3.4 Reserved decisions (Founders Council only)
Mission, philosophy, Source Code of Consciousness, Brand Book; tokens/tokenomics, community token pool, treasury structure; roadmap priority and **capital/attention allocation across tracks** (incl. activating AI-Trader engineering); product portfolio composition and new modules; strategic investors, asset sales, equity, annual budget; ecosystem architecture; **opening any agent gate (A→D)**; adoption of any new vendor/public runtime surface.

---

## 4. Sources of Truth

| Source | Canonical system | Owner | Change authority |
|---|---|---|---|
| **Development** | Cursor / this repository | Architect (delegate) | Architect via PR; reserved items escalate to Council |
| **Operations** | Linear (team DEE, project WAIA) | Architect | Architect; structural changes (new projects) are gated |
| **Knowledge** | **Repository-native (Phase 0–1)** | Architect | Repo PR; external KB deferred behind triggers; read-only export allowed (not a second SoT) |
| **Narrative** (future) | Source Code of Consciousness, Brand Book, Ops System | **Founders Council** | Council only (reserved) |
| **Financial** (future) | Treasury, model, token registry, budget, KPI | **Founders Council** | Council only (reserved) |
| **Community** (future) | Discord, Customer Requests, Voice of Humanity | Council / community lead | Activated in Phase 1+ |

Single-SoT discipline: contradictions trigger STOP per [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md). Canonical detail lives in [`SOURCES-OF-TRUTH.md`](SOURCES-OF-TRUTH.md).

---

## 5. Governance Principles (consolidated doctrine layer)

- **Founders Council Supremacy.** Apex authority; reserved decisions are inviolable by agents or Architect.
- **English Canon Rule.** English is authoritative for governance/constitutional/operational/architectural docs; translations informational; English prevails on discrepancy. **Carve-out:** verbatim product/UI copy and illustrative user-utterance examples are exempt.
- **Repository First.** The repo is the Knowledge Base for Phase 0–1; external KB deferred behind explicit triggers.
- **Financial Sustainability First.** Product decisions account for ecosystem sustainability; AI-Twin v1 default primary; AI-Trader activation reserved.
- **Product Auditor First and Only Candidate.** The only admissible advisory identity; one-identity ceiling until Gate C; no second candidate until Product Auditor is observably stable >= 1 quarter and the Council reopens the question.
- **Gate A -> B -> C -> D.** Strictly sequential; Council authorizes each gate; Architect executes; agents are event-triggered, comment-only, with kill-switch and dormant/shadow activation.
- **Additive First.** Integrate additively; isolate semantic authority changes; one concern per PR; clean single-revert rollback.
- **Constitutional Intake Procedure.** Every external constitution is classified into EXECUTABLE NOW / DEFERRED (gated) / VISION ONLY / FOUNDERS-RESERVED. Reusable for all future constitutions.
- **Reserved Decisions Doctrine.** See §3.4; recorded in-repo with date and rationale.

---

## 6. Governance Risk Register (consolidated, adopted)

| ID | Risk | Prob | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| GR-01 | Constitutional drift | M | H | Append-only history; mutation procedure; versioning row; ADR | Council/Architect |
| GR-02 | Authority ambiguity | M | H | Isolated authority-rewire PR; delegate model; reserved table | Council |
| GR-03 | Agent proliferation | M | H | One-identity ceiling; Product-Auditor-first-only; Council-gated gates | Council |
| GR-04 | Scope creep | H | H | Financial Sustainability First guardrail; AI-Twin default primary | Council |
| GR-05 | Dual source of truth | M | M | Repository-First; KB deferral triggers | Architect |
| GR-06 | Automation before governance | M | H | Gate sequencing; event-triggered only; dormant/shadow | Council/Architect |
| GR-07 | Documentation fragmentation | M | M | Lean/fold-not-proliferate; README index; optional link-lint (deferred) | Architect |
| GR-08 | Community governance capture | M | H | Intake triage/weighting; Council-reserved roadmap; transparency cadence | Council / (future) community lead |
| GR-09 | Financial governance failure | L | H | Founders-reserved finance; multisig; Open Heart reporting; ADR for token actions | Council |
| GR-10 | Narrative drift (cult/ideology/hype) | M | H | Narrative governance; Brand Book / Source Code of Consciousness canon; public-copy review | Council |
| GR-11 | Founders Council deadlock / bus-factor | M | H | Unanimity + tie-break (status quo holds) + continuity clause | Council |
| GR-12 | Linear sprawl / automation bypass | M | M | Agent-eligible project allowlist; cadence decision recorded | Architect |
| GR-13 | Translation / bilingual drift | M | M | English-prevails clause + carve-out + audit | Architect |
| GR-14 | Reversibility decay | M | H | Additive changes; one-concern PRs; quarterly reversibility check | Architect |
| GR-15 | Gate-skipping pressure | M | H | VISION labeling; Council-only gate-opening; expectation management | Council |
| GR-16 | Knowledge accessibility exclusion | M | M | Read-only rendered export (not a second SoT) | Architect |

---

## 7. Governance Execution Backlog (Phase 0 roadmap)

Backlog IDs are local (`GI-NN`); Linear assigns `DEE-NN` at creation; branches use the assigned number. All Phase 0 issues are **Human-Architect-owned, labeled `architect` (auxiliary), carry no code execution label**, and are excluded from autonomous-coder selection.

**Epic**
- **GI-00 — Phase 0 Governance Integration (parent).** Description: container for all Phase 0 work. Dependencies: none. Acceptance: all child issues closed; GI-07 recorded. Owner: Architect / Council.

**M0 — Council Ratification (decisions; no PR)**
- **GI-01 — Ratify governance architecture & authority model.** Desc: Council ratifies Council-as-apex + Architect-delegate + layered model. Deps: none. Acceptance: written ratification recorded; no open objection. Owner: **Founders Council**.
- **GI-02 — Ratify English Canon + carve-out.** Desc: English authoritative; carve-out for product copy/examples. Deps: GI-06. Acceptance: policy + carve-out approved; product strings confirmed exempt. Owner: **Founders Council**.
- **GI-03 — Approve Phase 0 scope & PR sequencing.** Desc: approve additive-first 2-PR sequence and Phase 0 boundary. Deps: GI-01. Acceptance: sequence chosen and recorded. Owner: **Founders Council**.

**M1 — Additive Constitutional Layer -> PR1**
- **GI-06 — English-canon carve-out audit.** Desc: classify the Cyrillic-containing docs (copy/example vs prose); draft carve-out clause. Deps: none. Acceptance: each file classified; zero governance-prose translations required or exceptions logged. Owner: Architect. Risk: T0.
- **GI-04 — Land additive constitutional layer (PR1).** Desc: introduce all new docs additively with **no operational-canon authority change**. Deps: GI-01, GI-02, GI-03, GI-06. Owner: Architect. Risk: **T0**. Acceptance (one PR):
  - `constitutional-history/2026-06-21-constitutional-acceptance-v2.0.md` (DOCTRINE; Intake Procedure; Financial Sustainability First + guardrail).
  - `FOUNDERS-COUNCIL.md` (marked effective on PR2).
  - `SOURCES-OF-TRUTH.md` (Repository-First + triggers).
  - `AGENT-CHARTER.md` (Gate A; one-identity ceiling; Product-Auditor-first-only; Council-gated; dormant/shadow).
  - English Canon in `DOCUMENTATION-STANDARDS.md` + `GLOSSARY.md` terms.
  - `docs/adr/0012-*.md` (apex authority + English canon).
  - **`WAIA-GOVERNANCE-INTEGRATION-MASTER-PLAN-v1.0.md` (this Phase 0 System of Record), with required non-binding framing, Canonical-Wins Clause, and cross-references** *(normalized deliverable — see §7.1)*.
  - Pointer/index: `README.md`, `CONSTITUTIONAL-DOCTRINE.md` doctrine-stack, `constitutional-history/README.md`, `GOVERNANCE-VERSIONING.md` row.
  - PR body `**Tier:** T0` + `**Linear:** ` + backtick-wrapped `DEE-NN`; human-opened/merged; cross-links manually verified.

**M2 — Authority Reconciliation -> PR2**
- **GI-05 — Authority reconciliation + Gate A cross-refs (PR2).** Desc: surgical apex rewire; activate `FOUNDERS-COUNCIL.md`. Deps: GI-04 merged. Owner: Architect. Risk: **T0 content / review >= T1**. Acceptance (one PR):
  - `AGENT-ROLES.md` authority table -> Final = Council; Architect = delegate; Orchestrator explicitly not a chartered agent.
  - `EXECUTION-CONTRACT.md` gates -> add Founders-reserved top row.
  - `WAIA-DEV-OS.md` §2/§3 -> Council apex; Architect delegated.
  - `AGENTS.md` -> governance-hub + authority note.
  - `FOUNDERS-COUNCIL.md` -> binding.
  - `NON-GOALS.md` -> Financial Sustainability First note.
  - `AGENT-CHARTER.md` cross-refs into `AGENT-ROLES.md`/`NON-GOALS.md`.
  - `GOVERNANCE-VERSIONING.md` row; Tier/Linear fields; human-opened/merged.

**M3 — Verification & Closeout (no PR)**
- **GI-07 — Phase 0 completion verification & record.** Desc: verify §9 criteria; Council records completion; confirm Gate B closed. Deps: GI-05 merged. Acceptance: §9 all true; completion recorded; Phase 1 declared *eligible* (not started). Owner: Architect -> **Founders Council**.

**Deferred (NOT Phase 0)**
- **GI-D1 — Product Auditor charter (Gate B).** Owner: Architect (author) / future agent (execute). Blocked: Gate A merged + Council authorization + dormant/shadow + stability.
- **GI-D2 — Optional markdown link-lint** (mitigates GR-07/GR-03 link rot). Deferred.

### 7.1 Deliverable normalization note
The Repository Placement Review identified that GI-04's acceptance criteria did not originally list **this System of Record file** as an explicit deliverable. That deliverable is now listed under GI-04 above. This is a faithful **deliverable normalization only** — it does not change the backlog structure, milestones, dependencies, ownership, or risk tiers.

---

## 8. PR Sequence

| Step | Issue | Class | Tier | Gate / review | Rollback checkpoint |
|---|---|---|---|---|---|
| Ratify | GI-01/02/03 | Council decisions | — | **Ratification point 1** (Council records decisions) | n/a |
| Pre-PR | GI-06 | Architect audit | T0 | feeds PR1 | n/a |
| **PR1** | GI-04 | Additive | T0 | Human review: link integrity, supremacy clause, carve-out | Revert PR1 (clean; append-only artifact removed) |
| Pause | — | — | — | **Review point 1**: confirm no contradiction surfaced | — |
| **PR2** | GI-05 | Authority rewire | T0 / >=T1 review | Human review: authority diffs minimal & consistent | Revert PR2 restores "Architect = Final" verbatim |
| Closeout | GI-07 | Verify | — | **Ratification point 2** (Council records Phase 0 complete) | — |
| PR3 (contingency) | — | only if Gate A cross-refs excluded from PR2 | T0 | — | Revert |

Rules: one Linear ID per PR; branch `dee-<NN>-<slug>`; human-opened, human-merged; agents never merge.

---

## 9. Phase 0 Completion Criteria (objective)

All must be TRUE:
1. GI-01, GI-02, GI-03 ratified and recorded.
2. PR1 (GI-04) merged to `dev`.
3. PR2 (GI-05) merged to `dev`.
4. `FOUNDERS-COUNCIL.md` is binding; `AGENT-ROLES.md` shows Final = Founders Council, Architect = delegate.
5. Every WAIA Operations System v2.0 claim is tier-classified in the Acceptance Artifact.
6. Doctrine stack present and unambiguous (two DOCTRINE artifacts, disjoint scopes).
7. English Canon + carve-out in `DOCUMENTATION-STANDARDS.md`; no governance-prose left non-English.
8. Repository-First recorded in `SOURCES-OF-TRUTH.md`.
9. `AGENT-CHARTER.md` merged (Gate A); **Gate B closed; zero agent identities exist**.
10. All reserved decisions logged as reserved (none resolved by agent or Architect).
11. `GOVERNANCE-VERSIONING.md` updated; ADR-0012 merged.
12. GI-07 recorded by Founders Council.

---

## 10. Foundation Readiness Criteria (gate to Phase 1)

Phase 1 may begin only when **all of §9** hold **and**:
- The Founders Council issues a **separate explicit authorization** to begin Foundation.
- The **Linear cadence model** is decided (Option 1 — single team DEE, Development cycles only — recommended).
- **Growth is confirmed as a human function** in Phase 1 (Growth Intelligence agent remains VISION).
- **Product Auditor (Gate B) is quarantined** as its own later gate, not bundled with Foundation setup.
- The **agent-eligible project allowlist = {WAIA Development}** is reasserted.
- Each new vendor/runtime surface (Discord; KB if triggered) has its own ADR + Council approval before adoption.

---

## 11. Future Architecture (Reference Only — NOT executable)

> Out of Phase 0 scope. Listed for continuity only. Clearly separated below into what is executable now versus future vision, to prevent governance ambiguity (Guardrail 3).

### 11.1 EXECUTABLE NOW (Phase 0)
Founders Council layer; Sources-of-Truth doctrine; v2.0 Acceptance Artifact + Constitutional Intake Procedure; Agent Charter (Gate A); English Canon; Financial Sustainability First doctrine; Governance Risk Register; Additive-First integration; **this System of Record**.

### 11.2 FUTURE VISION / DEFERRED (Phase 1+, each separately gated)
- **Future Linear Topology** — keep `WAIA` as the agent-eligible Development project; add human-only `Growth`/`Community`/`Operations` projects + `Voice of Humanity` initiative; resolve the team-cadence constraint (Option 1 recommended). *Gated by §10.*
- **Voice of Humanity** — collective community memory initiative. *Phase 1; needs Discord + Linear expansion.*
- **Open Heart Economy** — WAIA Breathing public page, multisig Treasury, USDT funding, 20% token pool. *Founders-reserved; later phases; ADRs required.*
- **Product Auditor Gate (Gate B)** — first/only advisory identity; dormant/shadow first. *Gated: Gate A merged + Council authorization + stability.*
- **Growth Function** — **human** content/growth process in Phase 1; Growth *Intelligence agent* is VISION.
- **Community Layer** — Discord, Customer Requests, intake triage, anti-capture weighting. *Phase 1; vendor ADR required.*
- **Daily Operations System / 9-agent architecture** — VISION only; never a persistent multi-agent swarm.

---

## 12. Immediate Next Actions (only post-ratification)

1. Record GI-01/02/03 Council ratifications (Ratification point 1).
2. Create the Phase 0 Linear epic (GI-00) and issues GI-04/05/06/07 in project WAIA, team DEE, label `architect`, no execution label — in creation order (epic -> decisions -> GI-06 -> GI-04 -> GI-05 -> GI-07).
3. Execute **PR1 (GI-04)** on a `dee-<NN>-<slug>` branch; human review; human merge.
4. **Pause** for Review point 1.
5. Execute **PR2 (GI-05)**; human review; human merge.
6. Run **GI-07** verification; Council records Phase 0 complete (Ratification point 2).
7. **Stop.** Do not begin Phase 1 without separate authorization per §10.

No repository, PR, or Linear artifacts beyond this System of Record are created without explicit authorization.

---

## Founders Council Ratification Checklist

For **Aleksey Kalinichenko** and **Nataly Guseva** — unanimous approval required.

- [ ] **R1.** Approve Founders Council as apex authority; Human Architect as delegate (§3).
- [ ] **R2.** Approve English Canon Rule **with** the product-copy/examples carve-out (§5).
- [ ] **R3.** Approve Repository-First Knowledge Strategy; external KB deferred (§4–5).
- [ ] **R4.** Approve Financial Sustainability First; AI-Twin v1 default primary; AI-Trader activation reserved (§5, §1.3).
- [ ] **R5.** Approve Product-Auditor-First-and-Only + Gate A->D model; Gate B remains closed (§5).
- [ ] **R6.** Approve Additive-First 2-PR sequence (PR1 additive, PR2 authority+Gate A) (§8).
- [ ] **R7.** Adopt the Governance Risk Register (GR-01…GR-16) with owners (§6).
- [ ] **R8.** Confirm Phase 0 scope and explicit non-goals (§2).
- [ ] **R9.** Accept Phase 0 Completion Criteria (§9) and Foundation Readiness Criteria (§10) as objective gates.
- [ ] **R10.** Acknowledge future architecture is reference-only and individually gated (§11).
- [ ] **R11.** Authorize creation of the Phase 0 Linear epic and issues (§12) — execution only, no reserved decisions resolved.
- [ ] **R12.** Confirm: no agent identity, Linear restructuring, or vendor surface is authorized by this ratification.

**Ratified by:** ____________________ (Aleksey Kalinichenko) · ____________________ (Nataly Guseva) · **Date:** __________

---

## Related canonical documents

- [`WAIA-DEV-OS.md`](WAIA-DEV-OS.md) — DEV OS constitution.
- [`EXECUTION-CONTRACT.md`](EXECUTION-CONTRACT.md) — gates & escalation.
- [`CONSTITUTIONAL-DOCTRINE.md`](CONSTITUTIONAL-DOCTRINE.md) — doctrine pointer / status semantics (this Master Plan is **not** listed there).
- [`constitutional-history/README.md`](constitutional-history/README.md) — constitutional lineage (append-only).
- [`GOVERNANCE-VERSIONING.md`](GOVERNANCE-VERSIONING.md) — supersession log.
- [`README.md`](README.md) — governance docs index.
- Repo-root [`AGENTS.md`](../../AGENTS.md) — execution contract baseline.

> **Status reminder:** Non-binding Phase 0 System of Record. On any conflict, the canonical governance documents above prevail (see Canonical-Wins Clause).
